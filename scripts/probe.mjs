#!/usr/bin/env node
// CME evidence probe — Robinhood Chain (4663).
//
// Runs OUTSIDE the analysis sandbox (Railway) because the sandbox's egress
// policy denies rpc.mainnet.chain.robinhood.com and the Blockscout host.
// See findings/00-method.md.
//
// Output goes to two places:
//   1. stdout as line-delimited JSON with ##TAG## markers (read via Railway logs)
//   2. an HTTP server on $PORT serving the full result as JSON
//      GET /            -> index of sections
//      GET /all         -> everything
//      GET /s/<section> -> one section
//
// Phases are selected with PROBE=map,liveness,launches,logs
import http from 'node:http';
import {
  rpc, rpcOk, bs, ethCall, encAddress, decodeWords, decodeString, decodeBytes32String,
  decodeInt, parseMetadataFooter, extractPush4, extractPush20, readProxySlots,
  toBig, toNum, numToHex, wordToAddress, keccakHex, selector, keccak256, hexToBytes,
  bytesToHex, RPC_URL, BLOCKSCOUT,
} from './lib/chain.mjs';
import { VIEW_CALLS, PROBE_SIGS, EVENT_SIGS } from './lib/sigs.mjs';

// Published in README §1 / the project docs. Treated as HYPOTHESES: the probe
// exists to test whether these are still the live production addresses.
const DOC_ADDRESSES = {
  LaunchpadV4:         '0x741aE845F4F11B43467e7D0be991AD814E6Fc522',
  LaunchRouterV4:      '0x92584892EC2663b1969DffDeB5930e54FC5AAcd1',
  BasketRouterV4:      '0x1ae8E086Daa6Bf7D81F99f08c0f3b755BaaDA348',
  CME:                 '0xe2324FF2a59F8eCBa8c321c6466e59121C00e795',
  Buyback:             '0x4551E406A80Fd9249e47A5A1A38b7089D9b9C226',
  CommodityPriceFeed:  '0x3B784715e1ecFDC6A59707d5b05e5bc898159ab7',
  PoolManagerV4:       '0x8366a39CC670B4001A1121B8F6A443A643e40951',
};

const PHASES = (process.env.PROBE || 'map,liveness').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_BLOCKS_BACK = Number(process.env.MAX_BLOCKS_BACK || 500000);
const LOG_CHUNK = Number(process.env.LOG_CHUNK || 10000);
const TX_PAGE = Number(process.env.TX_PAGE || 50);

const RESULT = { meta: {}, sections: {} };
const started = Date.now();

// ------------------------------------------------------------------ logging

const MAXLINE = 1400;
function emit(tag, payload) {
  RESULT.sections[tag] = payload;
  const body = JSON.stringify(payload);
  if (body.length <= MAXLINE) { console.log(`##${tag}## ${body}`); return; }
  const parts = Math.ceil(body.length / MAXLINE);
  for (let i = 0; i < parts; i++) {
    console.log(`##${tag}:${i + 1}/${parts}## ${body.slice(i * MAXLINE, (i + 1) * MAXLINE)}`);
  }
}
const note = (...a) => console.log('##NOTE##', ...a);

// -------------------------------------------------------------- phase: map

async function txListV1(address, { page = 1, offset = TX_PAGE, sort = 'desc' } = {}) {
  const r = await bs(`/api?module=account&action=txlist&address=${address}&page=${page}&offset=${offset}&sort=${sort}`);
  if (r && r.status === '1' && Array.isArray(r.result)) return r.result;
  return null;
}

async function txListV2(address) {
  const r = await bs(`/api/v2/addresses/${address}/transactions?filter=to`);
  if (r && Array.isArray(r.items)) return r.items;
  return null;
}

/** Normalised recent inbound transactions, whichever API answers. */
async function recentTxs(address) {
  const v1 = await txListV1(address);
  if (v1) {
    return {
      source: 'blockscout-v1',
      txs: v1.map((t) => ({
        hash: t.hash, ts: Number(t.timeStamp), block: Number(t.blockNumber),
        from: t.from, to: t.to, method: (t.input || '0x').slice(0, 10),
        isError: t.isError, gasUsed: t.gasUsed, value: t.value,
      })),
    };
  }
  const v2 = await txListV2(address);
  if (v2) {
    return {
      source: 'blockscout-v2',
      txs: v2.map((t) => ({
        hash: t.hash, ts: Math.floor(new Date(t.timestamp).getTime() / 1000),
        block: t.block_number ?? t.block, from: t.from && t.from.hash, to: t.to && t.to.hash,
        method: t.method || (t.raw_input || '0x').slice(0, 10),
        isError: t.status === 'ok' ? '0' : '1', gasUsed: t.gas_used, value: t.value,
      })),
    };
  }
  return { source: 'none', txs: [] };
}

async function mapAddress(name, address) {
  const out = { name, address, checkedAt: new Date().toISOString() };

  const code = await rpcOk('eth_getCode', [address, 'latest']);
  out.hasCode = !!(code && code !== '0x');
  out.codeSize = out.hasCode ? (code.length - 2) / 2 : 0;
  if (out.hasCode) {
    out.codeHash = bytesToHex(keccak256(hexToBytes(code)));
    out.metadata = parseMetadataFooter(code);
    const push4 = extractPush4(code);
    out.selectorCount = push4.length;
    out.selectors = push4;
    out.embeddedAddresses = extractPush20(code);
    // Which of our guessed signatures actually appear in the dispatcher.
    const bySel = new Map(PROBE_SIGS.map((s) => [selector(s), s]));
    out.matchedSignatures = push4.filter((s) => bySel.has(s)).map((s) => `${s} ${bySel.get(s)}`);
    out.unmatchedSelectorCount = push4.length - out.matchedSignatures.length;
  }

  out.balanceWei = await rpcOk('eth_getBalance', [address, 'latest']);
  out.nonce = await rpcOk('eth_getTransactionCount', [address, 'latest']);
  out.proxySlots = await readProxySlots(address);

  // Live view calls — the authoritative answer to "what does this thing say".
  const views = {};
  for (const sig of VIEW_CALLS) {
    const data = await ethCall(address, sig);
    if (data == null) continue;
    const words = decodeWords(data);
    let v;
    if (/^(name|symbol)\(\)$/.test(sig)) v = decodeString(data) || decodeBytes32String(data);
    else if (words.length === 1) {
      const b = toBig(words[0]);
      const asAddr = wordToAddress(words[0]);
      v = { raw: words[0], uint: b == null ? null : b.toString(),
            address: /^0x0{24}/.test(words[0].replace('0x','').padStart(64,'0')) ? null : asAddr };
      if (b === 0n || b === 1n) v.bool = b === 1n;
    } else v = { raw: data.slice(0, 200), words: words.length };
    views[sig] = v;
  }
  out.viewCalls = views;

  // Explorer's own view: verification status, proxy detection, creator.
  const info = await bs(`/api/v2/addresses/${address}`);
  if (!info.__error) {
    out.blockscout = {
      isContract: info.is_contract, isVerified: info.is_verified,
      name: info.name, implementations: info.implementations,
      proxyType: info.proxy_type, creatorAddress: info.creator_address_hash,
      creationTxHash: info.creation_tx_hash ?? info.creation_transaction_hash,
      hasTokenTransfers: info.has_token_transfers, token: info.token
        ? { name: info.token.name, symbol: info.token.symbol, type: info.token.type,
            decimals: info.token.decimals, totalSupply: info.token.total_supply,
            holders: info.token.holders ?? info.token.holders_count } : null,
    };
  } else {
    out.blockscout = { __error: info.__error };
    const v1 = await bs(`/api?module=contract&action=getsourcecode&address=${address}`);
    if (v1 && v1.status === '1' && v1.result && v1.result[0]) {
      const r = v1.result[0];
      out.blockscoutV1 = {
        contractName: r.ContractName, compilerVersion: r.CompilerVersion,
        verified: !!(r.SourceCode && r.SourceCode.length),
        proxy: r.Proxy, implementation: r.Implementation,
      };
    }
  }

  // Sourcify — the other place official source could live (Task A/B).
  out.sourcify = await sourcifyCheck(address);

  const rt = await recentTxs(address);
  out.txSource = rt.source;
  out.lastInboundTx = rt.txs[0] || null;
  out.secondsSinceLastInbound = rt.txs[0] ? Math.floor(Date.now() / 1000) - rt.txs[0].ts : null;
  return out;
}

async function sourcifyCheck(address) {
  const urls = [
    `https://sourcify.dev/server/check-all-by-addresses?addresses=${address}&chainIds=4663`,
    `https://repo.sourcify.dev/contracts/full_match/4663/${address}/metadata.json`,
  ];
  const out = {};
  for (const u of urls) {
    try {
      const res = await fetch(u, { signal: AbortSignal.timeout(20000) });
      out[u.includes('check-all') ? 'checkAll' : 'fullMatchMetadata'] =
        res.ok ? (await res.text()).slice(0, 600) : `HTTP ${res.status}`;
    } catch (e) { out[u.includes('check-all') ? 'checkAll' : 'fullMatchMetadata'] = `ERR ${e.message}`; }
  }
  return out;
}

async function phaseMap() {
  for (const [name, address] of Object.entries(DOC_ADDRESSES)) {
    note('mapping', name, address);
    try {
      const r = await mapAddress(name, address);
      const { selectors, ...summary } = r;
      emit(`ADDR_${name}`, summary);
      if (selectors) emit(`SELS_${name}`, { address, count: selectors.length, selectors });
    } catch (e) {
      emit(`ADDR_${name}`, { name, address, __error: String(e && e.stack || e) });
    }
  }
}

// --------------------------------------------------------- phase: liveness

function gapStats(tsDesc) {
  const ts = [...tsDesc].sort((a, b) => b - a);
  const gaps = [];
  for (let i = 0; i < ts.length - 1; i++) gaps.push(ts[i] - ts[i + 1]);
  if (!gaps.length) return { n: 0 };
  const sorted = [...gaps].sort((a, b) => a - b);
  const sum = gaps.reduce((a, b) => a + b, 0);
  return {
    n: gaps.length,
    minSec: sorted[0], maxSec: sorted[sorted.length - 1],
    medianSec: sorted[Math.floor(sorted.length / 2)],
    meanSec: Math.round(sum / gaps.length),
    p90Sec: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))],
    gaps: gaps.slice(0, 60),
  };
}

async function phaseLiveness() {
  const targets = ['CommodityPriceFeed', 'Buyback', 'LaunchpadV4', 'CME', 'PoolManagerV4', 'LaunchRouterV4'];
  for (const name of targets) {
    const address = DOC_ADDRESSES[name];
    note('liveness', name);
    const all = [];
    for (let page = 1; page <= 4; page++) {
      const t = await txListV1(address, { page, offset: 100 });
      if (!t || !t.length) break;
      all.push(...t);
      if (t.length < 100) break;
    }
    const txs = all.map((t) => ({
      hash: t.hash, ts: Number(t.timeStamp), block: Number(t.blockNumber),
      from: t.from, method: (t.input || '0x').slice(0, 10),
      isError: t.isError, gasUsed: t.gasUsed,
    }));
    const now = Math.floor(Date.now() / 1000);
    const methodHist = {};
    const senderHist = {};
    for (const t of txs) {
      methodHist[t.method] = (methodHist[t.method] || 0) + 1;
      senderHist[t.from] = (senderHist[t.from] || 0) + 1;
    }
    emit(`LIVE_${name}`, {
      address, sampled: txs.length,
      lastTx: txs[0] || null,
      secondsSinceLastInbound: txs[0] ? now - txs[0].ts : null,
      newestTs: txs[0] ? txs[0].ts : null,
      oldestTs: txs.length ? txs[txs.length - 1].ts : null,
      failureCount: txs.filter((t) => t.isError === '1').length,
      methodHist, senderHist,
      interArrival: gapStats(txs.map((t) => t.ts)),
      recent: txs.slice(0, 15),
    });
  }

  const cme = DOC_ADDRESSES.CME;
  const tok = await bs(`/api/v2/tokens/${cme}`);
  if (!tok.__error) emit('CME_TOKEN', tok);
  const burns = await bs(`/api?module=account&action=tokentx&contractaddress=${cme}&address=0x0000000000000000000000000000000000000000&page=1&offset=25&sort=desc`);
  if (burns && burns.status === '1') {
    emit('CME_BURNS', {
      count: burns.result.length,
      recent: burns.result.slice(0, 15).map((t) => ({
        hash: t.hash, ts: Number(t.timeStamp), from: t.from, to: t.to, value: t.value,
      })),
    });
  }
}

// -------------------------------------------------------- phase: launches

async function phaseLaunches() {
  const lp = DOC_ADDRESSES.LaunchpadV4;
  const all = [];
  for (let page = 1; page <= 5; page++) {
    const t = await txListV1(lp, { page, offset: 100 });
    if (!t || !t.length) break;
    all.push(...t);
    if (t.length < 100) break;
  }
  const methodHist = {};
  for (const t of all) {
    const m = (t.input || '0x').slice(0, 10);
    methodHist[m] = (methodHist[m] || 0) + 1;
  }
  emit('LAUNCHES', {
    address: lp, sampled: all.length, methodHist,
    newest: all[0] ? { hash: all[0].hash, ts: Number(all[0].timeStamp), block: Number(all[0].blockNumber) } : null,
    oldest: all.length ? { hash: all[all.length-1].hash, ts: Number(all[all.length-1].timeStamp), block: Number(all[all.length-1].blockNumber) } : null,
    recent: all.slice(0, 30).map((t) => ({
      hash: t.hash, ts: Number(t.timeStamp), block: Number(t.blockNumber),
      from: t.from, method: (t.input || '0x').slice(0, 10), isError: t.isError,
      inputLen: (t.input || '').length,
    })),
  });

  // Internal token creations from the launchpad — this is how we find CAs.
  const internal = await bs(`/api?module=account&action=txlistinternal&address=${lp}&page=1&offset=100&sort=desc`);
  if (internal && internal.status === '1') {
    const creates = internal.result.filter((t) => t.type === 'create' || t.type === 'create2');
    emit('LAUNCH_CREATES', {
      total: internal.result.length, creates: creates.length,
      recent: creates.slice(0, 30).map((t) => ({
        hash: t.hash, ts: Number(t.timeStamp), contract: t.contractAddress, type: t.type,
      })),
    });
  }

  const head = await rpcOk('eth_blockNumber');
  const headNum = toNum(head);
  const logs = await rpcOk('eth_getLogs', [{
    address: lp, fromBlock: numToHex(Math.max(0, headNum - LOG_CHUNK)), toBlock: 'latest',
  }]);
  if (Array.isArray(logs)) {
    const topicHist = {};
    for (const l of logs) topicHist[l.topics[0]] = (topicHist[l.topics[0]] || 0) + 1;
    const known = new Map(EVENT_SIGS.map((s) => [keccakHex(s), s]));
    emit('LAUNCH_LOGS', {
      window: [Math.max(0, headNum - LOG_CHUNK), headNum], count: logs.length,
      topicHist: Object.fromEntries(Object.entries(topicHist).map(([k, v]) => [k, { count: v, sig: known.get(k) || null }])),
      sample: logs.slice(-5),
    });
  }
}

// ------------------------------------------------------------ phase: logs

/** Decode a canonical v4 Initialize log into a PoolKey. */
function decodeV4Initialize(log) {
  const d = decodeWords(log.data);
  return {
    poolId: log.topics[1],
    currency0: wordToAddress(log.topics[2]),
    currency1: wordToAddress(log.topics[3]),
    fee: d[0] != null ? Number(BigInt(d[0])) : null,
    tickSpacing: d[1] != null ? decodeInt(d[1], 24) : null,
    hooks: d[2] != null ? wordToAddress(d[2]) : null,
    sqrtPriceX96: d[3] != null ? BigInt(d[3]).toString() : null,
    tick: d[4] != null ? decodeInt(d[4], 24) : null,
    block: Number(BigInt(log.blockNumber)),
    txHash: log.transactionHash,
  };
}

async function phaseLogs() {
  const pm = DOC_ADDRESSES.PoolManagerV4;
  const headNum = toNum(await rpcOk('eth_blockNumber'));
  const INIT_TOPIC = keccakHex('Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)');
  emit('LOGS_PLAN', { poolManager: pm, head: headNum, initTopic: INIT_TOPIC, maxBlocksBack: MAX_BLOCKS_BACK, chunk: LOG_CHUNK });

  const pools = [];
  let to = headNum;
  let chunk = LOG_CHUNK;
  const floor = Math.max(0, headNum - MAX_BLOCKS_BACK);
  let batch = 0;
  while (to > floor) {
    const from = Math.max(floor, to - chunk);
    const { result, error } = await rpc('eth_getLogs', [{
      address: pm, topics: [INIT_TOPIC], fromBlock: numToHex(from), toBlock: numToHex(to),
    }], { retries: 1 });
    if (error) {
      if (chunk > 500) { chunk = Math.floor(chunk / 4); note('shrink chunk ->', chunk, error.message); continue; }
      note('giving up on window', from, to, error.message);
      to = from - 1; chunk = LOG_CHUNK; continue;
    }
    for (const l of result) pools.push(decodeV4Initialize(l));
    note('scanned', from, to, 'found', result.length, 'total', pools.length);
    to = from - 1;
    if (pools.length > 3000) { note('pool cap reached'); break; }
    if (++batch % 10 === 0) emit(`POOLS_${Math.floor(batch / 10)}`, pools.splice(0, pools.length));
  }
  if (pools.length) emit('POOLS_FINAL', pools);

  const flat = Object.entries(RESULT.sections)
    .filter(([k]) => k.startsWith('POOLS_'))
    .flatMap(([, v]) => Array.isArray(v) ? v : []);
  const hookHist = {}, curHist = {}, feeHist = {};
  for (const p of flat) {
    hookHist[p.hooks] = (hookHist[p.hooks] || 0) + 1;
    curHist[p.currency0] = (curHist[p.currency0] || 0) + 1;
    curHist[p.currency1] = (curHist[p.currency1] || 0) + 1;
    feeHist[p.fee] = (feeHist[p.fee] || 0) + 1;
  }
  emit('POOLS_SUMMARY', { total: flat.length, hookHist, feeHist, topCurrencies: Object.entries(curHist).sort((a,b)=>b[1]-a[1]).slice(0,30) });
}

// ------------------------------------------------------------------- main

async function main() {
  const chainId = await rpcOk('eth_chainId');
  const head = await rpcOk('eth_blockNumber');
  const clientVersion = await rpcOk('web3_clientVersion');
  const headBlock = head ? await rpcOk('eth_getBlockByNumber', [head, false]) : null;
  RESULT.meta = {
    startedAt: new Date().toISOString(), rpc: RPC_URL, blockscout: BLOCKSCOUT,
    phases: PHASES, chainId, chainIdDec: toNum(chainId), head, headDec: toNum(head),
    clientVersion,
    headTimestamp: headBlock ? toNum(headBlock.timestamp) : null,
    headTimeIso: headBlock ? new Date(toNum(headBlock.timestamp) * 1000).toISOString() : null,
    docAddresses: DOC_ADDRESSES,
  };
  emit('CHAIN', RESULT.meta);

  if (chainId && toNum(chainId) !== 4663) note('WARNING: chainId is not 4663');

  const ran = [];
  for (const p of PHASES) {
    try {
      note('=== phase', p, 'start ===');
      if (p === 'map') await phaseMap();
      else if (p === 'liveness') await phaseLiveness();
      else if (p === 'launches') await phaseLaunches();
      else if (p === 'logs') await phaseLogs();
      else note('unknown phase', p);
      ran.push(p);
    } catch (e) {
      note('phase failed', p, String(e && e.stack || e));
      emit(`PHASE_ERROR_${p}`, { error: String(e && e.message || e) });
    }
  }
  emit('DONE', { ran, elapsedSec: Math.round((Date.now() - started) / 1000), sections: Object.keys(RESULT.sections) });
}

// Keep the container alive so logs survive and results stay fetchable.
const port = Number(process.env.PORT || 3000);
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('content-type', 'application/json');
  if (url.pathname === '/all') return res.end(JSON.stringify(RESULT));
  if (url.pathname.startsWith('/s/')) {
    const k = decodeURIComponent(url.pathname.slice(3));
    return res.end(JSON.stringify(RESULT.sections[k] ?? { __missing: k }));
  }
  res.end(JSON.stringify({
    meta: RESULT.meta, sections: Object.keys(RESULT.sections),
    done: !!RESULT.sections.DONE,
  }));
}).listen(port, () => note('http listening on', port));

main().catch((e) => { note('FATAL', String(e && e.stack || e)); });

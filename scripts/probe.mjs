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
  bytesToHex, RPC_URL, BLOCKSCOUT, blockTime, measureBlockTime, scanLogsBack,
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
  const head = toNum(await rpcOk('eth_blockNumber'));
  const bt = await measureBlockTime(head, 200000);
  emit('BLOCKTIME', bt || { __error: 'could not measure' });
  const spb = bt ? bt.secondsPerBlock : 0.25;

  // How far back to scan for a day's worth of activity at the measured rate.
  const perDay = Math.ceil(86400 / Math.max(spb, 0.01));
  const maxBack = Math.min(Number(process.env.MAX_BLOCKS_BACK || 0) || perDay * 3, 6000000);
  note('blocktime', spb, 'blocks/day', perDay, 'maxBack', maxBack);

  const known = new Map(EVENT_SIGS.map((sg) => [keccakHex(sg), sg]));

  for (const name of ['CommodityPriceFeed', 'Buyback', 'LaunchpadV4', 'CME', 'LaunchRouterV4']) {
    const address = DOC_ADDRESSES[name];
    note('liveness', name, address);
    const { logs, scannedFrom, scannedTo, windows, truncated } = await scanLogsBack(
      { address }, { head, want: 500, maxBack, chunk: Number(process.env.LOG_CHUNK || 20000),
        onProgress: (p) => note('  scan', name, p.from, '-', p.to, 'got', p.got, 'tot', p.total) });

    // Resolve timestamps for the blocks we actually saw (deduped).
    const blocks = [...new Set(logs.map((l) => Number(BigInt(l.blockNumber))))].sort((a, b) => b - a);
    const times = new Map();
    for (const b of blocks.slice(0, 300)) times.set(b, await blockTime(b));

    const topicHist = {};
    for (const l of logs) {
      const t = l.topics[0];
      topicHist[t] = (topicHist[t] || 0) + 1;
    }
    const tsDesc = blocks.map((b) => times.get(b)).filter((x) => x != null);
    const now = Math.floor(Date.now() / 1000);

    emit(`LIVE_${name}`, {
      address, logCount: logs.length, distinctBlocks: blocks.length,
      scannedFrom, scannedTo, windows, truncated,
      newestBlock: blocks[0] ?? null,
      newestTs: tsDesc[0] ?? null,
      newestIso: tsDesc[0] ? new Date(tsDesc[0] * 1000).toISOString() : null,
      secondsSinceLastEvent: tsDesc[0] ? now - tsDesc[0] : null,
      oldestSampledTs: tsDesc[tsDesc.length - 1] ?? null,
      topicHist: Object.fromEntries(Object.entries(topicHist)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => [k, { count: v, sig: known.get(k) || null }])),
      interArrival: gapStats(tsDesc),
      recent: logs.slice(-12).reverse().map((l) => ({
        block: Number(BigInt(l.blockNumber)), tx: l.transactionHash,
        topic0: l.topics[0], sig: known.get(l.topics[0]) || null,
        topics: l.topics.length, dataLen: (l.data || '0x').length,
        ts: times.get(Number(BigInt(l.blockNumber))) ?? null,
      })),
    });
  }

  // $CME burn path (Task K): Transfer(_, 0x0, _) on the token.
  const burnLogs = await scanLogsBack({
    address: DOC_ADDRESSES.CME,
    topics: [keccakHex('Transfer(address,address,uint256)'), null,
             '0x0000000000000000000000000000000000000000000000000000000000000000'],
  }, { head, want: 200, maxBack, chunk: Number(process.env.LOG_CHUNK || 20000) });
  const bblocks = [...new Set(burnLogs.logs.map((l) => Number(BigInt(l.blockNumber))))].sort((a, b) => b - a);
  const btimes = new Map();
  for (const b of bblocks.slice(0, 100)) btimes.set(b, await blockTime(b));
  emit('CME_BURNS', {
    token: DOC_ADDRESSES.CME, count: burnLogs.logs.length,
    scannedFrom: burnLogs.scannedFrom, scannedTo: burnLogs.scannedTo,
    newestTs: btimes.get(bblocks[0]) ?? null,
    newestIso: btimes.get(bblocks[0]) ? new Date(btimes.get(bblocks[0]) * 1000).toISOString() : null,
    totalBurnedInWindow: burnLogs.logs
      .reduce((a, l) => a + (l.data && l.data !== '0x' ? BigInt(l.data) : 0n), 0n).toString(),
    recent: burnLogs.logs.slice(-12).reverse().map((l) => ({
      block: Number(BigInt(l.blockNumber)), tx: l.transactionHash,
      from: wordToAddress(l.topics[1]),
      value: l.data && l.data !== '0x' ? BigInt(l.data).toString() : null,
      ts: btimes.get(Number(BigInt(l.blockNumber))) ?? null,
    })),
  });

  // Explorer extras, best-effort — Blockscout answered 403 from this runner
  // on the first run, so nothing downstream may depend on these.
  const tok = await bs(`/api/v2/tokens/${DOC_ADDRESSES.CME}`);
  emit('CME_TOKEN', tok.__error ? { __error: tok.__error } : tok);
}

// -------------------------------------------------------- phase: launches

async function phaseLaunches() {
  const lp = DOC_ADDRESSES.LaunchpadV4;
  const head = toNum(await rpcOk('eth_blockNumber'));
  const known = new Map(EVENT_SIGS.map((sg) => [keccakHex(sg), sg]));

  const { logs, scannedFrom, truncated } = await scanLogsBack({ address: lp }, {
    head, want: 2000, maxBack: Number(process.env.MAX_BLOCKS_BACK || 3000000),
    chunk: Number(process.env.LOG_CHUNK || 20000),
    onProgress: (p) => note('  launchscan', p.from, '-', p.to, 'got', p.got, 'tot', p.total),
  });

  // Group by event type; for each, collect the address-shaped topics. A
  // launch event almost certainly indexes the new token CA.
  const byTopic = {};
  for (const l of logs) {
    const t = l.topics[0];
    (byTopic[t] ||= { count: 0, sig: known.get(t) || null, topicArity: l.topics.length, samples: [], addrs: new Set() }).count++;
    const g = byTopic[t];
    if (g.samples.length < 3) g.samples.push({ block: Number(BigInt(l.blockNumber)), tx: l.transactionHash, topics: l.topics, data: (l.data || '0x').slice(0, 260) });
    for (const tp of l.topics.slice(1)) {
      const a = wordToAddress(tp);
      // address-shaped topic == 12 zero bytes then 20 bytes of address
      if (a && !/^0x0+$/.test(a) && tp.slice(2, 26) === '0'.repeat(24)) g.addrs.add(a);
    }
  }
  emit('LAUNCH_EVENTS', {
    address: lp, logCount: logs.length, scannedFrom, scannedTo: head, truncated,
    events: Object.fromEntries(Object.entries(byTopic).map(([k, v]) => [k, {
      count: v.count, sig: v.sig, topicArity: v.topicArity,
      distinctAddressTopics: v.addrs.size,
      addrSample: [...v.addrs].slice(0, 25),
      samples: v.samples,
    }])),
  });

  // Candidate token CAs: every address-shaped indexed topic that has code.
  const candidates = [...new Set(Object.values(byTopic).flatMap((v) => [...v.addrs]))];
  note('candidate addresses from launchpad logs:', candidates.length);
  const tokens = [];
  for (const a of candidates.slice(0, 60)) {
    const code = await rpcOk('eth_getCode', [a, 'latest']);
    if (!code || code === '0x') continue;
    const nm = await ethCall(a, 'name()');
    const sy = await ethCall(a, 'symbol()');
    const ts = await ethCall(a, 'totalSupply()');
    const dec = await ethCall(a, 'decimals()');
    tokens.push({
      address: a, codeSize: (code.length - 2) / 2,
      codeHash: bytesToHex(keccak256(hexToBytes(code))),
      name: nm ? (decodeString(nm) || decodeBytes32String(nm)) : null,
      symbol: sy ? (decodeString(sy) || decodeBytes32String(sy)) : null,
      totalSupply: ts ? BigInt(ts).toString() : null,
      decimals: dec ? Number(BigInt(dec)) : null,
    });
  }
  emit('LAUNCH_TOKENS', { checked: Math.min(candidates.length, 60), withCode: tokens.length, tokens });

  // Explorer extras, best-effort only.
  const internal = await bs(`/api?module=account&action=txlistinternal&address=${lp}&page=1&offset=100&sort=desc`);
  if (internal && internal.status === '1') {
    const creates = internal.result.filter((t) => t.type === 'create' || t.type === 'create2');
    emit('LAUNCH_CREATES', {
      total: internal.result.length, creates: creates.length,
      recent: creates.slice(0, 30).map((t) => ({ hash: t.hash, ts: Number(t.timeStamp), contract: t.contractAddress, type: t.type })),
    });
  } else {
    emit('LAUNCH_CREATES', { __error: (internal && internal.__error) || 'blockscout unavailable' });
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

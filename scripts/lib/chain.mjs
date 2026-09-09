// RPC + bytecode + ABI helpers for Robinhood Chain (4663). Zero dependencies.
import { keccak256, keccakHex, selector, toHex, utf8 } from './keccak.mjs';

export const RPC_URL = process.env.RPC_URL || 'https://rpc.mainnet.chain.robinhood.com';
export const BLOCKSCOUT = process.env.BLOCKSCOUT || 'https://robinhoodchain.blockscout.com';

let rpcId = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Single JSON-RPC call. Retries transient failures; returns {result} or {error}. */
export async function rpc(method, params = [], { retries = 3, timeoutMs = 30000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
        signal: ac.signal,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      const json = JSON.parse(text);
      if (json.error) return { error: json.error };
      return { result: json.result };
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(400 * 2 ** attempt);
    } finally {
      clearTimeout(t);
    }
  }
  return { error: { message: String(lastErr && lastErr.message || lastErr) } };
}

/** Convenience: throw-free call that returns the raw result or null. */
export async function rpcOk(method, params, opts) {
  const { result, error } = await rpc(method, params, opts);
  return error ? null : result;
}

/** Blockscout REST GET. Returns parsed JSON or {__error}. */
export async function bs(path, { timeoutMs = 30000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    // Blockscout fronted by a bot filter: a bare fetch UA gets 403 from a
    // datacenter IP, so present a browser-ish one.
    const res = await fetch(`${BLOCKSCOUT}${path}`, {
      headers: {
        accept: 'application/json,text/plain,*/*',
        'accept-language': 'en-US,en;q=0.9',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      },
      signal: ac.signal,
    });
    const text = await res.text();
    if (!res.ok) return { __error: `HTTP ${res.status}`, __body: text.slice(0, 300) };
    try { return JSON.parse(text); } catch { return { __error: 'non-json', __body: text.slice(0, 300) }; }
  } catch (e) {
    return { __error: String(e && e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------- hex utils

export const hexToBytes = (h) => {
  const s = (h || '').replace(/^0x/, '');
  const out = new Uint8Array(s.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
};
export const bytesToHex = (b) => '0x' + toHex(b);
export const toBig = (h) => (h == null || h === '0x' ? null : BigInt(h));
export const toNum = (h) => { const b = toBig(h); return b == null ? null : Number(b); };
export const numToHex = (n) => '0x' + BigInt(n).toString(16);
/** Last 20 bytes of a 32-byte word, as a checksum-less lowercase address. */
export const wordToAddress = (w) => {
  if (!w) return null;
  const s = w.replace(/^0x/, '').padStart(64, '0');
  return '0x' + s.slice(24);
};
export const isZeroWord = (w) => !w || /^0x0*$/.test(w);

// ------------------------------------------------------------- ABI encoding

export const padWord = (h) => h.replace(/^0x/, '').padStart(64, '0');
export const encAddress = (a) => padWord(a.toLowerCase());
export const encUint = (n) => padWord(BigInt(n).toString(16));
/** Build calldata for a signature with pre-encoded 32-byte word args. */
export const callData = (sig, words = []) => selector(sig) + words.join('');

/** eth_call a view function; returns raw hex data or null on revert/error. */
export async function ethCall(to, sig, words = [], block = 'latest') {
  const data = callData(sig, words);
  const { result, error } = await rpc('eth_call', [{ to, data }, block]);
  if (error) return null;
  return result === '0x' ? null : result;
}

// ------------------------------------------------------- ABI decode (subset)

export function decodeWords(hex) {
  const s = (hex || '').replace(/^0x/, '');
  const out = [];
  for (let i = 0; i + 64 <= s.length; i += 64) out.push('0x' + s.slice(i, i + 64));
  return out;
}
/** Decode a dynamic ABI string return value (offset,len,bytes). */
export function decodeString(hex) {
  try {
    const w = decodeWords(hex);
    if (w.length < 2) return null;
    const off = Number(BigInt(w[0])) / 32;
    const len = Number(BigInt(w[off]));
    if (!len) return '';
    const s = hex.replace(/^0x/, '').slice((off + 1) * 64, (off + 1) * 64 + len * 2);
    return new TextDecoder().decode(hexToBytes(s));
  } catch { return null; }
}
/** Some tokens return a bytes32 name/symbol instead of string. */
export function decodeBytes32String(hex) {
  try {
    const b = hexToBytes(hex).filter((x) => x !== 0);
    return new TextDecoder().decode(Uint8Array.from(b));
  } catch { return null; }
}
/** Two's-complement signed int from a 32-byte word, as a Number. */
export function decodeInt(word, bits = 24) {
  const v = BigInt(word);
  const half = 1n << BigInt(bits - 1);
  const mod = 1n << BigInt(bits);
  const masked = v & (mod - 1n);
  return Number(masked >= half ? masked - mod : masked);
}

// --------------------------------------------------- bytecode introspection

/**
 * Solidity appends a CBOR metadata map + 2-byte length to runtime bytecode.
 * Parsed loosely: we only need solc version, the IPFS/bzzr hash and the
 * experimental flag. Returns null when no recognisable footer is present.
 */
export function parseMetadataFooter(codeHex) {
  const b = hexToBytes(codeHex);
  if (b.length < 4) return null;
  const cborLen = (b[b.length - 2] << 8) | b[b.length - 1];
  if (cborLen < 2 || cborLen > b.length - 2) return null;
  const cbor = b.slice(b.length - 2 - cborLen, b.length - 2);
  const out = { cborLength: cborLen, raw: bytesToHex(cbor) };

  // Minimal CBOR map reader: we expect a small map of text-key -> bytes/bool/text.
  let i = 0;
  const major = cbor[i] >> 5, count = cbor[i] & 0x1f;
  if (major !== 5) return { ...out, note: 'footer present but not a CBOR map' };
  i += 1;
  const readLen = (extra) => {
    if (extra < 24) return extra;
    if (extra === 24) { const v = cbor[i]; i += 1; return v; }
    if (extra === 25) { const v = (cbor[i] << 8) | cbor[i + 1]; i += 2; return v; }
    return -1;
  };
  const dec = new TextDecoder();
  for (let n = 0; n < count && i < cbor.length; n++) {
    const km = cbor[i] >> 5, ke = cbor[i] & 0x1f; i += 1;
    if (km !== 3) break;
    const klen = readLen(ke); if (klen < 0) break;
    const key = dec.decode(cbor.slice(i, i + klen)); i += klen;
    const vm = cbor[i] >> 5, ve = cbor[i] & 0x1f; i += 1;
    if (vm === 2) {                       // byte string (ipfs/bzzr hash)
      const vlen = readLen(ve); if (vlen < 0) break;
      out[key] = bytesToHex(cbor.slice(i, i + vlen)); i += vlen;
    } else if (vm === 3) {                // text string
      const vlen = readLen(ve); if (vlen < 0) break;
      out[key] = dec.decode(cbor.slice(i, i + vlen)); i += vlen;
    } else if (vm === 4) {                // array (solc version as [maj,min,pat])
      const vlen = readLen(ve); const parts = [];
      for (let k = 0; k < vlen; k++) { const m = cbor[i] >> 5, e = cbor[i] & 0x1f; i += 1; parts.push(m === 0 ? readLen(e) : null); }
      out[key] = parts.join('.');
    } else if (vm === 7) {                // simple value (true/false)
      out[key] = ve === 21 ? true : ve === 20 ? false : `simple(${ve})`;
    } else if (vm === 0) {                // unsigned int
      out[key] = readLen(ve);
    } else break;
  }
  if (typeof out.solc === 'string' && /^0x/.test(out.solc)) {
    const v = hexToBytes(out.solc);
    if (v.length === 3) out.solcVersion = `${v[0]}.${v[1]}.${v[2]}`;
  }
  if (out.ipfs) out.ipfsCidHint = out.ipfs; // base58 encoding done offline if needed
  return out;
}

/**
 * Every PUSH4 immediate in the runtime code. A contract's dispatcher pushes
 * each selector it handles, so this is a superset of its public selectors
 * (plus incidental 4-byte constants). Skips PUSHn data so we do not read
 * constants as opcodes.
 */
export function extractPush4(codeHex) {
  const b = hexToBytes(codeHex);
  const found = new Set();
  for (let i = 0; i < b.length; i++) {
    const op = b[i];
    if (op === 0x63) {                    // PUSH4
      if (i + 4 < b.length) found.add('0x' + toHex(b.slice(i + 1, i + 5)));
      i += 4;
    } else if (op >= 0x60 && op <= 0x7f) {
      i += op - 0x5f;                     // skip PUSH1..PUSH32 immediates
    }
  }
  return [...found].sort();
}

/** Addresses embedded as PUSH20 immediates — hard-coded dependencies. */
export function extractPush20(codeHex) {
  const b = hexToBytes(codeHex);
  const found = new Set();
  for (let i = 0; i < b.length; i++) {
    const op = b[i];
    if (op === 0x73) {                    // PUSH20
      if (i + 20 < b.length) found.add('0x' + toHex(b.slice(i + 1, i + 21)));
      i += 20;
    } else if (op >= 0x60 && op <= 0x7f) {
      i += op - 0x5f;
    }
  }
  return [...found].filter((a) => !/^0x0+$/.test(a)).sort();
}

// ------------------------------------------------------------- proxy slots

export const SLOTS = {
  // EIP-1967
  'eip1967.implementation': '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
  'eip1967.admin':          '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103',
  'eip1967.beacon':         '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50',
  // EIP-1822 UUPS
  'eip1822.proxiable':      '0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7',
  // OpenZeppelin legacy (pre-1967)
  'oz.legacy.impl':         '0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3',
  'oz.legacy.admin':        '0x10d6a54a4754c8869d6886b5f5d7fbfa5b4522237ea5c60d11bc4e7a1ff9390b',
};

/** Read every known proxy slot; returns only the non-zero ones. */
export async function readProxySlots(address) {
  const out = {};
  for (const [name, slot] of Object.entries(SLOTS)) {
    const v = await rpcOk('eth_getStorageAt', [address, slot, 'latest']);
    if (v && !isZeroWord(v)) out[name] = { slot, word: v, asAddress: wordToAddress(v) };
  }
  return out;
}

export { keccak256, keccakHex, selector, toHex, utf8 };

// ------------------------------------------------- block times & log scans

const blockTimeCache = new Map();

/** Timestamp (unix seconds) for a block number, memoised. */
export async function blockTime(n) {
  if (blockTimeCache.has(n)) return blockTimeCache.get(n);
  const b = await rpcOk('eth_getBlockByNumber', [numToHex(n), false]);
  const ts = b ? toNum(b.timestamp) : null;
  blockTimeCache.set(n, ts);
  return ts;
}

/** Measured seconds-per-block, from two blocks far apart. */
export async function measureBlockTime(head, back = 100000) {
  const lo = Math.max(1, head - back);
  const [tHead, tLo] = [await blockTime(head), await blockTime(lo)];
  if (tHead == null || tLo == null || head === lo) return null;
  return { head, lo, tHead, tLo, secondsPerBlock: (tHead - tLo) / (head - lo) };
}

/**
 * Scan eth_getLogs backwards from `head` in adaptive chunks until `want`
 * logs are collected or `maxBack` blocks are covered. Shrinks the window
 * when the node rejects a range, which is how public RPCs signal a cap.
 * Returns { logs, scannedFrom, scannedTo, windows, truncated }.
 */
export async function scanLogsBack(filter, { head, want = 400, maxBack = 2000000, chunk = 20000, onProgress } = {}) {
  const logs = [];
  const floor = Math.max(0, head - maxBack);
  let to = head, cur = chunk, windows = 0, truncated = false, shrinks = 0;
  // Largest window the node has actually accepted. Without this the scanner
  // ratchets down on the first rejection and never recovers, which turns a
  // multi-day scan into millions of tiny windows.
  let bestKnownGood = 0;
  while (to > floor && logs.length < want) {
    const from = Math.max(floor, to - cur);
    const { result, error } = await rpc('eth_getLogs', [{ ...filter, fromBlock: numToHex(from), toBlock: numToHex(to) }], { retries: 1 });
    if (error) {
      if (cur > 500) { cur = Math.max(500, Math.floor(cur / 4)); shrinks++; continue; }
      to = from - 1; truncated = true;
      cur = bestKnownGood || chunk;
      continue;
    }
    windows++;
    bestKnownGood = Math.max(bestKnownGood, cur);
    logs.push(...result);
    if (onProgress) onProgress({ from, to, got: result.length, total: logs.length, window: cur });
    to = from - 1;
    // Creep back toward the requested chunk after a rejection forced us down.
    if (cur < chunk) cur = Math.min(chunk, cur * 2);
  }
  return { logs, scannedFrom: Math.max(floor, to), scannedTo: head, windows, shrinks, truncated };
}

// Keccak-256 (Ethereum, pre-NIST padding 0x01) — dependency-free.
// Verified against known vectors by scripts/selftest.mjs. Do not modify
// without re-running that self-test: selector and topic derivation for
// Tasks B/C/D is load-bearing on it.

const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

const ROT = [
  0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14,
];

const M = (1n << 64n) - 1n;
const rotl = (x, n) => n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & M;

function keccakF(A) {
  for (let round = 0; round < 24; round++) {
    // theta
    const C = new Array(5);
    for (let x = 0; x < 5; x++) C[x] = A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20];
    for (let x = 0; x < 5; x++) {
      const D = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y++) A[x + 5 * y] ^= D;
    }
    // rho + pi
    const B = new Array(25).fill(0n);
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(A[x + 5 * y], ROT[x + 5 * y]);
      }
    }
    // chi
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        A[x + 5 * y] = B[x + 5 * y] ^ (~B[((x + 1) % 5) + 5 * y] & B[((x + 2) % 5) + 5 * y] & M);
      }
    }
    // iota
    A[0] ^= RC[round];
  }
  return A;
}

/** Keccak-256 of a byte array. Returns a 32-byte Uint8Array. */
export function keccak256(bytes) {
  const RATE = 136; // 1088 bits
  const inLen = bytes.length;
  const padLen = RATE - (inLen % RATE);
  const buf = new Uint8Array(inLen + padLen);
  buf.set(bytes);
  buf[inLen] |= 0x01;              // Ethereum/Keccak padding, not SHA3's 0x06
  buf[buf.length - 1] |= 0x80;

  let A = new Array(25).fill(0n);
  for (let off = 0; off < buf.length; off += RATE) {
    for (let i = 0; i < RATE / 8; i++) {
      let lane = 0n;
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(buf[off + i * 8 + b]);
      A[i] ^= lane;
    }
    A = keccakF(A);
  }

  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    let lane = A[i];
    for (let b = 0; b < 8; b++) { out[i * 8 + b] = Number(lane & 0xffn); lane >>= 8n; }
  }
  return out;
}

export const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export const utf8 = (s) => new TextEncoder().encode(s);

/** keccak256 of a utf-8 string, as a 0x-prefixed hex string. */
export const keccakHex = (s) => '0x' + toHex(keccak256(utf8(s)));
/** 4-byte function selector for a canonical signature, e.g. "transfer(address,uint256)". */
export const selector = (sig) => keccakHex(sig).slice(0, 10);
/** 32-byte event topic0 for a canonical event signature. */
export const topic0 = (sig) => keccakHex(sig);

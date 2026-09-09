// Verifies the dependency-free keccak against known vectors. The probe's
// selector and event-topic derivation depends on this being correct.
import { keccakHex, selector, topic0 } from './lib/keccak.mjs';

const VECTORS = [
  ['keccak256("")', keccakHex(''), '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'],
  ['keccak256("abc")', keccakHex('abc'), '0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45'],
  ['selector transfer(address,uint256)', selector('transfer(address,uint256)'), '0xa9059cbb'],
  ['selector balanceOf(address)', selector('balanceOf(address)'), '0x70a08231'],
  ['selector owner()', selector('owner()'), '0x8da5cb5b'],
  ['selector approve(address,uint256)', selector('approve(address,uint256)'), '0x095ea7b3'],
  ['selector totalSupply()', selector('totalSupply()'), '0x18160ddd'],
  ['topic0 Transfer(address,address,uint256)', topic0('Transfer(address,address,uint256)'),
    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'],
  ['EIP-1967 impl slot', '0x' + (BigInt(keccakHex('eip1967.proxy.implementation')) - 1n).toString(16),
    '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'],
];

let failed = 0;
for (const [label, got, want] of VECTORS) {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}\n      got  ${got}${ok ? '' : `\n      want ${want}`}`);
}
console.log(failed ? `\n${failed} vector(s) FAILED` : '\nall vectors pass');
process.exit(failed ? 1 : 0);

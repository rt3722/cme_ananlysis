# Task A — Canonical system map

**Verdict: PASS** (for the seven documented addresses) — with one material gap: **the docs' address list is incomplete.**

**Captured:** 2026-09-09 23:37–23:49 UTC · chain 4663 · head 58,944,748–58,951,542
**Evidence:** `artifacts/snapshots/2026-09-09-map.json`, `artifacts/snapshots/2026-09-09-feed.json`
**Reproduce:** `PROBE=map node scripts/probe.mjs`

## The table

All seven addresses published in README §1 are **live, hold code, and are the ones the
system actually uses** — each cross-checked by calling the others and comparing wiring,
not just by looking them up. **None is a proxy**: every EIP-1967, EIP-1822 and
OpenZeppelin-legacy slot reads zero on all seven.

| Role | Address | Code | solc | Verified | Proxy | Confirmed live by |
|---|---|---|---|---|---|---|
| LaunchpadV4 | `0x741aE845F4F11B43467e7D0be991AD814E6Fc522` | 24,441 B | 0.8.26 | **No** | No | `launchCount()` = **72**; wiring below |
| LaunchRouterV4 | `0x92584892EC2663b1969DffDeB5930e54FC5AAcd1` | 9,009 B | 0.8.26 | **No** | No | Launchpad's `router()` returns it |
| BasketRouterV4 | `0x1ae8E086Daa6Bf7D81F99f08c0f3b755BaaDA348` | 5,430 B | 0.8.26 | **No** | No | Its `router()` returns LaunchRouterV4 |
| $CME | `0xe2324FF2a59F8eCBa8c321c6466e59121C00e795` | 3,248 B | **0.8.35** | **No** | No | `name()` = "Commodity Market Exchange" |
| Buyback | `0x4551E406A80Fd9249e47A5A1A38b7089D9b9C226` | 3,461 B | 0.8.26 | **No** | No | Its `cme()` returns the $CME address |
| CommodityPriceFeed | `0x3B784715e1ecFDC6A59707d5b05e5bc898159ab7` | 7,260 B | 0.8.26 | **No** | No | **538 `PriceUpdated` events in 6 h**; last 61 s before capture |
| Uniswap v4 PoolManager | `0x8366a39CC670B4001A1121B8F6A443A643e40951` | 24,009 B | 0.8.26 | **No** | No | Launchpad's and Buyback's `poolManager()` both return it |

**No doc address is stale.** That is a real (and slightly surprising) result — README §2
warned they might be.

## Addresses the docs do not list

Discovered by reading state rather than documentation. These are production dependencies:

| Address | What it is | How it was found |
|---|---|---|
| `0xe5e702641ea86f4ae6cc3cdaed2b886f976be044` | **v4 hook on the $CME buyback pool** | `poolKey()` on the Buyback contract |
| `0x5fc5360d0400a0fd4f2af552add042d716f1d168` | **USDG** | `usdg()` on LaunchRouterV4 and BasketRouterV4 |
| `0x0bd7d308f8e1639fab988df18a8011f41eacad73` | **WETH** | `weth()` on LaunchRouterV4 |
| `0xb365f2602efa59b876b6dac1cc5c040a67f95c82` | **Operator EOA** — `owner()` of the Launchpad, Buyback *and* Feed, the Feed's `defaultAdmin`, and the sole writer of all 538 feed updates | `owner()` / `defaultAdmin()` / event `topics[2]` |
| `0x338a3b6b0eabc0efdd1aea33e81e57c102158d8c` | **Treasury** | `treasury()` on LaunchpadV4 |
| `0x2bad8182c09f50c8318d769245bea52c32be46cd` | PoolManager `owner()` — **not** the CME operator | `owner()` on the PoolManager |

The `0xe5e7…` hook matters most: a hook is exactly the thing a router has to understand
to trade the pool, and it is not written down anywhere a third party would look.

## Wiring, as the contracts themselves report it

```
LaunchpadV4 ──router()──────────> LaunchRouterV4 ──usdg()──> USDG 0x5fc5360d…
     │                                   └────────weth()──> WETH 0x0bd7d308…
     ├──poolManager()───────────> PoolManagerV4 (owner 0x2bad8182…, not CME)
     ├──treasury()──────────────> 0x338a3b6b…
     └──owner()─────────────────┐
Buyback ──cme()──> $CME         ├─ all three: 0xb365f2602e… (one EOA)
     └──poolManager()──> PoolManagerV4
CommodityPriceFeed ──owner()────┘   defaultAdmin() = same EOA
BasketRouterV4 ──router()──> LaunchRouterV4
```

## Compiler metadata

Six of seven carry a full Solidity CBOR footer with an IPFS hash — recorded in the
snapshot artifact, and the route to source **if the team ever pins those documents**:

| Contract | solc | IPFS multihash (from bytecode footer) |
|---|---|---|
| LaunchpadV4 | 0.8.26 | `0x1220201a5fafd590d8448245261a03d5403076eb0ccad0658c04e04e4ddd18d55515` |
| LaunchRouterV4 | 0.8.26 | `0x1220371d332f6341ad0cd3b9efc78a8af8c3f4ff6c0e4ddec17bdebed579861e34ce` |
| BasketRouterV4 | 0.8.26 | `0x122070ead0940ce369ef9320b3c236914d795d6ef1d9ab3f6cb1d2ed3b0b9b89a772` |
| $CME | 0.8.35 | `0x1220f8f8df1aef409554acec1774e66d855cbdc94f6a3e199a378f5ba9fe2a083266` |
| Buyback | 0.8.26 | `0x122034180cedf092c559eb87a47b57ead4f6b7f58215023f57945b1d9f6fd873346e` |
| CommodityPriceFeed | 0.8.26 | `0x1220aeffe393b385fbfc622b203c3e92f42d6a539f03dc975d5d95a02fec3d96026d` |
| PoolManagerV4 | 0.8.26 | **none** — footer is 10 bytes, solc version only |

Two observations worth carrying forward:

- **$CME is the only contract built with solc 0.8.35**; the other six are all 0.8.26.
  Different build, probably a different time or repo.
- **The PoolManager's footer carries no IPFS hash** while all six CME contracts do.
  Consistent with it being a separately-deployed chain-level Uniswap rather than
  something CME built — as is its different `owner()`.

## Verification status

**Nothing is verified anywhere.**

- **Sourcify:** `check-all-by-addresses` for chain 4663 and the `full_match` metadata
  path both return **HTTP 404 for all seven addresses**. Sourcify was reachable from the
  runner, so this is a real negative, not a transport failure.
- **Blockscout:** could not be read — its REST API answers **HTTP 403** to the runner's
  datacenter IP, both v1 and v2, with and without a browser User-Agent. So this finding
  **is not yet complete**: Blockscout verification status is unconfirmed either way.
  README §2's "unverified at last check" is confirmed for Sourcify and **open** for
  Blockscout.

## Gap vs the end goal

The end goal — "nobody is guessing which contract is the launchpad or the feed" — is met
for the seven documented contracts, and their wiring is now confirmed from chain state.

Two gaps remain:

1. **Blockscout verification status is unread** (403). Needs a non-datacenter egress path
   or an explorer API key.
2. **The published address list is not the whole system.** The `0xe5e7…` hook, USDG and
   WETH are load-bearing and undocumented. Any "official contracts" page that omits the
   hook cannot be used by a terminal to recognise a CME pool — which is Task G's problem
   in miniature.

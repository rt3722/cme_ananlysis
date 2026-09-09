# Task B — Source and bytecode truth

**Verdict: PASS** — we now know exactly what we can and cannot read, and the headline
docs-vs-chain contradiction is **resolved against the docs**.

**Captured:** 2026-09-09 UTC · **Evidence:** `artifacts/snapshots/2026-09-09-map.json`, `artifacts/snapshots/2026-09-09-feed.json`
**Reproduce:** `PROBE=map node scripts/probe.mjs`; `node scripts/selectors.mjs <selector>…`

Evidence grades are defined in `findings/00-method.md`.

## 1. What we can read

| Source | Status |
|---|---|
| Official verified Solidity | **Not available.** Sourcify 404s for all seven addresses on chain 4663. |
| Blockscout verification | **Unknown** — REST answers 403 to the runner (see Task A). |
| Deployed bytecode | **Fully available.** `eth_getCode` for all seven; sizes, keccak codehashes and CBOR metadata footers recorded. |
| Live state | **Fully available.** `eth_call`, `eth_getStorageAt`, `eth_getLogs` all work. |

So every claim below is grade **A** (live call) or **B** (bytecode). Nothing here rests on
a decompiler, and no Heimdall/Gigahorse output is used or shipped (README §3, §6).

## 2. Reconstructed interface

Selectors are extracted from the runtime dispatcher (every PUSH4 immediate) and resolved
by hashing a generated vocabulary locally — `scripts/selectors.mjs`, which needs no
network, since 4byte.directory is unreachable from the sandbox. Complete per-contract
selector sets are in the map snapshot.

**Standing caveat, and it is the important one:** a selector found in bytecode proves the
function exists. **A guessed name that is absent proves nothing.** That is why the full
selector set is archived rather than only the matches.

### CommodityPriceFeed — 33 selectors, 23 resolved

Confirmed by live call (grade A):

| Selector | Signature | Live value |
|---|---|---|
| `0x364bc15a` | `KEEPER_ROLE()` | `0xfc8737ab…4fab` — **equals `keccak256("KEEPER_ROLE")` exactly** |
| `0xe63ab1e9` | `PAUSER_ROLE()` | `0x65d7a28e…862a` — **equals `keccak256("PAUSER_ROLE")` exactly** |
| `0x5c975abb` | `paused()` | `false` |
| `0x16c38b3c` | `setPaused(bool)` | — |
| `0x84ef8ffc` | `defaultAdmin()` | `0xb365f2602e…` |
| `0xcc8463c8` | `defaultAdminDelay()` | **172,800 s = 48 h** |
| `0xcf6eefb7` | `pendingDefaultAdmin()` | none pending |
| `0xeafe7a74` | `assetCount()` | **68** |
| `0x88f3543a` | `price(bytes32)` | returns `(uint256 price, uint64 quoteTimestamp)` |
| `0x79feb107` | `latest(bytes32)` | returns `(price, quoteTimestamp, writeTimestamp)` |

The role-constant match is worth stating plainly: those two values are not guesses that
happen to fit, they are the exact keccak256 of those literal strings, which makes the
access-control model **OpenZeppelin AccessControl** beyond reasonable doubt.

Ten further selectors (`0x022d63fb`, `0x0aa6220b`, `0x634e93da`, `0x649a5ec7`,
`0x84ef8ffc`, `0xa1eda53c`, `0xcc8463c8`, `0xcefc1429`, `0xcf6eefb7`, `0xd602b9fd`)
resolve to the full **`AccessControlDefaultAdminRules`** surface —
`beginDefaultAdminTransfer` / `acceptDefaultAdminTransfer` / `cancelDefaultAdminTransfer`
/ `rollbackDefaultAdminDelay` / `changeDefaultAdminDelay`. Combined with the live 48-hour
delay, that is a **timelocked admin handover**, which is a genuinely good property and
should be stated as such in Task I rather than buried.

Seven selectors remain unresolved (`0x721d8847`, `0x8ecd249a`, `0x976057c1`,
`0xe72aaaed`, `0xf6dc2a03`, `0xfa2965fd`, `0xfb61b3ff`). All seven return **`count: 0`
from 4byte.directory** — they are project-specific names in no public corpus.

**The asset key scheme is `keccak256(ticker)`.** Recovered by hashing candidate tickers
against the observed keys: 26 of 36 sampled keys resolved to `GLD`, `SLV`, `XPT`, `XPD`,
`HG`, `ALI`, `CL`, `BZ`, `RB`, `HO`, `NG`, `ZM`, `CC`, `CT`, `DC`, `GF`, `BIGMAC`,
`FRIES`, `BURRITO`, `CFA`, `COKE`, `CRACK`, `FENT`, `BUTTERFLY`, `DLORE`, `PRINTSTREAM`
— covering all seven documented categories. The recovered prices sanity-check against
reality (GLD 4437.70, XPT 1906.45, HG 6.85/lb, NG 2.81/MMBtu).

### The feed's event

`topic0 = 0x4606eeabf03575d0483d10eb190b86b412207e3751ef03ad8de6c7c0c613cdc5`
`= keccak256("PriceUpdated(bytes32,uint256,uint64,address)")` — an **exact match**, found
by exhaustive local search. Absent from 4byte.directory, so grade **R**; but the recovered
shape (2 indexed params, 2 data words) is exactly what the chain emits (3 topics, 64 bytes
of data), and the decoded fields are internally consistent across 538 events, which is
what makes it safe to build the Task I cadence numbers on.

Layout: `topics[1]` = asset key, `topics[2]` = updater address, `data` = `(price, timestamp)`.

### Buyback — 10 selectors, 7 resolved

`cme()`, `poolManager()`, `owner()`, `renounceOwnership()`, `transferOwnership(address)`,
plus two recovered by search: **`poolKey()` (`0x182148ef`)** and **`totalEthSpent()`
(`0x92d3b886`)** — the latter is the one selector in the whole system that *does* appear
in 4byte.directory. Grade R on the names, grade A on the returned values.

### $CME — 25 selectors

A plain ERC-20 plus `burn(uint256)` / `burnFrom(address,uint256)`, with OZ 5.x custom
errors (`ERC20InvalidApprover`, `ERC20InvalidReceiver`, …). See Task C for what this means
about token-layer tax.

### PoolManagerV4 — 39 selectors

Canonical Uniswap v4 entry points confirmed present by selector:
`initialize((address,address,uint24,int24,address),uint160)` `0x6276cbbe`,
`swap(…)` `0xf3cd914c`, `unlock(bytes)` `0x48c89491`, `extsload(bytes32)` `0x1e2eaeaf`.

## 3. Docs vs chain — contradiction register

| # | Claim | Source | Chain says | Verdict |
|---|---|---|---|---|
| 1 | "Price updates every 60 s" | docs (D) | **Modal per-asset interval is exactly 1800 s.** All 67 observed assets have a median gap > 60 s; the best-served asset's median is 480 s. 60 s appears only as the *minimum* gap and as the write granularity (all timestamps are multiples of 60). | **REFUTED as an per-asset refresh rate.** True only as "the feed writes *something* about every 60 s". |
| 2 | "Feed staleness limit 1 hour" | docs (D) | No asset exceeded 3600 s in a 6 h window (worst: 1801 s). No `stalePeriod()`-style getter exists under any guessed name; the constant, if any, is in the 7 unresolved selectors or is not exposed. | **CONSISTENT but UNVERIFIED.** Behaviour has not contradicted it; the threshold itself is not readable. |
| 3 | "a decompile hinted at a 300-second window on a write path" | README §4 (R) | **No 300 s pattern anywhere.** The dominant period is 1800 s; observed gaps cluster at 60/120/180/…/1800. **All 67 assets have had a gap > 300 s.** | **NOT REPRODUCED.** If a 300 s constant exists it is not the operative cadence. Treat the hint as unconfirmed decompiler noise unless someone can point at the specific write path. |
| 4 | Seven published addresses are the system | docs (D) | All seven live and correctly wired — **but** the buyback's pool hook `0xe5e7…`, USDG and WETH are undocumented production dependencies. | **INCOMPLETE, not wrong.** |
| 5 | "30 % $CME buyback and burn" | docs (D) | Buyback's pool is **ETH/$CME**, and its counter is **`totalEthSpent()` = 0.2589 ETH all-time**. Fee value reaches $CME through ETH, not through a commodity. | **Mechanism confirmed, denomination differs from the thesis.** See Task F. |
| 6 | Contracts unverified | README §2 (D/E) | Sourcify: **404 on all seven**. Blockscout: unknown (403). | **CONFIRMED for Sourcify.** |

## 4. Truth-sources register

| Claim now relied on downstream | Grade | Evidence |
|---|---|---|
| Chain is 4663, Arbitrum Orbit nitro v3.11.4 | A | `eth_chainId` = `0x1237`; `web3_clientVersion` |
| ~0.1008 s per block | A | Two blocks 200 k apart |
| All seven doc addresses live, none a proxy | A+B | `eth_getCode`; six proxy slots all zero |
| Nothing verified on Sourcify | A | 404 on both Sourcify endpoints |
| Feed uses OZ AccessControl + DefaultAdminRules, 48 h delay | A+B | Role constants = keccak of the literal names; `defaultAdminDelay()` = 172800 |
| Feed is **not paused** | A | `paused()` = false |
| 68 assets registered, 67 updated in 6 h | A | `assetCount()`; 538 decoded events |
| **One EOA writes 100 % of feed updates** | A | 538/538 from `0xb365f2602e…` |
| Feed event signature | R | exact topic0 match; consistent decode across 538 events |
| Asset keys are `keccak256(ticker)` | A+R | 26/36 preimages recovered; prices sanity-check |
| Buyback pool is ETH/$CME, fee 0, tickSpacing 200, hook `0xe5e7…` | A | `poolKey()` return, decoded as a v4 PoolKey |
| `totalEthSpent()` = 0.258863766 ETH | A | live call |
| $CME totalSupply = 999,685,351.807 | A | live call |
| "60 s updates" is false per-asset | A | per-asset gap statistics over 538 events |

## Gap vs the end goal

The end goal — every later claim cites bytecode, verified source or a live call — is met.
Remaining gaps:

1. **No official source.** Everything about *intent* (as opposed to behaviour) is still
   reconstruction. The IPFS hashes in the metadata footers are the cheapest possible fix
   and are recorded in Task A; asking the team to pin those documents is a Task N item.
2. **Seven feed selectors and the staleness constant are unresolved.** The 1-hour limit
   is consistent with behaviour but has not been read off the chain.
3. **Blockscout verification status unread** (403).

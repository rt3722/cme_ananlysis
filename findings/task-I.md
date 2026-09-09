# Task I — Keeper, feed, and pause liveness

**Verdict: PASS with two material findings** — the feed *is* live, but the documented
cadence is wrong by a factor of ~30, and the whole thing runs off **one EOA**.

**Snapshot:** 2026-09-09 23:48:50 UTC · head 58,951,542 · 6-hour window (blocks 58,737,256 → 58,951,542)
**Evidence:** `artifacts/snapshots/2026-09-09-feed.json` · **Reproduce:** `PROBE=feed node scripts/probe.mjs`

## Current on-chain status

| Property | Value | How read |
|---|---|---|
| Feed | `0x3B784715e1ecFDC6A59707d5b05e5bc898159ab7` | — |
| **Paused** | **false** | `paused()` |
| Assets registered | **68** | `assetCount()` |
| Assets updated in last 6 h | **67** | 538 decoded `PriceUpdated` events |
| Newest update | **61 s before capture** (2026-09-09 23:47:50 UTC) | event `uint64` timestamp |
| Worst per-asset staleness at capture | **1,741 s (29 min)** — `PRINTSTREAM` | per-asset grouping |
| Worst per-asset gap in window | **1,801 s (30 min)** | per-asset grouping |
| Assets exceeding the 1 h doc limit | **0 of 67** | — |
| Keeper writes in window | **538 of 538 from `0xb365f2602efa59b876b6dac1cc5c040a67f95c82`** | event `topics[2]` |
| Admin | same EOA (`defaultAdmin()`) | — |
| Admin-transfer delay | **172,800 s (48 h)** | `defaultAdminDelay()` |

**The feed was healthy at capture.** No hand-waving needed: last write 61 seconds old,
not paused, nothing past the stale limit.

## Who may write, who may pause

Grade A/B (`findings/task-B.md` §2):

- Access control is **OpenZeppelin `AccessControl` + `AccessControlDefaultAdminRules`**.
  `KEEPER_ROLE()` and `PAUSER_ROLE()` return exactly `keccak256("KEEPER_ROLE")` and
  `keccak256("PAUSER_ROLE")`.
- `setPaused(bool)` exists and `paused()` is live-readable.
- Admin handover is **timelocked at 48 hours** with begin/accept/cancel and a
  rollback for the delay itself. This is a real safety property and the team should get
  credit for it.

**But:** every one of the 538 updates in the window came from a **single address**, and
that address is simultaneously the Feed's `owner()` and `defaultAdmin()`, the Launchpad's
`owner()`, and the Buyback's `owner()`. The role machinery supports several keepers; in
practice there is one key. **If that key stops, the feed stops** — and the 48-hour admin
delay that protects against takeover also means you cannot hand the keeper role to a
replacement quickly under the same key's compromise.

## Actual cadence vs docs

This is the headline. The docs say **"Price updates every 60s."** Measured per asset, over
538 events:

| Statistic | Value |
|---|---|
| Modal per-asset interval | **exactly 1800 s** |
| Assets whose **median** gap exceeds 60 s | **67 of 67** |
| Assets whose **max** gap exceeds 300 s | **67 of 67** |
| Assets whose max gap exceeds 3600 s | **0 of 67** |
| Best-served asset (`NG`) median | 480 s |
| Typical asset | median 1800, min 1800, max 1801 |

The pattern is a **two-tier feed**, which the docs do not describe at all:

- **A small actively-priced tier** — `NG`, `ALI`, `XPD`, `CL`, `BZ`, `XPT`, `RB`, `HO`
  get 11–17 updates in 6 h (medians 480–1321 s). These are the real commodity references.
- **A large fixed-price tier** — most assets get exactly 7 updates in 6 h at a rigid
  1800 s cadence, and many carry **exact round numbers that never move**: `COKE` 100.000,
  `CRACK` 20.000, `FENT` 5.000, and others at 10.000 / 20.000 / 5.000. These are the
  "price index only" assets the docs describe for drugs — but they are still *rewritten*
  every 30 minutes, which is what keeps them inside the staleness window.

**Where the "60 s" figure comes from:** 60 s is the write *granularity*, not the refresh
rate. Every observed timestamp is a multiple of 60, and the feed contract as a whole is
touched roughly once a minute — it just cycles through 68 assets, so any individual asset
waits ~30 minutes. The claim is true about the contract and false about the asset, and
users read it as being about the asset.

The `latest(bytes32)` view returns **`(price, quoteTimestamp, writeTimestamp)`**, with the
write trailing the quote by 8–11 s in every sample. That is the public heartbeat Task I
asks for and it already exists — see the SLO section.

## What users can do if the keeper is down

**Assessed, not fully proven** — the trading paths were not exercised. What is established:

| Keeper down for | What is known |
|---|---|
| 1 h | Every asset is already past its normal 30-min refresh. Any asset whose stale check is 1 h begins to trip. `paused()` stays false — nothing auto-pauses; staleness is enforced (if at all) per read. |
| 8 h | All 68 assets far beyond any plausible stale window. |
| 24 h | Same, compounded. |

**This row of the task is not closed.** The stale threshold is not readable — no
`stalePeriod()`/`maxAge()`/`staleAfter()`/`heartbeat()` selector exists under any guessed
name, and the seven unresolved feed selectors are absent from 4byte.directory. So *what
staleness does* — revert, pause, or nothing — is **not established**, and neither is
whether curve trades, peg exits, migrations or holder payouts keep working. Establishing
it needs either the team's source or a simulated `eth_call` against a stale asset at a
historical block. That is the top follow-up.

## Proposed liveness spec

Written as testable invariants, for Task N.

1. **Who updates.** `KEEPER_ROLE` holders. *Today: exactly one address, which is also the
   admin and the owner of three contracts.* → **Separate the keeper key from the owner
   key, and run at least two keepers.**
2. **How often.** State the truth: **≤ 30 min per asset for index-tier assets, ≤ 10 min
   for actively-priced tier.** Publish per-tier, not one "60 s" number.
   Test: `now - latest(key).quoteTimestamp <= tierBudget` for every registered key.
3. **What stale means.** **Must be made readable.** Add `stalePeriod()` (or per-asset
   `stalePeriod(bytes32)`) as a public view, and document whether a stale read reverts or
   returns a flag. Test: a read of a deliberately-stale key behaves as documented.
4. **What pauses.** `PAUSER_ROLE` via `setPaused(bool)`; `paused()` is public. Nothing
   pauses automatically today. Test: `paused()` agrees with the site's status banner.
5. **How users see it.** `latest(bytes32)` already returns both timestamps — **the site
   should display `now - quoteTimestamp` per asset, sourced from that call**, so an
   8-hour silent feed is visible on-chain and in the UI without trusting either.

## Gap vs the end goal

The end goal — "an 8-hour silent feed is impossible to spin as RPC issues" — is **partly**
met. The heartbeat exists on-chain and is now documented (`latest()`), so anyone can check
independently. What is missing:

1. **The stale threshold is unreadable**, so "the contracts and the UI agree on status"
   cannot be verified — the contract has no status to read beyond `paused()`.
2. **The documented cadence is wrong**, so a user comparing the site's "updates every 60s"
   against a 29-minute-old price will conclude the feed is broken when it is behaving
   normally. That is a disclosure bug that manufactures exactly the distrust §2 describes.
3. **Single-key operation** means feed liveness has no redundancy.

# Task K — Buyback, burn, and holder payouts

**Verdict: PARTIAL — the fee destination is observable, and what it shows is a
buyback that has spent 0.26 ETH in its entire life.**

**Captured:** 2026-09-09 23:48 UTC · **Evidence:** `artifacts/snapshots/2026-09-09-feed.json`
**Reproduce:** `PROBE=buyback node scripts/probe.mjs`

## Current state

| Property | Value | How read |
|---|---|---|
| Buyback | `0x4551E406A80Fd9249e47A5A1A38b7089D9b9C226` | — |
| ETH balance | **0** | `eth_getBalance` |
| $CME balance | **0** | `balanceOf` |
| **`totalEthSpent()`** | **258,863,765,519,700,260 wei = 0.258863766 ETH** | live call |
| `owner()` | `0xb365f2602efa59b876b6dac1cc5c040a67f95c82` — the same operator EOA as the Feed and Launchpad | live call |
| `cme()` | `0xe2324ff2…e795` ✓ | live call |
| `poolManager()` | `0x8366a39c…0951` ✓ | live call |
| Contract size | 3,461 bytes, **10 selectors** | `eth_getCode` |
| **Events emitted** | **none — zero logs from this address in ~280,000 blocks (~7.8 h) scanned** | `eth_getLogs` |

`totalEthSpent()` and `poolKey()` are names recovered by selector search (grade R);
`totalEthSpent()` is the one selector in the whole system that appears in
4byte.directory. The **values** are grade A.

## The buyback pool

`poolKey()` returns a v4 `PoolKey`, decoded:

| Field | Value |
|---|---|
| `currency0` | `0x0000…0000` — **native ETH** |
| `currency1` | `0xe2324ff2a59f8ecba8c321c6466e59121c00e795` — **$CME** |
| `fee` | **0** |
| `tickSpacing` | 200 |
| `hooks` | **`0xe5e702641ea86f4ae6cc3cdaed2b886f976be044`** |

The hook is a genuine hook — not inferred from its bit pattern but from its **position in
the returned `PoolKey`**. Because Uniswap v4 *requires* a hook's address to encode its own
permissions, reading those bits is valid here (and only here, for an address already known
to be a hook):

`0x2044` → **`BEFORE_INITIALIZE | AFTER_SWAP | AFTER_SWAP_RETURNS_DELTA`**

`AFTER_SWAP_RETURNS_DELTA` is the permission that lets a hook take a cut of the swap
output. This hook — a **production contract, 15,167 bytes, absent from the docs** — is the
one that would implement any fee on the $CME pool.

**The buyback pair is ETH, not a commodity and not USDG.** The documented fee story is
"30 % $CME buyback and burn" out of fees denominated in the commodity; the on-chain path
converts to **ETH** and buys $CME with it. That is not a contradiction of the burn claim,
but it does mean the buyback leg of the "commodity economics" thesis is denominated in the
one asset the thesis is meant to avoid. See Task F.

## Burn evidence

`$CME` `_burn` genuinely decrements `totalSupply` (verified in the bytecode —
`artifacts/decompile/CME.annotated.md`), so `totalSupply()` is a truthful cumulative
measure rather than a dead-address balance:

| | |
|---|---|
| `totalSupply()` now | 999,685,351.807 CME |
| Assumed initial supply | 1,000,000,000 CME |
| **Lifetime burned** | **314,648.193 CME — 0.031 %** |
| Lifetime ETH spent buying | **0.2589 ETH** |

⚠️ The 1,000,000,000 initial supply is **assumed, not verified** — the launchpad's own
market tokens use exactly `1e27` as a hard-coded fixed supply, and the docs state 1 B for
launches, but `$CME` is a different contract (solc 0.8.35, not a clone) and its mint is in
its constructor, which is not in the runtime bytecode. **To close this, read the first
`Transfer` from `0x0` in $CME's deployment transaction.** Until then the burn *percentage*
is grade R; the `totalSupply()` value itself is grade A.

## Fee pipeline

```
trade on an official market pool
        │  fee taken by the market hook           [NOT YET CONFIRMED - Task D]
        ▼
   40 % holders (in the commodity)                [NOT CONFIRMED]
   30 % ─────────────────────────────► Buyback 0x4551E4…
        │                                 swaps ETH -> $CME
        │                                 in pool (ETH, $CME, fee 0, ts 200, hook 0xe5e7…)
        │                                 lifetime spend: 0.2589 ETH
        │                                 then burn -> totalSupply decreases
        ▼                                 lifetime burn: 314,648.193 CME
   30 % treasury 0x338a3b6b…              [reached via Launchpad.treasury(), flow NOT traced]
```

**Hops confirmed:** buyback → PoolManager (from `poolManager()` and the `PoolKey`), and
burn → `totalSupply` reduction. **Hops not confirmed:** the 40/30/30 split itself, the
holder payout job, and the treasury flow. None of those are readable from the buyback
contract, because it has only 10 selectors and emits nothing.

## The real finding: this pipeline is unobservable by design

The buyback contract **emits no events at all**. Not "the buyback has been idle" — there
is no event to be idle. The only way to see it work is to diff `totalEthSpent()` or
`totalSupply()` over time, which means:

- Nobody can tell **when** the last buyback ran. There is no last-run timestamp on chain.
- A site that displays "30 % burn" cannot be contradicted by anyone, because the contract
  publishes nothing to contradict it with.
- README §2's complaint — "should be back online shortly" instead of a last-run timestamp
  — is **structurally unfixable without a contract change**.

That is the Task K answer, and it is a change request, not a measurement:
**the buyback must emit an event per run** (`BuybackExecuted(uint256 ethIn, uint256 cmeOut,
uint256 burned, uint256 timestamp)`) and expose `lastRunAt()`. Both are one-line additions
and they convert an unfalsifiable marketing claim into a checkable one.

## Gap vs the end goal

The end goal — "'should be back online shortly' is replaced by a last-run timestamp" — is
**not met and cannot be met with the deployed contracts**.

1. **No last-run timestamp exists** and no event is emitted. Needs a contract change.
2. **The 40/30/30 split is unverified.** It presumably lives in the market hook, which
   Task D must identify first.
3. **The holder payout job is entirely untraced** — trigger, asset paid, and who can poke
   it if the operator is offline are all unknown.
4. **The initial-supply assumption** behind the burn percentage needs the deployment tx.

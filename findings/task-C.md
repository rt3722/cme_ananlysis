# Task C — Token tax vs pool tax

**Verdict: PASS on the token layer — and the answer is unambiguous.**
**Neither `$CME` nor any launched market token takes a tax at the ERC-20 layer.**
Every "high-tax CME token" report is therefore about a **pool**, not the token.

**Captured:** 2026-09-09/10 UTC · chain 4663
**Evidence:** `artifacts/bytecode/`, `artifacts/decompile/`, `artifacts/snapshots/2026-09-09-map.json`

## The single most useful fact

**All 72 launched markets share one codehash:**
`0xa59f733a81e56b724a7843cc1cf74189e74642f70aa133b3ef94096a43df900b`
(`launchCount()` = 72; every record's token queried individually; histogram has exactly
one entry).

They are **EIP-1167 minimal-proxy clones**. The launch path in the LaunchpadV4 runtime
contains the clone creation code verbatim —

```
3d602d80600a3d3981f3363d3d373d3d3d363d73 <impl> 5af43d82803e903d91602b57fd5bf3   … CREATE
```

— with `<impl>` = **`0x4acd728a45c3fe656ddc15ad7e734f69d6146748`**, the market-token
implementation (3,199 bytes, solc 0.8.26).

**So "is a CME market token taxed?" is one question, not 72.** Analysing the
implementation settles every market that exists and every market that will exist until
the launchpad's immutable changes.

> Earlier in this session I briefly read `0x4acd728a…` as a Uniswap v4 hook because its
> low 14 bits decode to a plausible permission set. That was wrong, and the correction
> matters: **you cannot read hook flags off an arbitrary address** — every address has low
> bits. The clone creation code is what identifies it.

## Market token — classified UNTAXED

Full surface, from `eth_getCode` and confirmed by an independent heimdall decompile
(`artifacts/decompile/market-token/`):

| | |
|---|---|
| Functions | 13 total: `name` `symbol` `decimals` `totalSupply` `balanceOf` `allowance` `transfer` `transferFrom` `approve` `initialize(string,string,string,address)` + three getters |
| Events | exactly 2 — `Transfer`, `Approval` |
| **Not present** | no `mint`, no `burn`, no `owner`, no pause, no fee/bps constant, no fee recipient, no exclusion mapping, no blacklist |
| Supply | `0x033b2e3c9fd0803ce8000000` = **1,000,000,000 × 1e18, fixed**, minted once in `initialize` — matches the documented 1B fixed supply |

The transfer path, read two independent ways. Hand-read from the opcodes:

```
balance[from] -= value        ; 855f52600584520360405f2055
balance[to]   += value        ; 845f526005825260405f20818154019055   (SLOAD ADD SWAP1 SSTORE)
emit Transfer(from, to, value) ; a3  -- one LOG3, nothing else
```

and heimdall's reconstruction of the same function, arrived at independently:

```solidity
require(arg0, CustomError_d92e233d());                    // to != 0
require(balance[msg.sender] >= arg1, CustomError_f4d678b8());
balance[msg.sender] -= arg1;
balance[arg0]       += arg1;
emit Event_ddf252ad(msg.sender, arg0, arg1);              // Transfer
return 0x01;
```

**Same value debited and credited, one log, no fee arithmetic.** Verdict: **untaxed**.

### One thing holders should know: the operator allowance bypass

`transferFrom` does *not* simply check `allowance`. When the allowance is insufficient it
makes an external call before reverting:

```
staticcall(launchpad, 0x67ead7a3(msg.sender)) -> bool
    true  => skip the allowance check entirely and transfer
    false => revert 0x13be252b (insufficient allowance)
```

Slot 3 holds the launchpad address; `0x67ead7a3` is a real LaunchpadV4 selector that reads
a `mapping(address => bool)` at storage slot 7 and is set by an admin function emitting
`0x1439bb00e871a94fcee9c5d13e8786e3cd8f19f3b529227b0ee4caf209203999`.

**Consequence:** any address the launchpad marks as an operator can move **any holder's
market tokens with no approval**. That is not a tax, and it is a normal design for a
launchpad that must move curve inventory — but it is an unadvertised trust assumption
that belongs in user-facing disclosure, and it is worth stating plainly in Task N.

## `$CME` — classified UNTAXED

Full annotated reconstruction: `artifacts/decompile/CME.annotated.md`. Summary:

- 25 selectors, all accounted for: stock ERC-20 + `burn`/`burnFrom` + OZ 5.x custom errors
  + four metadata getters + three immutable addresses.
- Recipient credited with the same stack item the sender is debited; exactly one `LOG3`;
  no fee slot, bps constant or exclusion mapping in 3,248 bytes.
- `_burn` decrements `totalSupply` (`80 600254 03 600255`), so `totalSupply()` is a
  truthful lifetime-burn measure: **314,648.193 CME burned (0.031 % of 1B)**.

Two undocumented immutables surfaced: `0xa0a603821aee32b40f9ac4ed0dfd631fba431b5f`
(`curve()` by selector search, grade R) and `0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e`.

## What this means for the user complaint

The complaint is *"CME tokens are high-tax."* On the evidence, at the token layer that is
**false for every CME token that exists**. The tax users experience is imposed by the pool
they get routed into — either its hook, or simply a near-empty pool whose price impact
eats the trade. Which pool a paste-CA swap actually hits is Task D.

The practical form of the answer a terminal needs is therefore **not** "is this token
taxed" but **"which pool is the official one"** — a question about pools, and one the
chain currently gives no authoritative way to answer. That is Task G.

## Gap vs the end goal

Task C's done-when asks for "at least 5 user-complained tokens with an official-vs-hostile
pool table" plus a `$CME` classification.

- **`$CME` classified: done.** Untaxed, with evidence.
- **Market tokens classified: done, and stronger than asked** — one codehash covers all 72,
  so the classification is exhaustive rather than a 5-token sample.
- **The official-vs-hostile pool table is NOT done.** It needs the pool census in Task D,
  which is still running at the time of writing. The blocker is honest: the official hook
  address is not yet established, because the one address I initially took for it turned
  out to be the clone implementation. It must be read off the `PoolKey` in the `Initialize`
  events of markets that actually migrated — not inferred.

# `$CME` — annotated reconstruction from runtime bytecode

> **THIS IS A RECONSTRUCTION, NOT AUTHOR SOURCE.** It is derived by reading the
> runtime bytecode returned by `eth_getCode`. It is **not** CME's repository, not a
> verified Blockscout source tab, and not Sourcify output — none of those exist for this
> contract. Do not present it as official source (README §3, §6).

## Provenance

| | |
|---|---|
| Address | `0xe2324FF2a59F8eCBa8c321c6466e59121C00e795` (from commodites.market/docs, **treated as a hypothesis and then confirmed on chain**) |
| Source of bytes | `eth_getCode` on Robinhood Chain **4663**, RPC `https://rpc.mainnet.chain.robinhood.com` |
| Raw dump | `artifacts/bytecode/CME.hex` — 3,248 bytes, starts `0x6080604052…` |
| Integrity | keccak256 of the fetched bytes = `0xc714be92376dbbf4fdadccd16a1c49a5e0c41463e7c704b76770bde1d6240fb7`, **matching the codehash recorded independently during the map run** |
| Compiler | solc **0.8.35** per the CBOR footer (`…64736f6c634300082 3 0033`), IPFS `0x1220f8f8df…83266` |
| Verified anywhere? | **No.** Sourcify 404. Blockscout unreadable from the runner (403). |

## Public interface (25 selectors, all accounted for)

Standard ERC-20:

| Selector | Signature |
|---|---|
| `0x06fdde03` | `name()` → `"Commodity Market Exchange"` |
| `0x95d89b41` | `symbol()` → `"CME"` |
| `0x313ce567` | `decimals()` → `18` |
| `0x18160ddd` | `totalSupply()` → `999685351807335209822007281` |
| `0x70a08231` | `balanceOf(address)` |
| `0xdd62ed3e` | `allowance(address,address)` |
| `0xa9059cbb` | `transfer(address,uint256)` |
| `0x23b872dd` | `transferFrom(address,address,uint256)` |
| `0x095ea7b3` | `approve(address,uint256)` |
| `0x42966c68` | `burn(uint256)` |
| `0x79cc6790` | `burnFrom(address,uint256)` |

OpenZeppelin 5.x custom errors (confirmed by the revert stubs they compile to):

`0x391434e3` `ERC20InsufficientBalance` · `0x7dc7a0d9` `ERC20InsufficientAllowance` ·
`0x4b637e8f` `ERC20InvalidSender` · `0xec442f05` `ERC20InvalidReceiver` ·
`0x4a1406b1` `ERC20InvalidSpender` · `0xe602df05` `ERC20InvalidApprover` ·
`0x4e487b71` `Panic(uint256)`

Immutables and metadata getters — **three embedded addresses**, each returned by a
`PUSH32`-immediate getter:

| Selector | Returns | Note |
|---|---|---|
| `0xd5f39488` | `0xb365f2602efa59b876b6dac1cc5c040a67f95c82` | the operator EOA — same key that owns the Launchpad/Buyback/Feed and writes every price update |
| `0x7165485d` | `0xa0a603821aee32b40f9ac4ed0dfd631fba431b5f` | **undocumented**; name resolves to `curve()` by selector search (grade R) |
| `0x536dac9b` | `0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e` | **undocumented** |
| `0x53cd512a`, `0xabb1dc44`, `0x7284e416`, `0xfb7f21eb` | string bundles from storage slots 3–11 | metadata (name/symbol/description/socials) |

## The transfer path — the part that matters for Task C

This is the internal `_transfer(from, to, value)` reached by both `transfer` and
`transferFrom`. Reconstructed opcode-by-opcode:

```
_transfer(from, to, value):
    if (to   == 0) revert ERC20InvalidReceiver(0)       ; 63ec442f05..5ffd
    if (from == 0) revert ERC20InvalidSender(0)         ; 634b637e8f..5ffd

    bal = balance[from]
    if (bal < value)
        revert ERC20InsufficientBalance(from, bal, value)   ; 391434e3

    ; balance[from] = bal - value
    ;   85 5f52 5f84 52 03 6040 5f20 55
    ;   DUP6 PUSH0 MSTORE PUSH0 DUP5 MSTORE SUB PUSH1 40 PUSH0 SHA3 SSTORE

    ; balance[to] = balance[to] + value
    ;   84 5f52 5f82 52 6040 5f20 81 81 54 01 90 55
    ;                          ... DUP2 DUP2 SLOAD ADD SWAP1 SSTORE
    ;                                          ^^^^ ^^^ credited with the SAME
    ;                                                   stack item that was debited

    emit Transfer(from, to, value)                      ; topic ddf252ad…b3ef, a3 = 3 topics
```

**Verdict: `$CME` takes no tax at the token layer.** The evidence is direct, not an
argument from absence:

1. The recipient is credited with the **same stack value** that the sender is debited —
   `SLOAD ADD SWAP1 SSTORE` on `value`, with no intervening arithmetic.
2. There is **exactly one `LOG3` in the path**. A fee-taking token needs a second
   `Transfer` to a fee sink, or it breaks every indexer; there is no second log.
3. There is **no fee-recipient storage slot, no bps constant, no exclusion mapping** in
   the entire 3,248-byte runtime.
4. `approve` and `allowance` are stock; `transferFrom` spends allowance via a standard
   `_spendAllowance` with the `type(uint256).max` infinite-approval shortcut
   (`5f198410` = `PUSH0 NOT DUP5 GT`), then calls the same `_transfer`.

The burn path is likewise honest:

```
burn(value)     -> _burn(msg.sender, value)
burnFrom(a,v)   -> _spendAllowance(a, msg.sender, v); _burn(a, v)

_burn(from, value):
    if (from == 0) revert ERC20InvalidSender(0)
    bal = balance[from]
    if (bal < value) revert ERC20InsufficientBalance(from, bal, value)
    balance[from] = bal - value
    totalSupply   = totalSupply - value     ; 80 600254 03 600255  (SUB then SSTORE slot 2)
    emit Transfer(from, 0, value)
```

`totalSupply` really is decremented — burns are not transfers to a dead address, so
`totalSupply()` is a truthful cumulative-burn measure. Against a 1,000,000,000 initial
supply that puts lifetime burns at **314,648.193 CME (0.031 %)**.

## What this does *not* tell you

`$CME` being untaxed says nothing about **the pools** it trades in, and nothing about the
**launched market tokens**, which are different contracts entirely. A hostile pool taxes
through its hook or its price, not through the ERC-20 — which is exactly the distinction
Task C exists to draw. See `findings/task-C.md`.

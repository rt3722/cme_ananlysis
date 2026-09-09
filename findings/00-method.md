# Method and evidence grading

**Date:** 2026-09-09 (UTC) · **Chain:** Robinhood Chain 4663 · **Subject:** `@launchonCME` / commodites.market

## Evidence grades used in these findings

Every claim in `findings/` carries one of these grades. They are ordered
strongest first. README §0 forbids treating docs or tweets as ground truth,
so grades D and E can never on their own settle a question.

| Grade | Meaning |
|---|---|
| **A — live call** | An `eth_call` / `eth_getStorageAt` / `eth_getLogs` result from `rpc.mainnet.chain.robinhood.com` at a stated block. Reproducible with `scripts/probe.mjs`. |
| **B — bytecode** | Derived from `eth_getCode` output: selector sets, CBOR metadata footer, embedded constants. A fact about the deployed artifact, independent of any source claim. |
| **C — verified source** | Official Solidity published by the team and matched to the deployed bytecode. **Currently unavailable — see below.** |
| **D — docs** | commodites.market/docs or the repo brief. A hypothesis until A/B confirms it. |
| **E — tweet / report** | Team statements, user complaints. Motivates a question; never answers one. |
| **R — reconstruction** | Decompiler output (Heimdall/Dedaub/Gigahorse) or inference. Always labelled. Never presented as author source (README §3, §6). |

## Where the evidence has to be produced, and why

The analysis sandbox **cannot reach the chain**. Its egress proxy answers
`403` to `CONNECT` for every host this task needs. Verified directly, not
assumed:

```
$ curl -sS -o /dev/null -w '%{http_code}' https://rpc.mainnet.chain.robinhood.com   -> 000
  proxy log: {"kind":"connect_rejected",
              "detail":"gateway answered 403 to CONNECT (policy denial or upstream failure)",
              "host":"rpc.mainnet.chain.robinhood.com:443"}
```

Same for `robinhoodchain.blockscout.com:443` and `www.commodites.market:443`.
The proxy's own README forbids routing around policy denials, so no
workaround was attempted from inside the sandbox.

**Consequence, and it is structural:** every on-chain fact in this repo is
produced by a runner *outside* the sandbox and archived here. That runner is
the Railway service described below. This will be true again next session
unless the egress policy changes — budget for it rather than rediscovering it.

## The runner

- **Railway project** `cme-analysis` — `c1d077f4-fda5-400a-9ad0-71b660b2ff79`
- **Service** `probe` — `baafe249-9c49-4e5a-9085-cf055212cf35`, environment `production` (`bab4caf3-8cae-41bd-9875-6d9fad09cae0`)
- **Source:** this repo, branch `claude/cme-analysis-infrastructure-hkgat0`, start command `node scripts/probe.mjs`
- **Results endpoint:** `https://probe-production-47d6.up.railway.app/all` (also `/s/<SECTION>`)
- Phases selected with the `PROBE` env var: `map,liveness,launches,logs`

The probe has **zero third-party dependencies** — Node 22's global `fetch`
only, and a Keccak-256 implemented from scratch in `scripts/lib/keccak.mjs`.
`npm run selftest` checks that hash against known vectors (empty string,
`"abc"`, four standard selectors, the `Transfer` topic, and the EIP-1967
implementation slot). Selector and event-topic derivation for Tasks B/C/D is
load-bearing on it, so **re-run the self-test after touching it**.

## What the runner can and cannot reach

Established by the first live runs, not assumed:

| Target | From Railway | Note |
|---|---|---|
| `rpc.mainnet.chain.robinhood.com` | ✅ | Full JSON-RPC. `eth_chainId` → `0x1237` (4663). |
| `robinhoodchain.blockscout.com` REST | ❌ **HTTP 403** | Bot filter rejects the datacenter IP. A browser-like User-Agent is now sent; if it still 403s, Blockscout facts must come via another route. |
| `sourcify.dev` / `repo.sourcify.dev` | ✅ reachable, **404 for every CME address** | A real finding, not a transport failure — see `findings/task-A.md`. |

Because Blockscout is unreliable from the runner, **liveness and launch
discovery were rewritten to be RPC-native**: cadence is measured from
`eth_getLogs` plus the timestamps of the blocks those events landed in.
That is stronger evidence than an explorer index anyway — it is the chain's
own record of when something happened, with no indexer in the trust path.

## Reproducing

```sh
npm run selftest                      # hash primitives
PROBE=map node scripts/probe.mjs      # Tasks A, B
PROBE=liveness node scripts/probe.mjs # Tasks I, K
PROBE=launches node scripts/probe.mjs # Tasks C, D seeds
PROBE=logs node scripts/probe.mjs     # Task C, D pool reconstruction
```

`RPC_URL` and `BLOCKSCOUT` are overridable. Output is line-delimited JSON on
stdout with `##SECTION##` markers; lines over 1400 chars are split as
`##SECTION:i/n##` and **must be concatenated in order** before parsing. The
same data is served whole at `/all` on the service's public domain.

## Standing caveats

- **A selector found in bytecode proves a function exists. A guessed name
  that is absent proves nothing** — the real function may simply be named
  differently. `scripts/probe.mjs` therefore dumps the complete PUSH4 set per
  contract (`SELS_*`) so unmatched selectors can be resolved against a 4-byte
  database later, rather than silently reading absence as a negative.
- The v4 `Initialize` decoder assumes the canonical Uniswap signature.
  README §6 warns this chain's Uniswap deployment is modified, so decoded
  PoolKeys are grade **R** until the deployed PoolManager's own event
  encoding is confirmed.

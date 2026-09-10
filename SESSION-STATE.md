# Session state — CME analysis

**Updated:** 2026-09-10 00:30 UTC · **Branch:** `claude/cme-analysis-infrastructure-hkgat0`
**Session:** https://claude.ai/code/session_01XKcrrDE6AmaZQ3c1V3vcm1

Read this first, then `findings/00-method.md`. Everything below is pushed to this repo.

---

## 1. The headline result

**Of 72 launched CME markets, ZERO have an official Uniswap v4 pool.**

Across **71,413** chain-wide v4 pools in a 4,000,000-block window (~4.7 days, longer than
any market has existed), exactly **3** reference a CME market token. **None carries a
hook.** Their fees are **20%**, **90%** and **99.369%**.

So the user complaint — "terminals route into high-tax pools" — is confirmed, and the
cause is sharper than the README assumed. It is not mainly that the official pool is hard
for routers to index. **It is that for essentially every CME market there is no official
pool at all**, because migration requires a $35,000 cap and nothing has reached it. The
only pools that exist for these CAs are hostile ones, so any router that finds anything
finds those.

## 2. What is established (all pushed)

| Doc | Verdict |
|---|---|
| `findings/00-method.md` | Evidence grades A–E/R; why evidence must be produced off-sandbox |
| `findings/task-A.md` | **PASS.** All 7 doc addresses live, none a proxy, wiring confirmed. Doc list is incomplete — hook `0xe5e7…`, USDG, WETH undocumented. Nothing verified on Sourcify. |
| `findings/task-B.md` | **PASS.** Docs' "60s updates" **refuted**; the 300s decompile hint **not reproduced**. Truth-source register. |
| `findings/task-C.md` | **PASS.** Neither `$CME` nor any market token is taxed at the token layer — proven two independent ways. |
| `findings/task-I.md` | **PASS w/ findings.** Feed live but modal per-asset interval is **1800s**, not 60s. One EOA writes 100% of updates. |
| `findings/task-K.md` | **PARTIAL.** Buyback has spent **0.2589 ETH lifetime**, emits **no events at all** — pipeline is unobservable by design. |
| `artifacts/decompile/CME.annotated.md` | Annotated `$CME` reconstruction from bytecode |
| `artifacts/decompile/market-token/` | heimdall decompile + ABI of the market-token implementation |
| `artifacts/bytecode/` | Verified runtime bytecode dumps |
| `artifacts/snapshots/` | Dated JSON evidence for each run |

### Key addresses beyond the README's seven

| Address | What | How found |
|---|---|---|
| `0x4acd728a45c3fe656ddc15ad7e734f69d6146748` | **Market-token implementation** (EIP-1167 clone target for all 72) | launch path bytecode |
| `0xe5e702641ea86f4ae6cc3cdaed2b886f976be044` | **Hook on the $CME buyback pool** (15,167 B, undocumented) | `Buyback.poolKey()` |
| `0xe066bf07e29f5f80f24c4b6f77dee6b97f4a5000` | Launchpad immutable used in the migrate path — **role unconfirmed** | launchpad bytecode |
| `0xb365f2602efa59b876b6dac1cc5c040a67f95c82` | **Operator EOA** — owner of Launchpad+Buyback+Feed, sole feed writer | live calls |
| `0x338a3b6b0eabc0efdd1aea33e81e57c102158d8c` | Treasury | `Launchpad.treasury()` |
| `0x5fc5360d0400a0fd4f2af552add042d716f1d168` | **USDG — an EIP-1967 proxy** (170 B, upgradeable) | `LaunchRouter.usdg()` |
| `0x0bd7d308f8e1639fab988df18a8011f41eacad73` | WETH | `LaunchRouter.weth()` |

### Corrections made during the session (do not re-derive)

1. `0x4acd728a…` is **not** a v4 hook. Its low bits happen to decode to a plausible
   permission set; it is the **clone implementation**. Never read hook flags off an
   arbitrary address — only off one already known to be a hook (v4 enforces the encoding
   there, which is why the `0xe5e7…` read *is* valid).
2. Launch-record `word2` is the **creator**, not the pair coin. Most have no code; several
   are 23-byte **EIP-7702 delegation designators** (`0xef0100 || address`).
3. The **pair coin is still unlocated** in the launch record. The launchpad holds a
   `pairCoins` array (storage slot 8, admin setter `0x3ca786c3`, event
   `0x91d53b4402c08001c9ebc69e87899ebbefd9b798f1e5cf481e463b2d328dba3e`) and each launch
   stores a `uint16` index into it, packed with other `uint16`s in the record's second
   word. **Resolving that index → address is the top follow-up for Task F/H.**

## 3. Infrastructure

**The analysis sandbox cannot reach the chain** — the egress proxy 403s `CONNECT` to the
RPC, Blockscout and commodites.market. It *can* reach npm/PyPI/crates.io and github.com.
So: the probe runs on Railway; results come back via Railway logs and via Exa fetching the
service's public URL.

| Thing | Value |
|---|---|
| Railway project `cme-analysis` | `c1d077f4-fda5-400a-9ad0-71b660b2ff79` |
| Environment `production` | `bab4caf3-8cae-41bd-9875-6d9fad09cae0` |
| Service `probe` | `baafe249-9c49-4e5a-9085-cf055212cf35` |
| Source | this repo + branch, start command `node scripts/probe.mjs` |
| Results URL | `https://probe-production-47d6.up.railway.app/` (`/all`, `/s/<SECTION>`, `/code/<name-or-0xaddress>`) |

**Every push auto-redeploys and restarts the probe**, so batch edits before pushing.
Phases: `PROBE=map,liveness,launches,logs,feed,buyback,tax,markets`.

Local tooling that works: **heimdall 0.9.2** (`cargo install --git
https://github.com/Jon-Becker/heimdall-rs --locked heimdall-cli` — note the crate is
`heimdall-cli`; plain `heimdall` on crates.io is an unrelated package). Panoramix will not
build on Python 3.11. Gigahorse untried (needs Soufflé).

## 4. Next session — do these in order

1. **Fetch `POOLS_DETAIL`** from the results URL. It names the 3 hostile pools' tokens,
   fee, block and tx hash. It was mid-redeploy when this session ended. That completes the
   Task C/D official-vs-hostile table.
2. **Widen the pool census beyond v4.** The census covers only PoolManager
   `0x8366a39c…`. Check for a v3 factory / other venues before asserting a token has no
   pool anywhere.
3. **Resolve the pair-coin index** (see correction 3). Needed for Tasks F and H — the
   commodity-hop question cannot be answered without it.
4. **Write `findings/task-D.md`** — the material is already gathered; it needs the pool
   detail from step 1.
5. **Then Tasks E, F, G, N.** Task N's asks that are already evidence-backed:
   - Buyback must emit a per-run event + `lastRunAt()` (Task K — currently unfalsifiable).
   - Feed must expose the stale threshold as a view, and docs must state per-asset tiers,
     not "60s" (Task I).
   - Separate the keeper key from the owner key; run ≥2 keepers (Task I).
   - Disclose the market-token operator allowance bypass (Task C).
   - Publish the hook addresses and pin the metadata IPFS hashes (Tasks A/B).
6. **Open questions worth one call each:** `$CME` initial supply (read the first
   `Transfer` from `0x0` in its deployment tx) to firm up the burn percentage; Blockscout
   verification status (needs non-datacenter egress).

## 5. Honest status against README §5

Nothing in §5 is yet satisfied. Points 3 (observable liveness) and 5 (labelled
reconstruction) now have real evidence behind them. Point 1 — official market discoverable
at the moment the CA is public — is not merely unmet, it is **further from met than the
README assumed**: there is no official market for any launched token at all.

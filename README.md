# CME (Commodity Market Exchange) — Claude Code Task Brief

**Repo:** https://github.com/rt3722/cme_ananlysis  
**Subject:** `@launchonCME` / [commodites.market](https://www.commodites.market) on **Robinhood Chain (chain ID 4663)**  
**Not:** CME Group, the Chicago derivatives exchange.

This file is the working brief for Claude Code. It states **what must be accomplished** and **what done looks like**. It does not prescribe implementation methods. Infer methods from the chain, the docs, and the live contracts.

---

## 0. How to use this repo

Work through the tasks in order unless a later task is blocked on an earlier one. For every task, leave behind:

1. A short written verdict (pass / fail / blocked).
2. Evidence (tx hashes, storage reads, pool keys, screenshots of official UI, explorer links).
3. A clear statement of the remaining gap vs the **end goal**.

Do not treat project docs or tweets as ground truth until they match on-chain behavior.

---

## 1. What this product is

CME is a token launchpad on Robinhood Chain. New tokens are meant to be **quoted in commodity-tracking ERC-20s** (gold, energy, ag, novelty units, etc.), not WETH/USDG.

Documented intended lifecycle:

- Launch: 1B fixed supply, virtual bonding curve, open cap **$5,000** in the pair coin.
- Graduate: **$35,000** cap → locked Uniswap v4 pool. Liquidity claimed non-withdrawable.
- Fees: creator-chosen 1–3%. Split intended as **40% holders in the commodity**, **30% $CME buyback/burn**, **30% treasury**.
- Commodity coins: synthetic pegs via on-chain feed + single-sided Uniswap v3 vs USDG, maintained by a keeper.
- Baskets: up to 5 commodities; after migration, legs become independent pools.

Published addresses (docs). Confirm they are still the live ones before trusting them:

| Role | Address |
|---|---|
| LaunchpadV4 | `0x741aE845F4F11B43467e7D0be991AD814E6Fc522` |
| LaunchRouterV4 | `0x92584892EC2663b1969DffDeB5930e54FC5AAcd1` |
| BasketRouterV4 | `0x1ae8E086Daa6Bf7D81F99f08c0f3b755BaaDA348` |
| $CME | `0xe2324FF2a59F8eCBa8c321c6466e59121C00e795` |
| Buyback | `0x4551E406A80Fd9249e47A5A1A38b7089D9b9C226` |
| Commodity price feed | `0x3B784715e1ecFDC6A59707d5b05e5bc898159ab7` |
| Uniswap v4 PoolManager | `0x8366a39CC670B4001A1121B8F6A443A643e40951` |

Explorer: https://robinhoodchain.blockscout.com  
Site / docs: https://www.commodites.market / https://www.commodites.market/docs

---

## 2. What we are trying to fix

Users cannot safely trade CME-launched tokens where they actually trade (FOMO and other RHC terminals). The official market is an **internal curve**, then a **commodity-quoted hooked v4 pool**. Third-party routers do not know that pool. Attackers create **high-tax WETH/USDG pools** against the same token CA. Terminals warn or route into the fake pool.

Secondary failures:

- Keeper / price feed / buyback going idle (users reported multi-hour gaps).
- First-party “live markets” UI and RPC regressions.
- Commodity pegs that are inventory-limited synthetics, not reserved commodities.
- Team position (“other apps should add commodity routes”) vs chain reality (apps route WETH/USDG pools they already understand).
- Contracts were **unverified** on Blockscout and Sourcify at last check. Heimdall pseudo-source is not the official repo.

Reference product that already solved discovery on this chain: **Pons** — official Uniswap pool exists at mint, quoted in an asset terminals can swap. Pons users buy Pons tokens on third-party apps. CME users are told to buy only on the CME website.

**Product tension to resolve, not ignore:** commodity denomination is the thesis; terminal distribution is how RHC volume works. The end state must keep commodity economics **and** make the official market the one routers find.

---

## 3. Non-goals

- Do not build a price-prediction or trading bot.
- Do not design attacks, honeypot-pool recipes, or tax-pool constructors.
- Do not impersonate the CME team or ship changes to their live contracts (we do not control those keys).
- Do not treat Heimdall / Dedaub / Gigahorse output as author source.
- Do not conflate this project with CME Group.

If a fix requires a protocol upgrade only the team can deploy, the deliverable is a **precise change request** with acceptance tests the team can run — not a pretend mainnet patch.

---

## 4. Tasks

### Task A — Canonical system map

**Accomplish:** A single, dated inventory of every live CME contract, token, commodity coin, hook, router, feed, and buyback used in production.

**Achieve:**

- Each address verified against the current site/docs and against recent successful launch/trade/migration txs.
- Proxy vs implementation called out if any.
- Compiler metadata recorded (solc version, IPFS hash from bytecode footer).
- Verification status on Blockscout and Sourcify recorded.

**End goal:** Nobody on this repo is guessing which contract is “the launchpad” or “the feed.”

**Done when:** A table exists in-repo with address, role, verified Y/N, last-seen live tx, notes. Stale doc addresses are flagged.

---

### Task B — Source and bytecode truth

**Accomplish:** Know exactly what we can and cannot read.

**Achieve:**

- Official verified Solidity if/when the team publishes it.
- Until then: reconstructed interface (selectors, roles, pause, owner, hook flags) labeled as reconstruction.
- Docs vs bytecode contradictions listed (example already seen: docs say 60s feed / 1h stale; decompile hinted at a 300-second window on a write path — confirm or refute).

**End goal:** Every security or product claim in later tasks cites bytecode, verified source, or a live call — not marketing copy.

**Done when:** A “truth sources” page lists each claim and its evidence grade (verified source / decompile / live call / tweet / docs).

---

### Task C — Token tax vs pool tax

**Accomplish:** Separate “the ERC-20 takes a tax” from “some pool takes a tax.”

**Achieve:**

- $CME and a sample of launched market tokens characterized as taxed or not at the token layer.
- High-tax user reports mapped to **specific unofficial PoolKeys** (currencies, fee, tickSpacing, hooks).
- Official pool (if any) identified for the same token.

**End goal:** A user or terminal can be told, for a given CA: “official market is X; pools Y and Z are not ours.”

**Done when:** At least 5 user-complained tokens have an official-vs-hostile pool table. $CME transfer behavior is classified.

---

### Task D — Discovery gap (the main user complaint)

**Accomplish:** Explain, with evidence, why FOMO and other terminals route to the wrong pool.

**Achieve:**

- Timeline for a typical launch: CA public → first unofficial pool created → official v4 pool created (if ever) → migration.
- What terminals index (first pool, deepest pool, WETH pair, hookless only).
- Why commodity-quoted pools are invisible to default WETH/USDG routers.
- Whether hooked v4 pools are refused by any common RHC router.

**End goal:** The gap is stated as an engineering fact a terminal team or the CME team can act on, not as “apps should listen to us.”

**Done when:** One launch is reconstructed end-to-end (tx list + pool list + what a paste-CA swap would hit).

---

### Task E — Official market exists at first public moment

**Accomplish:** Close the window where a CA is public and no official AMM pool exists.

**Achieve a design that satisfies all of:**

- The official PoolKey is known in the same transaction that publishes the token CA (or the CA is not public until that PoolKey exists).
- Attackers can still make other pools; indexers have a **canonical** official one from block 1.
- Commodity pairing is not discarded (price unit, fee asset, or both remain commodity-linked).
- Liquidity lock / non-withdrawability of the official position is preserved if that is still a product rule.

**End goal:** Pasting the CA into a generic Uniswap-capable terminal hits the official market, or clearly fails, rather than filling a high-tax decoy.

**Done when:** A change request describes the new launch invariant and how a third party would discover the official PoolKey with no CME-specific integration beyond reading an on-chain registry or the launch tx.

---

### Task F — Commodity thesis without walled-garden distribution

**Accomplish:** Keep “paired with a commodity / paid in a commodity” while becoming routable on RHC.

**Achieve a chosen product rule, written down, that is not self-contradictory.** Acceptable outcomes include (pick one and justify against the thesis):

- Official pool quoted in the commodity coin, and that coin has a deep, boring path from WETH/USDG.
- Official pool quoted in WETH or USDG for discovery, with a hook that converts fees and holder payouts into the commodity.
- Dual official pools: discovery pair + commodity pair, with the discovery pair canonical for routers.

**End goal:** Commodity economics survive. Users do not have to open commodites.market to get the real price.

**Done when:** The chosen rule is written as invariants (“holders receive X in Y; displayed price is Z; router path is P”) and each invariant is testable.

---

### Task G — Canonical pool registry

**Accomplish:** An on-chain or otherwise authoritative map: token → official PoolKey(s) + official hook + “all other pools for this CA are unofficial.”

**Achieve:**

- Terminals and the CME UI can resolve the official market from the CA alone.
- Old markets that already have hostile pools are marked so newcomers are not sent there.
- The registry cannot be spoofed by a random LP.

**End goal:** FOMO / DexScreener / Uniswap Launches / GeckoTerminal have something concrete to allowlist. “We emailed support” is not the system.

**Done when:** Registry interface and trust model are specified; at least one terminal’s required metadata is listed as an integration target (no assumption they will custom-build for CME).

---

### Task H — Commodity coins must be a real hop

**Accomplish:** Treat commodity ERC-20s as routing infrastructure, not only as a narrative.

**Achieve:**

- Depth and inventory of USDG↔commodity peg pools measured.
- What happens on a sizeable redeem when the reference price moves against inventory.
- Whether a multi-hop `WETH → USDG → commodity → token` is something a standard router can quote with a minOut.

**End goal:** Either commodity coins are thick enough to be a hop, or the product stops requiring third parties to route through them.

**Done when:** Each major commodity coin has: peg mechanism, inventory vs outstanding, last feed update, and a verdict: routable / thin / broken.

---

### Task I — Keeper, feed, and pause liveness

**Accomplish:** The “live commodity pricing” claim is either continuously true or visibly halted.

**Achieve:**

- Who may write the feed (`KEEPER_ROLE` or equivalent) and who may pause.
- Actual update cadence vs docs.
- Stale threshold that pauses or reverts trading.
- Public heartbeat: last update timestamp readable without trusting the frontend.
- What users can still do if the keeper is down 1 hour / 8 hours / 24 hours (curve trades, peg exits, migrations, holder payouts, $CME burns).

**End goal:** An 8-hour silent feed is impossible to spin as “RPC issues.” The UI and the contracts agree on status.

**Done when:** A liveness spec exists (who updates, how often, what stale means, what pauses, how users see it) and a current on-chain status snapshot is attached.

---

### Task J — Peg honesty

**Accomplish:** Commodity coins are described as what they are: oracle synthetics with finite USDG inventory, not warehouse receipts.

**Achieve:**

- Outstanding supply vs bid-side USDG (or equivalent) for at least GLD and one other major coin.
- Rule for a reference-price jump that the inventory cannot cover.
- Whether treasury recapitalizes, minting pauses, or the peg is allowed to break.
- User-facing disclosure that matches the rule.

**End goal:** No implicit promise of “1 GLD always sells for 1 oz gold in USD.” If that promise is intended, the backing must exist.

**Done when:** A peg policy page (even if only drafted for the team) states backing, failure mode, and user impact.

---

### Task K — Buyback, burn, and holder payouts

**Accomplish:** The 30/40/30 fee story either runs on a schedule or is shown as stopped.

**Achieve:**

- Buyback contract path confirmed against PoolManager + $CME `burn`.
- Last successful buyback/burn tx timestamp vs team announcements.
- Holder payout job: trigger, asset paid, who can poke it if the operator is offline.
- $CME value accrual cannot silently freeze while the site still displays “30% burn.”

**End goal:** Fee destination is observable. “Should be back online shortly” is replaced by a last-run timestamp.

**Done when:** A fee-pipeline diagram cites real txs for each hop, or marks the hop as idle with duration.

---

### Task L — First-party product stability

**Accomplish:** The website — currently the only “safe” venue the team recommends — is a reliable venue.

**Achieve:**

- Live markets list, launch flow, and swap path either work or show a halt reason.
- Routing errors on specific pairs (users cited commodity pairs such as Coke) classified as UI, router, or pool.
- Announced upgrades are not marked live until the corresponding contracts/jobs have moved.

**End goal:** Users who follow “buy on our site” are not blocked by a broken markets page while unofficial pools stay tradeable.

**Done when:** A go-live checklist exists for frontend vs keeper vs launchpad vs buyback, and the current site is scored against it.

---

### Task M — Legacy markets

**Accomplish:** Pre-fix tokens with hostile high-tax pools do not poison new users.

**Achieve:**

- Old CAs listed, official pool status, known hostile pools.
- Site search/discovery hides or hard-warns them.
- New launches do not share the same discovery failure.

**End goal:** A new visitor cannot “buy the old version” by accident.

**Done when:** A quarantine list exists and a rule for when a market may re-enter discovery.

---

### Task N — Team change request pack

**Accomplish:** One document the CME team can execute against, and one document a terminal team can execute against.

**Achieve:**

- CME-side: launch invariant, registry, keeper SLOs, peg disclosure, fee-job pokeability, verification of contracts.
- Terminal-side: “here is how you recognize an official CME pool” in the smallest possible interface (registry call or launch-tx PoolKey), plus a negative list of known hostile pools.
- Explicit rejection of “please special-case commodity routes across every aggregator” as the primary plan.

**End goal:** Work leaves this repo as requests with acceptance tests, not as a thread argument.

**Done when:** Two one-pagers exist (CME team / terminal teams) plus this README still matching reality.

---

## 5. Success at the repo level

The project is successful when **all** of the following are true, or each is explicitly deferred with a reason:

1. Official market for a new launch is discoverable from the CA at the moment the CA is public.
2. Commodity fee/price thesis still holds under that design.
3. Feed, peg, buyback, and payouts have observable liveness, not tweeted liveness.
4. Peg risk is disclosed and matches inventory.
5. Contracts are verified, or the reconstruction is labeled and kept current.
6. Legacy hostile pools are quarantined.
7. Users are not instructed to “just use our website” as the long-term fix.

---

## 6. Working constraints

- Chain: Robinhood Chain `4663`. RPC: `https://rpc.mainnet.chain.robinhood.com`. Explorer: Blockscout.
- UniversalRouter on this chain is modified; standard Uniswap SDK calldata can revert. Record that if a swap path “should work” and does not.
- Some RHC routers refuse hooked v4 pools. Official CME pools are hooked. That is part of the discovery problem.
- Heimdall output in any attached files is **pseudo-Solidity**. Requires are often inverted. Do not ship it as source.

---

## 7. Suggested first session for Claude Code

1. Task A + B (map + truth sources).  
2. Task C + D on one live market that users already complained about.  
3. Task I + K liveness snapshot (feed + buyback last tx).  
4. Draft Task E + F invariants.  
5. Task N outline.

Stop and write evidence before jumping to architecture opinions.

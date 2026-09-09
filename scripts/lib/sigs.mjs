// Candidate signatures used to probe the CME contracts.
//
// IMPORTANT (Task B evidence grading): a selector found in bytecode is
// evidence the function EXISTS. A guessed name NOT found proves nothing —
// the real function may simply be named differently. The probe therefore
// also dumps the complete PUSH4 set per contract so absent names can be
// resolved against a 4-byte database offline.

/** Zero-argument view functions worth calling live on every contract. */
export const VIEW_CALLS = [
  // ownership / access control
  'owner()', 'admin()', 'authority()', 'pendingOwner()', 'treasury()', 'feeTo()',
  'DEFAULT_ADMIN_ROLE()', 'KEEPER_ROLE()', 'OPERATOR_ROLE()', 'PAUSER_ROLE()',
  'UPGRADE_INTERFACE_VERSION()', 'proxiableUUID()',
  // pause / halt
  'paused()', 'isPaused()', 'halted()', 'tradingEnabled()', 'live()',
  // feed staleness — the docs-vs-bytecode contradiction in README Task B
  'stalePeriod()', 'staleAfter()', 'stalenessThreshold()', 'maxAge()', 'maxStaleness()',
  'heartbeat()', 'updateInterval()', 'period()', 'gracePeriod()', 'timeout()',
  'lastUpdate()', 'lastUpdated()', 'lastUpdateTime()', 'lastUpdatedAt()',
  'lastPriceUpdate()', 'updatedAt()', 'latestTimestamp()', 'latestRound()',
  // token surface
  'name()', 'symbol()', 'decimals()', 'totalSupply()',
  // launchpad / curve economics
  'openCap()', 'migrationCap()', 'graduationCap()', 'targetMarketCap()',
  'totalSupplyPerLaunch()', 'curveSupply()', 'poolSupply()',
  'feeBps()', 'protocolFeeBps()', 'creatorFeeBps()', 'holderShareBps()',
  'buybackShareBps()', 'treasuryShareBps()', 'minFee()', 'maxFee()',
  'launchCount()', 'totalLaunches()', 'allTokensLength()',
  // wiring
  'poolManager()', 'positionManager()', 'router()', 'universalRouter()',
  'priceFeed()', 'feed()', 'oracle()', 'buyback()', 'cme()', 'CME()',
  'usdg()', 'USDG()', 'weth()', 'WETH()', 'hook()', 'hooks()', 'factory()',
  // buyback / burn
  'lastBuyback()', 'lastRun()', 'totalBurned()', 'totalBought()', 'pendingFees()',
];

/** Signatures whose selector presence in bytecode is itself informative. */
export const PROBE_SIGS = [
  ...VIEW_CALLS,
  // ERC-20
  'transfer(address,uint256)', 'transferFrom(address,address,uint256)',
  'approve(address,uint256)', 'balanceOf(address)', 'allowance(address,address)',
  'burn(uint256)', 'burnFrom(address,uint256)', 'mint(address,uint256)',
  // access control
  'hasRole(bytes32,address)', 'grantRole(bytes32,address)', 'revokeRole(bytes32,address)',
  'renounceOwnership()', 'transferOwnership(address)',
  // pause
  'pause()', 'unpause()', 'setPaused(bool)',
  // upgradeability
  'upgradeTo(address)', 'upgradeToAndCall(address,bytes)', 'implementation()',
  // feed writes — the keeper path (Task I)
  'setPrice(address,uint256)', 'setPrice(bytes32,uint256)', 'setPrice(uint256)',
  'updatePrice(address,uint256)', 'updatePrices(address[],uint256[])',
  'setPrices(address[],uint256[])', 'pushPrice(address,uint256)',
  'getPrice(address)', 'getPrice(bytes32)', 'price(address)', 'latestPrice(address)',
  'priceOf(address)', 'getPriceUnsafe(address)', 'peek(address)', 'read()',
  'isStale(address)', 'staleness(address)',
  // launchpad
  'launch(string,string,uint256)', 'createToken(string,string)',
  'buy(address,uint256)', 'sell(address,uint256)',
  'buy(address,uint256,uint256)', 'sell(address,uint256,uint256)',
  'migrate(address)', 'graduate(address)', 'finalize(address)',
  'claim(address)', 'claimFees(address)',
  // uniswap v4 surface
  'initialize((address,address,uint24,int24,address),uint160)',
  'unlock(bytes)', 'swap((address,address,uint24,int24,address),(bool,int256,uint160),bytes)',
  'getSlot0(bytes32)', 'extsload(bytes32)',
  'getHookPermissions()', 'beforeSwap(address,(address,address,uint24,int24,address),(bool,int256,uint160),bytes)',
  // buyback
  'buyback()', 'execute()', 'run()', 'poke()', 'harvest()', 'distribute()',
];

/** Event signatures to resolve topic0 values seen in logs. */
export const EVENT_SIGS = [
  // ERC-20 / generic
  'Transfer(address,address,uint256)',
  'Approval(address,address,uint256)',
  'OwnershipTransferred(address,address)',
  'RoleGranted(bytes32,address,address)',
  'RoleRevoked(bytes32,address,address)',
  'Paused(address)', 'Unpaused(address)',
  'Upgraded(address)', 'AdminChanged(address,address)',
  // Uniswap v4 (canonical — VERIFY against the deployed PoolManager, README §6
  // warns this chain's Uniswap deployment is modified)
  'Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)',
  'ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)',
  'Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)',
  'Donate(bytes32,address,uint256,uint256)',
  // Uniswap v3 (commodity peg pools)
  'Initialize(uint160,int24)',
  'Mint(address,address,int24,int24,uint128,uint256,uint256)',
  'Burn(address,int24,int24,uint128,uint256,uint256)',
  'Swap(address,address,int256,int256,uint160,uint128,int24)',
  'PoolCreated(address,address,uint24,int24,address)',
  // plausible CME-specific
  'Launch(address,address,string,string)',
  'TokenLaunched(address,address)',
  'TokenCreated(address,address,string,string)',
  'Migrated(address,bytes32)',
  'Graduated(address,bytes32)',
  'PriceUpdated(address,uint256,uint256)',
  'PriceSet(address,uint256)',
  'PricesUpdated(address[],uint256[])',
  'Buyback(uint256,uint256)',
  'BuybackAndBurn(uint256,uint256)',
  'Burned(uint256)',
  'FeesDistributed(address,uint256,uint256,uint256)',
];

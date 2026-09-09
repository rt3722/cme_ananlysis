#!/usr/bin/env node
// Resolve 4-byte selectors to signatures by generating a candidate vocabulary
// and hashing it locally. No network, so this works from inside the sandbox
// where 4byte.directory is unreachable.
//
//   node scripts/selectors.mjs 0xabcd1234 0x...      # resolve these
//   node scripts/selectors.mjs --file sels.json      # {"selectors":[...]}
import { selector } from './lib/keccak.mjs';
import { PROBE_SIGS } from './lib/sigs.mjs';

// Names observed in OpenZeppelin bases, ERC standards, Uniswap v4, and the
// vocabulary a launchpad / oracle feed / buyback would plausibly use.
const NAMES = `
owner admin authority treasury feeTo pendingOwner implementation factory router
poolManager positionManager priceFeed feed oracle buyback cme usdg weth hook hooks
paused isPaused halted live tradingEnabled
name symbol decimals totalSupply nonces version eip712Domain DOMAIN_SEPARATOR
transfer transferFrom approve balanceOf allowance mint burn burnFrom permit
supportsInterface hasRole getRoleAdmin grantRole revokeRole renounceRole
setRoleAdmin defaultAdmin defaultAdminDelay pendingDefaultAdmin pendingDefaultAdminDelay
defaultAdminDelayIncreaseWait beginDefaultAdminTransfer acceptDefaultAdminTransfer
cancelDefaultAdminTransfer rollbackDefaultAdminDelay changeDefaultAdminDelay
renounceOwnership transferOwnership acceptOwnership pause unpause setPaused
KEEPER_ROLE PAUSER_ROLE OPERATOR_ROLE MINTER_ROLE ADMIN_ROLE DEFAULT_ADMIN_ROLE
UPDATER_ROLE FEEDER_ROLE MANAGER_ROLE
price prices getPrice setPrice setPrices updatePrice updatePrices pushPrice
priceOf latestPrice lastPrice getPriceUnsafe peek read latestAnswer latestRoundData
priceData assets asset assetCount assetList allAssets isSupported supported
lastUpdate lastUpdated lastUpdateTime lastUpdatedAt lastPriceUpdate updatedAt
timestamp lastTimestamp latestTimestamp heartbeat updateInterval period
stalePeriod staleAfter stalenessThreshold maxAge maxStaleness staleness isStale
maxPriceAge priceAge freshness gracePeriod timeout deviation maxDeviation
minUpdateInterval maxUpdateDelay STALE_PERIOD MAX_AGE MAX_STALENESS HEARTBEAT
UPDATE_INTERVAL MIN_UPDATE_INTERVAL MAX_PRICE_AGE STALENESS_THRESHOLD
launch launches launchCount totalLaunches createToken create tokens token
allTokens allTokensLength tokenAt marketOf marketFor markets market
buy sell quote quoteBuy quoteSell migrate graduate finalize claim claimFees
openCap migrationCap graduationCap targetMarketCap curveSupply poolSupply
totalSupplyPerLaunch feeBps protocolFeeBps creatorFeeBps holderShareBps
buybackShareBps treasuryShareBps minFee maxFee MIN_FEE MAX_FEE
OPEN_CAP MIGRATION_CAP CURVE_SUPPLY POOL_SUPPLY TOTAL_SUPPLY
poolKey poolKeyOf poolIdOf officialPool getPool pools poolFor
lastBuyback lastRun totalBurned totalBought pendingFees execute run poke harvest
distribute swapAndBurn buyAndBurn collect sweep withdraw
unlock extsload exttload initialize swap modifyLiquidity donate settle take sync
getSlot0 getLiquidity protocolFeesAccrued setProtocolFee collectProtocolFees
supportsInterface symbols symbolAt symbolList assetSymbols keys keyAt allKeys
addAsset removeAsset setAsset registerAsset listAsset assetInfo info
priceAndTimestamp getPriceAndTime priceWithTimestamp latest latestData
getAsset assetAt exists has contains isListed isRegistered isActive active
setStalePeriod setMaxAge setHeartbeat setStaleAfter setUpdateInterval
setKeeper keeper keepers isKeeper setTreasury setFeeTo setRouter setPoolManager
setFeed setOracle setBuyback setHook setCap setFee setFees setShares
decimalsOf scale precision PRECISION ONE WAD
tokenInfo launchInfo curve curveOf reserves reserveOf virtualReserves
progress capOf raisedOf raised migrated isMigrated hasMigrated
pairOf pairCoin quoteToken quoteOf baseOf creatorOf creator
`.trim().split(/\s+/);

const ARGSETS = [
  '', 'address', 'uint256', 'bytes32', 'bool', 'bytes4', 'string',
  'address,uint256', 'bytes32,uint256', 'address,address', 'address[]', 'uint256[]',
  'address[],uint256[]', 'bytes32[],uint256[]', 'bytes32,address', 'address,bytes32',
  'uint48', 'uint64', 'uint32', 'uint16', 'uint8',
  'string,string', 'string,string,uint256', 'address,uint256,uint256',
  'uint256,uint256', 'address,bool', 'bytes', 'bytes32[]', 'string[]',
  'bytes32,uint256,uint256', 'bytes32,bool', 'bytes32,address,uint256',
  'string,uint256', 'address,string', 'bytes32,uint64', 'uint256,address',
];

export function buildTable() {
  const table = new Map();
  const add = (sig) => { const s = selector(sig); if (!table.has(s)) table.set(s, sig); };
  for (const n of NAMES) for (const a of ARGSETS) add(`${n}(${a})`);
  for (const sig of PROBE_SIGS) add(sig);
  // Errors and events share the same hash space as selectors in bytecode.
  for (const e of ['Panic(uint256)', 'Error(string)', 'EnforcedPause()', 'ExpectedPause()',
    'AccessControlUnauthorizedAccount(address,bytes32)', 'AccessControlBadConfirmation()',
    'OwnableUnauthorizedAccount(address)', 'OwnableInvalidOwner(address)',
    'ERC20InsufficientBalance(address,uint256,uint256)', 'ERC20InvalidSender(address)',
    'ERC20InvalidReceiver(address)', 'ERC20InsufficientAllowance(address,uint256,uint256)',
    'ERC20InvalidApprover(address)', 'ERC20InvalidSpender(address)',
    'ReentrancyGuardReentrantCall()', 'SafeERC20FailedOperation(address)',
    'AddressEmptyCode(address)', 'FailedInnerCall()', 'AddressInsufficientBalance(address)',
    'AccessControlEnforcedDefaultAdminRules()', 'AccessControlEnforcedDefaultAdminDelay(uint48)',
    'AccessControlInvalidDefaultAdmin(address)']) add(e);
  return table;
}

const table = buildTable();

let sels = process.argv.slice(2);
if (sels[0] === '--file') {
  const j = JSON.parse(await (await import('node:fs/promises')).readFile(sels[1], 'utf8'));
  sels = j.selectors || j;
}
let hit = 0;
for (const s of sels) {
  const sig = table.get(s.toLowerCase());
  if (sig) hit++;
  console.log(`${s}  ${sig || '?'}`);
}
console.error(`\nresolved ${hit}/${sels.length} (vocabulary ${table.size} candidates)`);

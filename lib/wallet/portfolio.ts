// Core orchestration for the wallet modal: fetches balances + recent
// activity (Etherscan primary, public-RPC fallback), prices them, and
// returns a privacy-scrubbed, normalized snapshot. This is the only module
// that should ever see WALLET_ADDRESS or a full tx hash — everything it
// returns has already been minimized for public display.
//
// Caching/dedup: module-level singleton state. Next.js keeps this module
// instance alive across requests served by the same server process/lambda,
// so a plain module-scope variable works as a process-wide cache without
// needing Redis/KV for a single-wallet, read-only feature like this one.
// Multiple concurrent requests during a cold cache share one in-flight
// promise (single-flight) instead of hammering upstreams in parallel.
import { addressToTopic, balanceOfViaRpc, decodeTransferLog, formatTokenAmount, type RawLog } from './erc20'
import { TRANSFER_TOPIC } from './erc20'
import { ETHERSCAN_KEY, TOKENS, WALLET_ADDRESS, type TokenConfig } from './config'
import { fetchTokenBalanceEtherscan, fetchTokenTxEtherscan, type EtherscanTokenTx } from './etherscan'
import { fetchUsdPrices } from './prices'
import { getBlockNumberFallback, getBlockTimestamp, getLogsPublicnode } from './rpc'

const CACHE_TTL_MS = 20_000
// Last-good value is served (marked stale) for up to this long after a
// refresh failure, so a transient upstream hiccup never blanks the modal or
// shows zeroed-out numbers — the "never silently overwrite valid data with
// wrong/empty data" requirement.
const STALE_MAX_AGE_MS = 15 * 60 * 1000
// publicnode's free/anonymous eth_getLogs tier 403s past roughly this many
// blocks back ("Archive requests require a personal token") — confirmed via
// live binary-search testing. Only used when Etherscan is unavailable.
const RPC_LOG_LOOKBACK_BLOCKS = 8000
const ACTIVITY_LIMIT = 12
// Pulled per-token before merging + filtering zero-value noise + slicing to
// ACTIVITY_LIMIT — fetching a bit more than the final display count means a
// handful of zero-value transfers (dust/self-transfers some tokens emit
// regularly — real on-chain events, just not useful "activity" to show)
// don't crowd out genuine recent transfers.
const RAW_FETCH_LIMIT = 20

export type WalletAsset = {
  symbol: string
  name: string
  color: string
  balance: number
  priceUsd: number | null
  valueUsd: number | null
}

export type WalletActivityItem = {
  // Opaque id for React keys / dedup — not a real tx hash, see shortRef()
  // on the hash itself for the (separately truncated) display reference.
  id: string
  symbol: string
  amount: number
  direction: 'in' | 'out'
  // Unix seconds. Displayed client-side as relative time ("3h ago") rather
  // than a precise clock timestamp — see Section 11 of the spec this
  // feature was built against: approximate timing, not exact.
  timestamp: number
  status: 'confirmed'
  ref: string
}

export type WalletPortfolio = {
  totalValueUsd: number | null
  assets: WalletAsset[]
  activity: WalletActivityItem[]
  updatedAt: number
  stale: boolean
  partial: boolean
  source: 'etherscan' | 'rpc' | 'mixed'
  // Truncated address (first 6 + last 4 chars, same shortRef() convention
  // as activity refs below) — enough for a visitor to recognize "yes, this
  // is backed by a real address" without the full 42 chars ever reaching
  // the client. Computed once from WALLET_ADDRESS, never the raw value.
  addressPreview: string
}

type InternalSnapshot = { data: WalletPortfolio; at: number }

let cache: InternalSnapshot | null = null
let inFlight: Promise<WalletPortfolio> | null = null

// Never shows the real 66-char tx hash or an Etherscan deep link in the
// default payload — just enough to tell two activity rows apart.
function shortRef(hash: string): string {
  if (!hash || hash.length < 10) return '0x…'
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`
}

// Computed once, at module load, from the real address — never recomputed
// per-request from anything that could drift toward exposing more of it.
const ADDRESS_PREVIEW = shortRef(WALLET_ADDRESS)

async function fetchTokenEtherscan(token: TokenConfig) {
  const [balanceRaw, txs] = await Promise.all([
    fetchTokenBalanceEtherscan(token.address, WALLET_ADDRESS),
    fetchTokenTxEtherscan(token.address, WALLET_ADDRESS, RAW_FETCH_LIMIT),
  ])
  return { balanceRaw, txs }
}

function etherscanTxToActivity(tx: EtherscanTokenTx, symbol: string): WalletActivityItem {
  const decimals = Number(tx.tokenDecimal) || 6
  const direction: 'in' | 'out' = tx.to?.toLowerCase() === WALLET_ADDRESS ? 'in' : 'out'
  const ref = shortRef(tx.hash)
  return {
    // Built from the already-truncated ref, not the raw hash — the full
    // hash (tx.hash) must never reach the serialized response, `id`
    // included. See Section 11: no full tx hashes in the default view.
    id: `${ref}:${symbol}:${tx.timeStamp}`,
    symbol,
    amount: formatTokenAmount(BigInt(tx.value), decimals),
    direction,
    timestamp: Number(tx.timeStamp) || 0,
    // Etherscan's tokentx list only ever returns mined transfers (it reads
    // from indexed logs, not the mempool) — there is no pending state to
    // represent here, so every row is genuinely confirmed, never a guess.
    status: 'confirmed',
    ref,
  }
}

async function loadViaEtherscan(): Promise<{
  assets: Omit<WalletAsset, 'priceUsd' | 'valueUsd'>[]
  activity: WalletActivityItem[]
}> {
  const results = await Promise.all(TOKENS.map(fetchTokenEtherscan))
  const assets = TOKENS.map((token, i) => ({
    symbol: token.symbol,
    name: token.name,
    color: token.color,
    balance: formatTokenAmount(results[i].balanceRaw, token.decimals),
  }))
  const activity = results
    .flatMap((r, i) => r.txs.map((tx) => etherscanTxToActivity(tx, TOKENS[i].symbol)))
    // Zero-value transfers are real on-chain events some tokens emit
    // regularly (dust/self-transfers) but carry no useful "activity"
    // information for this display — see RAW_FETCH_LIMIT above.
    .filter((item) => item.amount > 0)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, ACTIVITY_LIMIT)
  return { assets, activity }
}

async function loadBalancesViaRpc(): Promise<Omit<WalletAsset, 'priceUsd' | 'valueUsd'>[]> {
  const balances = await Promise.all(TOKENS.map((t) => balanceOfViaRpc(t.address, WALLET_ADDRESS)))
  return TOKENS.map((token, i) => ({
    symbol: token.symbol,
    name: token.name,
    color: token.color,
    balance: formatTokenAmount(balances[i], token.decimals),
  }))
}

async function loadActivityViaRpc(): Promise<WalletActivityItem[]> {
  const latest = await getBlockNumberFallback()
  const fromBlock = '0x' + Math.max(0, latest - RPC_LOG_LOOKBACK_BLOCKS).toString(16)
  const walletTopic = addressToTopic(WALLET_ADDRESS)
  const tokenAddresses = TOKENS.map((t) => t.address)

  const [outgoing, incoming] = await Promise.all([
    getLogsPublicnode({
      fromBlock,
      toBlock: 'latest',
      address: tokenAddresses,
      topics: [TRANSFER_TOPIC, walletTopic, null],
    }),
    getLogsPublicnode({
      fromBlock,
      toBlock: 'latest',
      address: tokenAddresses,
      topics: [TRANSFER_TOPIC, null, walletTopic],
    }),
  ])

  const decoded = [...outgoing, ...incoming]
    .map((log) => decodeTransferLog(log as RawLog))
    .filter((t): t is NonNullable<typeof t> => t != null && t.value > 0n)
    .sort((a, b) => b.blockNumber - a.blockNumber)
    .slice(0, ACTIVITY_LIMIT)

  const uniqueBlocks = [...new Set(decoded.map((d) => d.blockNumber))]
  const blockHexByNumber = new Map(uniqueBlocks.map((n) => [n, '0x' + n.toString(16)]))
  const timestamps = await Promise.all(
    uniqueBlocks.map((n) => getBlockTimestamp(blockHexByNumber.get(n)!)),
  )
  const tsByBlock = new Map(uniqueBlocks.map((n, i) => [n, timestamps[i]]))

  return decoded.map((t) => {
    const token = TOKENS.find((tok) => tok.address === t.tokenAddress)
    const symbol = token?.symbol ?? '?'
    const decimals = token?.decimals ?? 18
    const ref = shortRef(t.txHash)
    return {
      // Same rule as etherscanTxToActivity above: built from the truncated
      // ref + logIndex (unique per event), never the raw 66-char hash.
      id: `${ref}:${t.logIndex}`,
      symbol,
      amount: formatTokenAmount(t.value, decimals),
      direction: t.to === WALLET_ADDRESS ? 'in' : 'out',
      timestamp: tsByBlock.get(t.blockNumber) ?? 0,
      status: 'confirmed' as const,
      ref,
    }
  })
}

async function attachPrices(
  assets: Omit<WalletAsset, 'priceUsd' | 'valueUsd'>[],
): Promise<{ assets: WalletAsset[]; totalValueUsd: number | null; partial: boolean }> {
  try {
    const prices = await fetchUsdPrices(TOKENS.map((t) => t.coingeckoId))
    let partial = false
    let anyPriced = false
    let total = 0
    const priced = assets.map((asset) => {
      const token = TOKENS.find((t) => t.symbol === asset.symbol)
      const price = token ? prices[token.coingeckoId] : undefined
      if (price == null) {
        partial = true
        return { ...asset, priceUsd: null, valueUsd: null }
      }
      const valueUsd = asset.balance * price
      total += valueUsd
      anyPriced = true
      return { ...asset, priceUsd: price, valueUsd }
    })
    // Only null out the total when *nothing* priced — a total built from a
    // subset of assets is still meaningful (and flagged via `partial` so the
    // UI can note it's incomplete), but a total of "$0" when every price
    // lookup failed would misread as "this wallet is empty".
    return { assets: priced, totalValueUsd: anyPriced ? total : null, partial }
  } catch {
    // Price lookup failing doesn't invalidate the on-chain balances — show
    // them with an unknown value rather than discarding real data.
    return {
      assets: assets.map((a) => ({ ...a, priceUsd: null, valueUsd: null })),
      totalValueUsd: null,
      partial: true,
    }
  }
}

async function load(): Promise<WalletPortfolio> {
  let rawAssets: Omit<WalletAsset, 'priceUsd' | 'valueUsd'>[] | null = null
  let activity: WalletActivityItem[] = []
  let source: WalletPortfolio['source'] = 'etherscan'
  let partial = false

  if (ETHERSCAN_KEY) {
    try {
      const result = await loadViaEtherscan()
      rawAssets = result.assets
      activity = result.activity
    } catch (e) {
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.warn('[wallet] etherscan path failed, falling back to rpc:', (e as Error).message)
      }
    }
  }

  if (!rawAssets) {
    source = ETHERSCAN_KEY ? 'mixed' : 'rpc'
    rawAssets = await loadBalancesViaRpc()
    try {
      activity = await loadActivityViaRpc()
    } catch (e) {
      // Activity is best-effort on the fallback path — a working balance
      // with an empty activity list beats failing the whole snapshot.
      partial = true
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.warn('[wallet] rpc activity fetch failed:', (e as Error).message)
      }
    }
  }

  const { assets, totalValueUsd, partial: pricePartial } = await attachPrices(rawAssets)

  return {
    totalValueUsd,
    assets,
    activity,
    updatedAt: Date.now(),
    stale: false,
    partial: partial || pricePartial,
    source,
    addressPreview: ADDRESS_PREVIEW,
  }
}

export async function getWalletPortfolio(): Promise<WalletPortfolio> {
  const now = Date.now()
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return cache.data
  }
  if (inFlight) {
    return inFlight
  }

  inFlight = load()
    .then((data) => {
      cache = { data, at: Date.now() }
      return data
    })
    .catch((e) => {
      // Total failure (both Etherscan and every RPC fallback down). Serve
      // the last-good snapshot, marked stale, instead of an error — unless
      // it's aged out, in which case there's genuinely nothing honest to
      // show and the caller (API route) returns an error response.
      if (cache && now - cache.at < STALE_MAX_AGE_MS) {
        return { ...cache.data, stale: true }
      }
      throw e
    })
    .finally(() => {
      inFlight = null
    })

  return inFlight
}

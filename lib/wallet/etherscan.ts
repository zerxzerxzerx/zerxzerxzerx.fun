// Etherscan V2 wrapper — the primary data source for this feature. V1
// (api.etherscan.io/api) is deprecated and now returns a NOTOK/deprecation
// message; V2 (api.etherscan.io/v2/api?chainid=1) is a hard requirement and
// mandates a real key — even the old "YourApiKeyToken" demo value 401s now.
// Chosen as primary over public RPC because it has a far deeper tx-history
// window (12+ days of real transfers vs. ~1.3 days of eth_getLogs on
// publicnode's free/non-archive tier) and doesn't need the manual
// block-range math getLogs requires.
import { ETHERSCAN_KEY } from './config'

const ETHERSCAN_TIMEOUT_MS = 3000
const BASE_URL = 'https://api.etherscan.io/v2/api'

// Free-tier Etherscan caps at ~3 req/sec ("Max calls per sec rate limit
// reached (3/sec)" — observed live). A single portfolio load fires 4 calls
// (balance + tx history, per token, for 2 tokens), which blows past that if
// fired concurrently via Promise.all. Rather than special-case call sites,
// every call through this module is funneled through one chain that spaces
// requests out process-wide — simple and correct for a single-wallet,
// low-QPS feature like this one (no need for a real token-bucket library).
const MIN_CALL_INTERVAL_MS = 600
let lastCallAt = 0
let throttleChain: Promise<void> = Promise.resolve()

function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = throttleChain.then(async () => {
    const wait = Math.max(0, lastCallAt + MIN_CALL_INTERVAL_MS - Date.now())
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    lastCallAt = Date.now()
    return fn()
  })
  // Advance the chain unconditionally so one failed call doesn't stall every
  // call queued behind it.
  throttleChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

type EtherscanEnvelope<T> = { status?: string; message?: string; result?: T }

async function etherscanGet<T>(params: Record<string, string>): Promise<T> {
  if (!ETHERSCAN_KEY) throw new Error('ETHERSCAN_KEY not configured')
  return throttled(async () => {
    const qs = new URLSearchParams({ chainid: '1', apikey: ETHERSCAN_KEY, ...params })
    const res = await fetch(`${BASE_URL}?${qs.toString()}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(ETHERSCAN_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`etherscan http ${res.status}`)
    const json = (await res.json()) as EtherscanEnvelope<T>
    // Etherscan's "no transactions found" case comes back as status "0" with
    // message "No transactions found" — that's a valid empty result, not an
    // error, so only throw on a genuinely missing result field here. Other
    // status-"0" cases (rate limit, invalid key) also populate `result`
    // with a human-readable message string instead of real data — callers
    // validate the shape of `result` themselves rather than trusting it
    // just because it's present.
    if (json.result === undefined) {
      throw new Error(json.message || 'etherscan: empty result')
    }
    return json.result
  })
}

export async function fetchTokenBalanceEtherscan(
  tokenAddress: string,
  wallet: string,
): Promise<bigint> {
  const result = await etherscanGet<string>({
    module: 'account',
    action: 'tokenbalance',
    contractaddress: tokenAddress,
    address: wallet,
    tag: 'latest',
  })
  // A real balance is always a plain base-10 integer string. Rate-limit /
  // error messages ("Max calls per sec rate limit reached (3/sec)", "Invalid
  // API Key", etc.) come back in this same `result` field — catching that
  // here with a clear error, instead of letting BigInt() throw an opaque
  // "Cannot convert ... to a BigInt" message, is what actually triggers the
  // RPC fallback path in lib/wallet/portfolio.ts.
  if (!/^\d+$/.test(result)) {
    throw new Error(`etherscan tokenbalance: unexpected result "${result}"`)
  }
  return BigInt(result)
}

export type EtherscanTokenTx = {
  hash: string
  from: string
  to: string
  value: string
  tokenDecimal: string
  tokenSymbol: string
  timeStamp: string
  confirmations: string
}

export async function fetchTokenTxEtherscan(
  tokenAddress: string,
  wallet: string,
  limit = 25,
): Promise<EtherscanTokenTx[]> {
  const result = await etherscanGet<EtherscanTokenTx[] | string>({
    module: 'account',
    action: 'tokentx',
    contractaddress: tokenAddress,
    address: wallet,
    page: '1',
    offset: String(limit),
    sort: 'desc',
  })
  if (Array.isArray(result)) return result
  // "No transactions found" is Etherscan's genuine-empty-history message —
  // that's valid, real data (an empty list), not a failure. Any other
  // string here (rate limit, invalid key, etc.) is an actual error and
  // must not be swallowed into a silent "no activity", which would be
  // exactly the "silently show empty data instead of real data" failure
  // mode this feature is required to avoid.
  if (typeof result === 'string' && /no transactions found/i.test(result)) return []
  throw new Error(
    typeof result === 'string' ? `etherscan tokentx: ${result}` : 'etherscan tokentx: unexpected result',
  )
}

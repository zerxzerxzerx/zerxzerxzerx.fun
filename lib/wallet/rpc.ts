// Minimal JSON-RPC client over plain fetch — this codebase has no
// ethers/viem/web3 dependency (see package.json) and the wallet feature
// doesn't need one for two read-only calls (eth_call, eth_getLogs).
//
// Provider order and behavior here are the result of live-testing every
// free/anonymous Ethereum RPC we could find (see comments per entry) — this
// is the *fallback* path, only hit when ETHERSCAN_KEY is missing or
// Etherscan itself errors (lib/wallet/etherscan.ts is primary).
const RPC_TIMEOUT_MS = 3000

type RpcProvider = { url: string; label: string }

// cloudflare-eth.com and eth.llamarpc.com were tested and dropped entirely:
// the former 500s on every eth_call, the latter returns an HTML page instead
// of JSON. Neither is listed here — no point carrying dead fallbacks.
const RPC_PROVIDERS: RpcProvider[] = [
  { url: 'https://ethereum.publicnode.com', label: 'publicnode' },
  { url: 'https://eth.drpc.org', label: 'drpc' },
  { url: 'https://1rpc.io/eth', label: '1rpc' },
]

async function rpcCall<T = unknown>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    cache: 'no-store',
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (!res.ok) throw new Error(`${method} http ${res.status}`)
  const json = (await res.json()) as { result?: T; error?: { message?: string; code?: number } }
  if (json.error) throw new Error(json.error.message || `${method} rpc error`)
  if (json.result === undefined) throw new Error(`${method} empty result`)
  return json.result
}

// Tries each provider in order, returning the first success. Throws only if
// every provider fails — callers (erc20.ts / portfolio.ts) decide what to do
// with a total failure (fall back to last-good cached value, never show
// fabricated data).
export async function rpcCallWithFallback<T = unknown>(
  method: string,
  params: unknown[],
): Promise<T> {
  let lastErr: unknown
  for (const provider of RPC_PROVIDERS) {
    try {
      return await rpcCall<T>(provider.url, method, params)
    } catch (e) {
      lastErr = e
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.warn(`[wallet rpc] ${provider.label} failed for ${method}:`, (e as Error).message)
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`all rpc providers failed for ${method}`)
}

// eth_getLogs only against publicnode — drpc throttles unpredictably and
// 1rpc caps ranges at 50 blocks, neither is usable for log scans (see
// lib/wallet/portfolio.ts for the block-range math this feeds).
export async function getLogsPublicnode(params: Record<string, unknown>): Promise<unknown[]> {
  return rpcCall<unknown[]>('https://ethereum.publicnode.com', 'eth_getLogs', [params])
}

export async function getBlockNumberFallback(): Promise<number> {
  const hex = await rpcCallWithFallback<string>('eth_blockNumber', [])
  return Number(hex)
}

export async function getBlockTimestamp(blockNumberHex: string): Promise<number> {
  const block = await rpcCall<{ timestamp?: string }>(
    'https://ethereum.publicnode.com',
    'eth_getBlockByNumber',
    [blockNumberHex, false],
  )
  return block?.timestamp ? Number(block.timestamp) : 0
}

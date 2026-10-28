// CoinGecko's public simple-price endpoint — no API key, confirmed working
// anonymously. Used purely to turn token balances into a USD total; never
// cached as a "secret" since it's not one.
const COINGECKO_TIMEOUT_MS = 6000

export async function fetchUsdPrices(coingeckoIds: string[]): Promise<Record<string, number>> {
  const ids = [...new Set(coingeckoIds)].join(',')
  const res = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd`,
    { cache: 'no-store', signal: AbortSignal.timeout(COINGECKO_TIMEOUT_MS) },
  )
  if (!res.ok) throw new Error(`coingecko http ${res.status}`)
  const json = (await res.json()) as Record<string, { usd?: number }>
  const out: Record<string, number> = {}
  for (const id of Object.keys(json)) {
    if (typeof json[id]?.usd === 'number') out[id] = json[id].usd!
  }
  return out
}

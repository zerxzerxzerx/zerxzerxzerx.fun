// CoinGecko market data for LTC / ETH / SOL. `sparkline: true` gives us a
// free 7-day price series per coin, which drives the tiny in-modal spark.
import { getJSON } from './http'
import { REFRESH_SECONDS } from './config'
import { swr } from './cache'

export type CoinMarket = {
  id: string
  symbol: string
  name: string
  current_price: number
  price_change_percentage_24h: number | null
  sparkline_in_7d?: { price: number[] }
}

async function loadMarkets(): Promise<CoinMarket[]> {
  const url =
    'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=litecoin,ethereum,solana&price_change_percentage=24h&sparkline=true'
  const data = await getJSON<CoinMarket[]>(url, { revalidate: REFRESH_SECONDS })
  return Array.isArray(data) ? data : []
}

// Prices move but not enough to justify pulling fresh every request. 60s
// fresh keeps the modal snappy; 10min stale means CoinGecko 429s never
// blank the panel — we just serve the last known good numbers.
export function getMarkets(): Promise<CoinMarket[]> {
  return swr('markets', { freshMs: 60_000, staleMs: 10 * 60_000 }, loadMarkets)
}

// Historical daily prices for a coin over `days` days. Used by backfill to
// pin an accurate USD value to each historical balance point.
type CoinGeckoChart = { prices?: [number, number][] }

async function loadHistoricalPrices(coinId: string, days: number): Promise<[number, number][]> {
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`
  try {
    const data = await getJSON<CoinGeckoChart>(url, {
      timeoutMs: 10000,
      revalidate: REFRESH_SECONDS,
    })
    return Array.isArray(data?.prices) ? data.prices : []
  } catch {
    return []
  }
}

// Past-day prices don't change. Only today's rolling average moves, and
// we're pinning today's total to live prices anyway. Cache aggressively.
export function fetchHistoricalPrices(coinId: string, days: number): Promise<[number, number][]> {
  return swr(
    `hist:${coinId}:${days}`,
    { freshMs: 6 * 3600_000, staleMs: 24 * 3600_000 },
    () => loadHistoricalPrices(coinId, days),
  )
}

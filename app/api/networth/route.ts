import { NextResponse } from 'next/server'
import { WALLETS, COIN_META, CHAINS, REFRESH_SECONDS, type Chain } from '@/lib/networth/config'
import { FETCHERS } from '@/lib/networth/wallets'
import { getMarkets } from '@/lib/networth/prices'
import { reconstructPortfolioHistory, type ReconstructedPoint } from '@/lib/networth/backfill'

export const runtime = 'nodejs'
export const revalidate = 600 // 10 min — matches other API routes on this site

type HoldingOut = {
  chain: Chain
  name: string
  symbol: string
  icon: string
  color: string
  address: string
  explorer_url: string
  balance: number | null
  price: number | null
  usd: number | null
  share_pct: number | null
  change_24h_pct: number | null
  sparkline: number[] | null
  error: string | null
}

type ProfitBucket = {
  window_days: number
  start_usd: number
  end_usd: number
  abs: number
  pct: number
}

type NetworthOut = {
  total_usd: number
  updated_at: string
  holdings: HoldingOut[]
  history: { date: string; timestamp: number; total: number }[]
  profit: {
    day: ProfitBucket | null
    week: ProfitBucket | null
    month: ProfitBucket | null
  }
  reconstructed: boolean
  warnings: string[]
}

// Given a full history + a lookback window, produce a profit bucket
// (change over the window). Returns null when we can't compute an honest
// number — history too short, window predates our data, or the reconstructed
// start value is $0 (which would yield a nonsensical percentage).
function bucket(history: ReconstructedPoint[], windowDays: number): ProfitBucket | null {
  if (history.length < 2) return null
  const end = history[history.length - 1]
  const targetMs = end.timestamp - windowDays * 86_400 * 1000
  const oldestMs = history[0].timestamp

  // Window predates our data — anything we'd return would be misleading
  // (start=0 or start=oldest point which is really "N days ago", not
  // "windowDays ago"). Give a small grace so a 7d bucket still shows when
  // history is 6.5d long.
  if (targetMs < oldestMs - 12 * 3600 * 1000) return null

  let start = history[0]
  let bestDiff = Math.abs(start.timestamp - targetMs)
  for (const p of history) {
    const d = Math.abs(p.timestamp - targetMs)
    if (d < bestDiff) {
      start = p
      bestDiff = d
    }
  }

  // Nearest point is way off — we don't have data close to the window.
  if (bestDiff > 24 * 3600 * 1000) return null
  // Zero start = reconstruction thinks wallet was empty. The percentage
  // is meaningless in that case, so skip the bucket entirely.
  if (start.total <= 0) return null

  const abs = end.total - start.total
  const pct = (abs / start.total) * 100
  return {
    window_days: windowDays,
    start_usd: start.total,
    end_usd: end.total,
    abs,
    pct,
  }
}

export async function GET() {
  try {
    // Every subfetch is wrapped so a single upstream failure (e.g. CoinGecko
    // 429) can't take down the whole endpoint. The client gets partial data
    // + a `warnings` array so it can still render something useful.
    const warnings: string[] = []

    // Kick off the 30-day reconstruction alongside the live fetches — it
    // does its own independent wallet + historical-price calls and doesn't
    // depend on any live values (we only use the live total to pin the
    // chart's tail below). Serializing these was adding the backfill's cold
    // fetch time on top of the live fetch time; running them in parallel
    // caps cold-start latency at the slower of the two.
    let reconstructed = false
    const historyPromise = reconstructPortfolioHistory(30).then(
      (h) => {
        reconstructed = true
        return h
      },
      (err) => {
        warnings.push(`history: ${(err as Error).message}`)
        return [] as ReconstructedPoint[]
      },
    )

    const [markets, ...walletResults] = await Promise.all([
      getMarkets().catch((err) => {
        warnings.push(`prices: ${(err as Error).message}`)
        return [] as Awaited<ReturnType<typeof getMarkets>>
      }),
      ...CHAINS.map(async (chain) => {
        try {
          const data = await FETCHERS[chain](WALLETS[chain])
          return { chain, balance: data.balance, error: null as string | null }
        } catch (err) {
          return {
            chain,
            balance: null as number | null,
            error: (err as Error).message,
          }
        }
      }),
    ])

    const marketMap = Object.fromEntries(markets.map((m) => [m.id, m]))

    // Build the current per-coin breakdown.
    const enriched = walletResults.map(({ chain, balance, error }) => {
      const meta = COIN_META[chain]
      const coin = marketMap[meta.id]
      const price = coin?.current_price ?? null
      const usd = balance != null && price != null ? balance * price : null
      return { chain, meta, balance, price, usd, coin, error }
    })

    const totalUsd = enriched.reduce((s, e) => s + (e.usd ?? 0), 0)

    const holdings: HoldingOut[] = enriched.map((e) => ({
      chain: e.chain,
      name: e.meta.name,
      symbol: e.meta.symbol,
      icon: e.meta.icon,
      color: e.meta.color,
      address: WALLETS[e.chain],
      explorer_url: e.meta.explorerAddr(WALLETS[e.chain]),
      balance: e.balance,
      price: e.price,
      usd: e.usd,
      share_pct: totalUsd > 0 && e.usd != null ? (e.usd / totalUsd) * 100 : null,
      change_24h_pct: e.coin?.price_change_percentage_24h ?? null,
      sparkline: e.coin?.sparkline_in_7d?.price ?? null,
      error: e.error,
    }))

    // Historical portfolio value (30 days) — kicked off in parallel above,
    // just await it here. Reconstructed from tx history + historical prices,
    // so no persistence layer required.
    const history = await historyPromise

    // Pin the head of the history to live totals so the chart tail matches the
    // header number (backfill's "today" uses CoinGecko end-of-day prices).
    if (history.length && totalUsd > 0) {
      history[history.length - 1] = {
        ...history[history.length - 1],
        total: totalUsd,
      }
    }

    const profit = {
      day: bucket(history, 1),
      week: bucket(history, 7),
      month: bucket(history, 30),
    }

    const out: NetworthOut = {
      total_usd: totalUsd,
      updated_at: new Date().toISOString(),
      holdings,
      history: history.map((h) => ({ date: h.date, timestamp: h.timestamp, total: h.total })),
      profit,
      reconstructed,
      warnings,
    }

    return NextResponse.json(
      { success: true, data: out },
      {
        headers: {
          'Cache-Control': `public, s-maxage=${REFRESH_SECONDS}, stale-while-revalidate=${REFRESH_SECONDS * 2}`,
        },
      },
    )
  } catch (err) {
    return NextResponse.json(
      { error: 'networth_failed', message: (err as Error).message },
      { status: 502 },
    )
  }
}

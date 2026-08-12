// Port of ZerxHub's lib/backfill.js — reconstructs daily portfolio value
// (USD) over the last N days from tx history + CoinGecko historical prices.
// This is what powers the chart when we don't have persisted snapshots.
import { fetchEth, fetchSol, fetchLtcMempool, type WalletData, type WalletTx } from './wallets'
import { fetchHistoricalPrices } from './prices'
import { WALLETS, COIN_META, type Chain, CHAINS } from './config'
import { swr } from './cache'

const TX_BACKFILL_LIMIT = 500
const DAY_MS = 86_400 * 1000

// Backfill uses litecoinspace directly because Blockchair's dashboards
// endpoint doesn't return per-tx amounts we need to rewind balances.
const BACKFILL_FETCHERS: Record<Chain, (addr: string) => Promise<WalletData>> = {
  LTC: (addr) => fetchLtcMempool(addr, TX_BACKFILL_LIMIT),
  ETH: (addr) => fetchEth(addr, TX_BACKFILL_LIMIT),
  SOL: (addr) => fetchSol(addr, TX_BACKFILL_LIMIT),
}

type BalanceEvent = { time: number; balance: number }

// Walk txs newest-to-oldest, subtracting each amount to get pre-tx balances.
// Result is oldest-first, each entry the balance immediately AFTER that event.
function buildBalanceTimeline(txs: WalletTx[] | undefined, currentBalance: number): BalanceEvent[] {
  const usable = (txs ?? [])
    .filter((t): t is WalletTx & { time: number; amount: number } => t.time != null && t.amount != null)
    .sort((a, b) => b.time - a.time)
  const nowSec = Math.floor(Date.now() / 1000)
  const events: BalanceEvent[] = [{ time: nowSec, balance: currentBalance }]
  let bal = currentBalance
  for (const tx of usable) {
    bal = bal - tx.amount
    events.push({ time: tx.time, balance: bal })
  }
  return events.sort((a, b) => a.time - b.time)
}

// Balance at target unix seconds. Returns null when target predates our
// earliest recorded event — we honestly don't know what the balance was
// before the tx history we have. Callers should treat null as "unreliable"
// rather than substituting 0, otherwise old points look artificially empty
// and profit calculations blow up (e.g. +9000% because "start" was $0).
function balanceAt(timeline: BalanceEvent[], targetSec: number): number | null {
  if (!timeline.length) return null
  if (targetSec < timeline[0].time) return null
  let result: number = timeline[0].balance
  for (const e of timeline) {
    if (e.time <= targetSec) result = e.balance
    else break
  }
  return Math.max(0, result)
}

// Nearest CoinGecko price (in [ms, usd] tuples) to a target ms.
function priceAt(prices: [number, number][], targetMs: number): number | null {
  if (!prices.length) return null
  let best = prices[0][1]
  let bestDiff = Math.abs(prices[0][0] - targetMs)
  for (const p of prices) {
    const d = Math.abs(p[0] - targetMs)
    if (d < bestDiff) {
      best = p[1]
      bestDiff = d
    }
  }
  return best
}

export type ReconstructedPoint = {
  date: string
  timestamp: number // unix ms of the sample
  total: number
  perChain: Partial<Record<Chain, number>>
}

// Cache the whole reconstruction — cheap for the composition itself, but
// avoids re-walking 30 days × 3 chains on every request. Sub-fetches are
// already SWR-cached, so this is just belt-and-suspenders for the compute.
export function reconstructPortfolioHistory(days = 30): Promise<ReconstructedPoint[]> {
  return swr(
    `reconstruct:${days}`,
    { freshMs: 5 * 60_000, staleMs: 30 * 60_000 },
    () => reconstructUncached(days),
  )
}

async function reconstructUncached(days: number): Promise<ReconstructedPoint[]> {
  const chains = CHAINS.filter((c) => BACKFILL_FETCHERS[c] && WALLETS[c])
  if (!chains.length) return []

  const perChain = await Promise.all(
    chains.map(async (chain) => {
      try {
        const [data, prices] = await Promise.all([
          BACKFILL_FETCHERS[chain](WALLETS[chain]),
          fetchHistoricalPrices(COIN_META[chain].id, days + 1),
        ])
        const currentBalance = data.balance ?? 0
        return {
          chain,
          currentBalance,
          timeline: buildBalanceTimeline(data.txs, currentBalance),
          prices,
        }
      } catch {
        return null
      }
    }),
  )

  const valid = perChain.filter((v): v is NonNullable<typeof v> => !!v)
  if (!valid.length) return []

  const now = Date.now()
  const points: ReconstructedPoint[] = []
  for (let i = days; i >= 0; i--) {
    const targetMs = now - i * DAY_MS
    const targetSec = Math.floor(targetMs / 1000)
    const date = new Date(targetMs).toISOString().slice(0, 10)
    let total = 0
    let reliable = true
    const perChainUsd: Partial<Record<Chain, number>> = {}
    for (const v of valid) {
      // Empty wallet today = safe to assume it's been empty all along.
      // Otherwise we need real timeline data covering the target; if the
      // tx history doesn't reach back this far, we skip the whole point
      // rather than pretending the balance was 0.
      if (v.currentBalance <= 0) {
        perChainUsd[v.chain] = 0
        continue
      }
      const bal = balanceAt(v.timeline, targetSec)
      const price = priceAt(v.prices, targetMs)
      if (bal == null || price == null) {
        reliable = false
        break
      }
      const usd = bal * price
      perChainUsd[v.chain] = usd
      total += usd
    }
    if (reliable) {
      points.push({ date, timestamp: targetMs, total, perChain: perChainUsd })
    }
  }
  return points
}

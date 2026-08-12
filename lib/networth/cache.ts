// Tiny SWR-style in-memory cache. Every fetcher on this endpoint wraps
// itself with `swr()` so:
//
//   - a fresh hit is instant, no upstream call
//   - a stale hit is instant AND kicks a background refresh (deduped per key)
//   - a total miss awaits the loader
//   - if the background refresh fails, we keep serving the stale value —
//     an upstream 429 or timeout never collapses the panel to "N/A everywhere"
//
// Everything is scoped to a single Node process. On serverless that means
// per-lambda: a warm lambda serves fast to everyone who lands on it, cold
// lambdas pay the first call. Combined with the Next.js Data Cache on the
// underlying `fetch()` calls we get two layers of protection.
type Entry<T> = {
  value: T
  freshUntil: number
  staleUntil: number
}

const store = new Map<string, Entry<unknown>>()
const inflight = new Map<string, Promise<unknown>>()

export type SwrOpts = {
  /** Below this age, no refresh triggered. */
  freshMs: number
  /** Additional window during which stale data is served while refreshing. */
  staleMs: number
}

export async function swr<T>(
  key: string,
  opts: SwrOpts,
  loader: () => Promise<T>,
): Promise<T> {
  const now = Date.now()
  const hit = store.get(key) as Entry<T> | undefined

  if (hit && now < hit.freshUntil) return hit.value

  if (hit && now < hit.staleUntil) {
    if (!inflight.has(key)) triggerRefresh(key, opts, loader)
    return hit.value
  }

  // Fully expired or never cached — must await. Dedup concurrent misses.
  const existing = inflight.get(key) as Promise<T> | undefined
  if (existing) return existing
  const p = loader()
    .then((v) => {
      store.set(key, {
        value: v,
        freshUntil: Date.now() + opts.freshMs,
        staleUntil: Date.now() + opts.freshMs + opts.staleMs,
      })
      return v
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

function triggerRefresh<T>(key: string, opts: SwrOpts, loader: () => Promise<T>): void {
  const p = loader()
    .then((v) => {
      store.set(key, {
        value: v,
        freshUntil: Date.now() + opts.freshMs,
        staleUntil: Date.now() + opts.freshMs + opts.staleMs,
      })
      return v
    })
    .catch((err) => {
      // Background failure — keep the stale value alive and give upstream
      // a short breathing room before we hammer it again.
      const existing = store.get(key)
      if (existing) {
        existing.staleUntil = Math.max(
          existing.staleUntil,
          Date.now() + Math.min(opts.staleMs, 60_000),
        )
      }
      console.warn(`[swr] background refresh failed for ${key}:`, (err as Error).message)
      return undefined as unknown as T
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, p)
}

// ---------- Etherscan throttle ----------
// Etherscan free tier caps at 3-5 req/s and returns "Max calls per sec rate
// limit reached" when we burst. Even with caching, cold starts can fire the
// balance + txlist calls for both the live route AND the 500-tx backfill in
// parallel — enough to trip it. This queue serializes those calls with a
// small gap, so bursts are spread over ~a second instead of racing.
let etherscanChain: Promise<unknown> = Promise.resolve()
const ETHERSCAN_MIN_GAP_MS = 400

export function throttleEtherscan<T>(fn: () => Promise<T>): Promise<T> {
  const p = etherscanChain.then(() => fn())
  // Swallow errors on the chain so one failure doesn't block later calls.
  etherscanChain = p
    .catch(() => undefined)
    .then(() => new Promise((r) => setTimeout(r, ETHERSCAN_MIN_GAP_MS)))
  return p
}

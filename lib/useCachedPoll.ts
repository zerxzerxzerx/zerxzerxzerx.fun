'use client'

import { useEffect, useRef, useState } from 'react'

// Small shared hook for the "fetch a JSON endpoint, keep it fresh on a
// background poll, show cached data instantly on remount" pattern. Used by
// the profile modals — all of them want the same three behaviors:
//   1. Hydrate initial state from sessionStorage so re-opening a modal is
//      instant instead of showing a skeleton.
//   2. Poll on an interval to pick up server-cache refreshes.
//   3. Stop polling when the tab is hidden — a user who leaves the site
//      open in a background tab shouldn't drive traffic forever.
//
// The fetcher is held in a ref so the interval doesn't restart on every
// parent render (which would defeat the point of the poll). Return `null`
// from the fetcher to skip an update (useful for "half-cooked" upstream
// responses where you'd rather keep the old data on screen).

type Cached<T> = { at: number; data: T }

function readCache<T>(key: string, ttlMs: number): T | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Cached<T>
    if (!parsed?.data || Date.now() - parsed.at > ttlMs) return null
    return parsed.data
  } catch {
    return null
  }
}

function writeCache<T>(key: string, data: T) {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data }))
  } catch {
    /* quota exceeded, no-op */
  }
}

export type CachedPollOptions<T> = {
  /** SessionStorage key. Include any input params in the key so different
   *  arguments (e.g. different usernames) don't collide. */
  cacheKey: string
  /** How long a cache entry is considered fresh. Default: 10 min, matching
   *  the standard server-side revalidate window. */
  cacheTtlMs?: number
  /** Background poll interval. */
  pollMs: number
  /** Fetcher — return `null` to skip the update. Throws for real errors. */
  fetcher: () => Promise<T | null>
  /** When this value changes, state is wiped and the cache is re-read. Use
   *  the same value(s) as your fetcher's inputs (e.g. `username`). */
  resetKey: string | number
}

export type CachedPollResult<T> = {
  data: T | null
  error: string | null
}

export function useCachedPoll<T>({
  cacheKey,
  cacheTtlMs = 10 * 60 * 1000,
  pollMs,
  fetcher,
  resetKey,
}: CachedPollOptions<T>): CachedPollResult<T> {
  const [data, setData] = useState<T | null>(() => readCache<T>(cacheKey, cacheTtlMs))
  const [error, setError] = useState<string | null>(null)

  // Latest fetcher without re-triggering the effect on every render.
  const fetcherRef = useRef(fetcher)
  useEffect(() => {
    fetcherRef.current = fetcher
  }, [fetcher])

  // Re-seed from cache and clear errors when the reset key flips (e.g.
  // user switches which profile is being viewed).
  useEffect(() => {
    setData(readCache<T>(cacheKey, cacheTtlMs))
    setError(null)
  }, [resetKey, cacheKey, cacheTtlMs])

  useEffect(() => {
    let alive = true
    let intervalId: ReturnType<typeof setInterval> | null = null
    // Snapshot at effect start; flipped to true after any successful load.
    // Errors only surface when there's nothing on screen to fall back on.
    let hasData = readCache<T>(cacheKey, cacheTtlMs) != null

    const load = async () => {
      try {
        const next = await fetcherRef.current()
        if (!alive || next == null) return
        setData(next)
        setError(null)
        writeCache(cacheKey, next)
        hasData = true
      } catch (e) {
        if (!alive) return
        if (!hasData) setError((e as Error).message)
      }
    }

    const start = () => {
      if (intervalId != null) return
      void load()
      intervalId = setInterval(() => {
        void load()
      }, pollMs)
    }
    const stop = () => {
      if (intervalId != null) {
        clearInterval(intervalId)
        intervalId = null
      }
    }
    const onVis = () => {
      if (document.hidden) stop()
      else start()
    }

    start()
    document.addEventListener('visibilitychange', onVis)

    return () => {
      alive = false
      stop()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [resetKey, cacheKey, cacheTtlMs, pollMs])

  return { data, error }
}

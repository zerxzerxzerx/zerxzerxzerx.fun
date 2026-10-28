// Shared "talk to Roblox's (and Rolimons') microservices without getting
// WAF-403'd" fetch helper. Originally lived inline in app/api/roblox/route.ts;
// pulled out once app/api/roblox/item/route.ts needed the exact same
// behavior for a second endpoint.
//
// Roblox's public API surface is spread across ~a dozen subdomain-scoped
// microservices behind Cloudflare. Historically the Node/Edge runtimes were
// WAF-blocked from these (403s on datacenter IPs / undici TLS fingerprints),
// so the community-run `roproxy.com` mirror was used as a bypass. As of
// early 2026 two things flipped: (a) direct roblox.com endpoints now respond
// 200 anonymously to Node's undici when a plausible desktop Chrome UA is
// set — the old WAF rule appears to have been relaxed for GET/POST reads —
// and (b) roproxy is behind a shared Cloudflare rate limit that's near-
// permanently exhausted since it became the community-default proxy for
// every bio-page / Discord bot. So every call here goes straight to the
// real origin (roblox.com subdomains, api.rolimons.com) with the UA spoof.
//
// api.rolimons.com's pretty HTML pages (rolimons.com/player/*, /item/*) are
// separately Cloudflare-fingerprinted and 403 server-side callers no matter
// what UA is set — only their JSON API subdomain is reachable this way.
const UPSTREAM_TIMEOUT_MS = 6000
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

async function safeJson<T = unknown>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T
  } catch {
    return null
  }
}

// Wraps a fetch so a network hiccup, non-OK response, or JSON parse error
// resolves to `null` instead of throwing. Callers combine these with plain
// `Promise.all` (not `allSettled`) since every slot always resolves — a
// slow/broken microservice just leaves its data null rather than failing
// the whole response, and individual fields render "—" on the client.
export async function tryFetch<T = unknown>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, {
      ...init,
      // Deliberately no `next: { revalidate: N }` — Next's fetch cache
      // rewrites the outgoing request in a way Roblox's WAF flags as
      // bot-like (missing/altered sec-fetch-* headers + an internal Next
      // cache key header), which gets a hard 403. Caching instead happens
      // at the outer route's Cache-Control header (public, s-maxage=…), so
      // the CDN caches the final response with no upstream WAF trip.
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
        'User-Agent': CHROME_UA,
        ...(init?.headers || {}),
      },
    })
    if (!res.ok) {
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.warn('[roblox] upstream not-ok', url, res.status)
      }
      return null
    }
    return await safeJson<T>(res)
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('[roblox] upstream threw', url, (e as Error).message)
    }
    return null
  }
}

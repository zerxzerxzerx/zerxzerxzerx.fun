// Small typed wrappers around fetch with sane timeouts + Next.js cache hints.
// All calls to upstream chain / market APIs go through these. Retries 429s
// with backoff so a single burst against CoinGecko's free tier doesn't blow
// up the whole endpoint.
type FetchOpts = {
  timeoutMs?: number
  headers?: Record<string, string>
  revalidate?: number
  retries?: number
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])

async function fetchWithRetry(url: string, init: RequestInit, retries: number): Promise<Response> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, init)
      if (!RETRYABLE_STATUS.has(res.status) || attempt === retries) return res
      // Respect Retry-After when the server sends one, otherwise exponential
      // backoff bounded to a second or two so we don't stall the whole route.
      const retryAfterHeader = res.headers.get('retry-after')
      const retryAfterMs = retryAfterHeader
        ? Math.min(2000, Number(retryAfterHeader) * 1000)
        : 300 * Math.pow(2, attempt)
      await new Promise((r) => setTimeout(r, retryAfterMs))
    } catch (err) {
      lastErr = err
      if (attempt === retries) throw err
      await new Promise((r) => setTimeout(r, 300 * Math.pow(2, attempt)))
    }
  }
  // Unreachable — the loop either returns a Response or throws.
  throw lastErr ?? new Error('fetch failed')
}

export async function getJSON<T = unknown>(url: string, opts: FetchOpts = {}): Promise<T> {
  const { timeoutMs = 8000, headers, revalidate, retries = 1 } = opts
  const res = await fetchWithRetry(
    url,
    {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json', ...headers },
      ...(revalidate !== undefined ? { next: { revalidate } } : {}),
    },
    retries,
  )
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  return (await res.json()) as T
}

export async function postJSON<T = unknown>(
  url: string,
  body: unknown,
  opts: FetchOpts = {},
): Promise<T> {
  const { timeoutMs = 8000, headers, revalidate, retries = 1 } = opts
  const res = await fetchWithRetry(
    url,
    {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
      ...(revalidate !== undefined ? { next: { revalidate } } : {}),
    },
    retries,
  )
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  return (await res.json()) as T
}

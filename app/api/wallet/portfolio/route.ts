import { NextResponse } from 'next/server'
import { getWalletPortfolio } from '@/lib/wallet/portfolio'

// Node runtime: this route talks to Etherscan + raw JSON-RPC providers, same
// "needs real outbound fetch, not edge" reasoning as app/api/roblox/route.ts.
export const runtime = 'nodejs'

// Deliberately takes NO query params / request body of any kind. The whole
// point of this route (see lib/wallet/config.ts + lib/wallet/portfolio.ts)
// is that it serves exactly one hardcoded, server-side wallet — accepting an
// `?address=` param here would turn this into a general-purpose address
// lookup proxy, which the feature spec explicitly rules out. If that's ever
// needed, it's a different, separately-rate-limited feature.
// Hard ceiling on how long this route will ever take to respond. Without
// this, a slow/unreachable provider deep in the fallback chain (Etherscan ->
// 3 RPC providers -> block-log scan, each with its own per-call timeout)
// could stack up to a minute-plus of serial timeouts before the client ever
// gets a response — which is exactly what was observed: the modal's spinner
// just sat there because the HTTP request itself hadn't resolved yet, not
// because anything was actually stuck forever. This guarantees the browser
// always gets *a* response quickly, so the client shows its error state
// instead of spinning indefinitely.
const ROUTE_TIMEOUT_MS = 9000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('wallet portfolio: route timeout')), ms)
    }),
  ])
}

export async function GET() {
  try {
    const portfolio = await withTimeout(getWalletPortfolio(), ROUTE_TIMEOUT_MS)
    return NextResponse.json(
      { success: true, data: portfolio },
      {
        headers: {
          // Short window — this is live financial data, not a profile bio.
          'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30',
        },
      },
    )
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('[wallet] portfolio route failed:', (e as Error).message)
    }
    return NextResponse.json(
      { error: 'unavailable', message: 'Could not refresh wallet data right now.' },
      { status: 502 },
    )
  }
}

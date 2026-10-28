import { NextResponse } from 'next/server'

// Discord's own client resolves a generic game-icon thumbnail for any
// Activity that doesn't carry a per-session rich-presence image
// (assets.large_image) by falling back to the game's entry in its public
// "detectable applications" list — Valorant, for one, never sets a
// large_image, so without this lookup DiscordProfile.tsx's ActivityRow has
// nothing to show but a generic Gamepad2 glyph even though Discord itself
// renders the real app icon there.
//
// That list is ~13 MB and changes rarely (new/renamed detectable games), so
// unlike every other route in app/api/ this one deliberately skips the edge
// runtime: the win we actually want is the in-memory `cache` map below
// surviving across requests on the same warm instance, which matters far
// more here than edge's faster cold start, and parsing a 13 MB response is
// more comfortably done in a Node.js function. `next.revalidate` on the
// fetch itself is a second layer on top — even after a cold start evicts the
// in-memory cache, Vercel's own fetch cache can still serve the raw Discord
// response without a real round trip.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

let cache: { map: Map<string, string>; fetchedAt: number } | null = null
let inflight: Promise<Map<string, string>> | null = null

async function fetchIconMap(): Promise<Map<string, string>> {
  const r = await fetch('https://discord.com/api/v10/applications/detectable', {
    next: { revalidate: 86400 },
    signal: AbortSignal.timeout(15000),
  })
  if (!r.ok) throw new Error(`Discord returned ${r.status}`)
  const list = (await r.json()) as { id: string; icon_hash?: string | null }[]
  const map = new Map<string, string>()
  for (const app of list) {
    if (app.icon_hash) map.set(app.id, app.icon_hash)
  }
  return map
}

async function getIconMap(): Promise<Map<string, string>> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.map
  // Collapse concurrent cold-cache requests into one upstream fetch instead
  // of each racing to pull the same 13 MB payload.
  if (!inflight) {
    inflight = fetchIconMap()
      .then((map) => {
        cache = { map, fetchedAt: Date.now() }
        return map
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const appId = searchParams.get('app_id')?.trim()

  if (!appId || !/^\d{15,25}$/.test(appId)) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 })
  }

  try {
    const map = await getIconMap()
    const hash = map.get(appId)
    if (!hash) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    return NextResponse.json(
      { url: `https://cdn.discordapp.com/app-icons/${appId}/${hash}.png?size=128` },
      { headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800' } },
    )
  } catch {
    return NextResponse.json({ error: 'network_error' }, { status: 502 })
  }
}

import { NextResponse } from 'next/server'
import { ZERX } from '@/lib/constants'
import { getRecordedHistory, mergeHistory, recordSnapshot, type ValuePoint } from '@/lib/rolimonsHistory'
import { tryFetch } from '@/lib/robloxFetch'

// Node runtime — Roblox's Cloudflare WAF (both directly and in front of
// roproxy.com) fingerprints TLS ClientHellos and 403s the edge runtime's
// undici stack from datacenter IPs. Node's native undici in serverless
// functions passes through cleanly, so this route runs on nodejs. The
// tradeoff (slightly higher cold start than edge) is invisible behind
// the s-maxage=300 CDN cache set at the response layer.
//
// The work itself is a pure fetch + JSON fan-out — every upstream call
// is I/O-bound and runs in parallel via `Promise.all`, so end-to-end
// latency is bounded by the slowest Roblox microservice (~250 ms typical).
export const runtime = 'nodejs'
export const revalidate = 300

// Roblox's public API surface is spread across ~a dozen subdomain-scoped
// microservices. Historically the Node/Edge runtimes were WAF-blocked
// from these (403s on datacenter IPs / undici TLS fingerprints), so the
// community-run `roproxy.com` mirror was used as a bypass. As of early
// 2026 two things flipped:
//   (a) direct roblox.com endpoints now respond 200 anonymously to
//       Node's undici when a plausible desktop Chrome UA is set — the
//       old WAF rule appears to have been relaxed for GET/POST reads.
//   (b) roproxy is behind a shared Cloudflare rate limit (HTTP 429,
//       code 1015) that's near-permanently exhausted since it became
//       the community-default proxy for every bio-page / Discord bot.
// So we point everything at roblox.com directly. `tryFetch` still sets
// the Chrome UA to keep the WAF from re-flagging us on future traffic.
//
// `accountinformation.roblox.com` hosts the classic "Roblox Badges"
// (Veteran, Bricksmith, Homestead, etc.). Those don't require auth,
// unlike the newer badges.roblox.com per-place badges endpoint which
// does.
const R = {
  users: 'https://users.roblox.com',
  presence: 'https://presence.roblox.com',
  friends: 'https://friends.roblox.com',
  accountInfo: 'https://accountinformation.roblox.com',
  groups: 'https://groups.roblox.com',
  thumbnails: 'https://thumbnails.roblox.com',
  games: 'https://games.roblox.com',
  // apis.roblox.com covers the universes/place-id lookup endpoint.
  universes: 'https://apis.roblox.com',
  // Official collectibles (limiteds) listing — public for any user whose
  // inventory privacy allows it. Same data Roblox's own profile page uses
  // to render the "Limiteds" inventory tab shown in the HTML the owner
  // pasted in (mix_item cards with RAP/serial).
  inventory: 'https://inventory.roblox.com',
} as const

// `tryFetch` (shared with app/api/roblox/item/route.ts) is bounded to 6s
// per call and resolves to `null` on any failure instead of throwing — see
// lib/robloxFetch.ts for the full WAF-bypass rationale. That null-on-error
// semantics is what makes the plain `Promise.all` below safe: every slot
// resolves, so one timing-out endpoint just leaves its slot null rather
// than blowing up the modal.

// --- Response shapes from Roblox (typed loosely — only fields we consume) ---
type RbxUsernameLookup = {
  data?: {
    requestedUsername: string
    id: number
    name: string
    displayName: string
    hasVerifiedBadge?: boolean
  }[]
}
type RbxUser = {
  description?: string
  created?: string
  name?: string
  displayName?: string
  isBanned?: boolean
  hasVerifiedBadge?: boolean
  id?: number
}
type RbxCount = { count?: number }
type RbxPresence = {
  userPresences?: {
    userPresenceType?: number
    lastLocation?: string
    placeId?: number | null
    rootPlaceId?: number | null
    gameId?: string | null
    universeId?: number | null
    userId?: number
    lastOnline?: string
  }[]
}
// accountinformation.roblox.com's /roblox-badges endpoint returns the
// classic profile badges (Veteran, Bricksmith, etc.) as a flat array
// with imageUrl already baked in — no need for a second thumbnail
// batch. The newer badges.roblox.com/v1/users/{id}/badges endpoint
// (per-place gameplay achievements) requires auth as of late 2024.
type RbxRobloxBadge = {
  id: number
  name: string
  description: string | null
  imageUrl?: string
}
type RbxGroup = {
  group: { id: number; name: string; memberCount: number }
  role: { name: string; rank: number }
}
type RbxGroupList = { data?: RbxGroup[] }
type RbxThumb = {
  data?: { targetId: number; state: string; imageUrl?: string }[]
}
type RbxUniversePlace = { universeId?: number | null }
// Rolimons is the community-standard Roblox trading-value tracker. We hit
// their public `api.rolimons.com/players/v1/playerinfo/{id}` endpoint for
// value / RAP / rank plus the `rolibadges` map. The pretty HTML page is
// Cloudflare-fingerprinted and 403s server-to-server, so scraping the
// inline badge SVGs is off the table — we render text-based badge pills
// on the client instead, styled by tier.
type RolimonsBadge = { key: string; name: string; tier: 'value' | 'trade' | 'special' }
type RolimonsData = {
  value: number | null
  rap: number | null
  rank: number | null
  badges: RolimonsBadge[]
  history: ValuePoint[]
}
// The API returns `rolibadges` as an object whose keys are stable badge
// slugs. The presence of a key means the player earned it — the value is
// an unlock timestamp we don't need. Unknown slugs (Rolimons occasionally
// adds new badges) fall through to a humanized name with the "special"
// tier so they still render as a chip.
type RolimonsPlayerApi = {
  success?: boolean
  value?: number | null
  rap?: number | null
  rank?: number | null
  rolibadges?: Record<string, number>
}
const ROLI_BADGE_MAP: Record<string, { name: string; tier: RolimonsBadge['tier'] }> = {
  value_1m: { name: '1M+', tier: 'value' },
  value_500k: { name: '500K+', tier: 'value' },
  value_100k: { name: '100K+', tier: 'value' },
  create_100_trade_ads: { name: 'Frequent Trader', tier: 'trade' },
  create_10_trade_ads: { name: 'Trade Advertiser', tier: 'trade' },
  own_10_items: { name: 'Collector', tier: 'trade' },
  own_1_kotn_item: { name: 'Evening Royalty', tier: 'special' },
  verified: { name: 'Verified', tier: 'special' },
}
function rolimonsFromApi(api: RolimonsPlayerApi): RolimonsData {
  const badges: RolimonsBadge[] = Object.keys(api.rolibadges || {}).map((k) => {
    const meta = ROLI_BADGE_MAP[k]
    if (meta) return { key: k, name: meta.name, tier: meta.tier }
    return {
      key: k,
      name: k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      tier: 'special' as const,
    }
  })
  return {
    value: api.value ?? null,
    rap: api.rap ?? null,
    rank: api.rank ?? null,
    badges,
    history: [],
  }
}
// inventory.roblox.com's collectibles endpoint — the official source for
// a user's owned limiteds (Roblox's own profile "Limiteds" tab reads from
// this same data). `recentAveragePrice` is RAP; Rolimons' RAP figure is
// sourced from this exact field across all players.
type RbxCollectible = {
  userAssetId?: number
  serialNumber?: number | null
  assetId?: number
  name?: string
  recentAveragePrice?: number | null
}
type RbxCollectiblesResponse = { data?: RbxCollectible[] }
type RbxUniverseDetails = {
  data?: {
    id: number
    rootPlaceId: number
    name: string
    description?: string
    creator?: { id: number; name: string; type: string; hasVerifiedBadge?: boolean }
    playing?: number
    visits?: number
    maxPlayers?: number
    price?: number | null
  }[]
}

// Human-readable label for Roblox's numeric presence type. 0=offline shows
// "Offline"; 1 is "Online" on the website; 2 is actively playing a place;
// 3 means the user is in Roblox Studio (rare, dev-facing).
function presenceLabel(t: number | undefined): 'Offline' | 'Online' | 'In-Game' | 'Studio' {
  switch (t) {
    case 1: return 'Online'
    case 2: return 'In-Game'
    case 3: return 'Studio'
    default: return 'Offline'
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const idParam = searchParams.get('id')?.trim()
  const username = searchParams.get('username')?.trim()

  // Accept either a numeric Roblox user id (skips the lookup round-trip
  // entirely — used by the bio page, which already knows its own id) or a
  // username (resolved via the lookup below — used for arbitrary profiles).
  let userId: number
  let fallbackName: string | null = null
  let fallbackDisplayName: string | null = null

  if (idParam) {
    if (!/^\d{1,20}$/.test(idParam)) {
      return NextResponse.json(
        { error: 'invalid_id', message: 'A valid Roblox user id is required.' },
        { status: 400 },
      )
    }
    userId = Number(idParam)
  } else if (username) {
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return NextResponse.json(
        { error: 'invalid_username', message: 'A valid Roblox username is required.' },
        { status: 400 },
      )
    }

    // Resolve username → userId. `POST /v1/usernames/users` is the
    // canonical exact-match lookup. We previously used
    // `GET /v1/users/search?keyword=…` to work around a Roblox WAF rule on
    // POSTs from server-side fetches, but that search endpoint started
    // returning `{errors:[{code:0}]}` in early 2026 (Roblox
    // anonymous-degraded it). The POST endpoint responds fine with our
    // Chrome UA — same origin as everything else.
    const lookup = await tryFetch<RbxUsernameLookup>(`${R.users}/v1/usernames/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
    })
    const hit = lookup?.data?.[0]
    if (!hit || typeof hit.id !== 'number') {
      return NextResponse.json(
        { error: 'not_found', message: `Roblox user "${username}" not found.` },
        { status: 404 },
      )
    }
    userId = hit.id
    fallbackName = hit.name
    fallbackDisplayName = hit.displayName
  } else {
    return NextResponse.json(
      { error: 'invalid_request', message: 'A Roblox user id or username is required.' },
      { status: 400 },
    )
  }

  // 2. Everything else fans out in parallel. `Promise.all` (not allSettled)
  //    is safe here because each `tryFetch` swallows its own errors and
  //    resolves to null — so the slowest / flakiest microservice can't
  //    take out the whole response, and every slot always resolves.
  const [
    profile,
    presence,
    friends,
    followers,
    following,
    badgesRes,
    groupsRes,
    headshotRes,
    fullbodyRes,
    rolimonsApi,
    collectiblesRes,
  ] = await Promise.all([
    tryFetch<RbxUser>(`${R.users}/v1/users/${userId}`),
    tryFetch<RbxPresence>(`${R.presence}/v1/presence/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: [userId] }),
    }),
    tryFetch<RbxCount>(`${R.friends}/v1/users/${userId}/friends/count`),
    tryFetch<RbxCount>(`${R.friends}/v1/users/${userId}/followers/count`),
    tryFetch<RbxCount>(`${R.friends}/v1/users/${userId}/followings/count`),
    // Classic Roblox badges (Veteran, Bricksmith, Homestead, etc.) — this
    // endpoint stayed public through the 2024 badges.roblox.com auth-gate
    // change. Perfect for a bio-page brag wall.
    tryFetch<RbxRobloxBadge[]>(`${R.accountInfo}/v1/users/${userId}/roblox-badges`),
    tryFetch<RbxGroupList>(`${R.groups}/v2/users/${userId}/groups/roles`),
    tryFetch<RbxThumb>(
      `${R.thumbnails}/v1/users/avatar-headshot?userIds=${userId}&size=420x420&format=Png&isCircular=false`,
    ),
    tryFetch<RbxThumb>(
      `${R.thumbnails}/v1/users/avatar?userIds=${userId}&size=420x420&format=Png&isCircular=false`,
    ),
    // Trading value / RAP / rank / RoliBadges from Rolimons's public API.
    // We used to also try scraping their HTML page (has prettier inline
    // badge SVGs) but Cloudflare fingerprints server-side callers and
    // 403s it, so the JSON API is the only viable path.
    tryFetch<RolimonsPlayerApi>(`https://api.rolimons.com/players/v1/playerinfo/${userId}`),
    // Owned limiteds, sorted by Roblox's own API in acquisition order —
    // we re-sort by RAP below so the priciest pieces lead the grid.
    tryFetch<RbxCollectiblesResponse>(
      `${R.inventory}/v1/users/${userId}/assets/collectibles?limit=100&sortOrder=Desc`,
    ),
  ])
  const rolimons: RolimonsData | null = rolimonsApi ? rolimonsFromApi(rolimonsApi) : null

  // The value-history chart (seed-digitized past + recorded-going-forward
  // present) only makes sense for the site owner's own profile — looking up
  // an arbitrary Roblox user's Rolimons page has no reference chart to seed
  // from, so we don't record or attach history for anyone else.
  if (rolimons && userId === Number(ZERX.robloxId)) {
    const [recorded] = await Promise.all([
      getRecordedHistory(userId),
      recordSnapshot(userId, rolimons.value, rolimons.rap),
    ])
    rolimons.history = mergeHistory(recorded)
  }

  // 3. If the user is in a game, follow the placeId → universeId → game
  //    details chain so the modal can render a link + player count. Fire
  //    both requests, but only after we know the placeId.
  const pres = presence?.userPresences?.[0]
  const placeId = pres?.placeId ?? pres?.rootPlaceId ?? null
  let currentGame:
    | {
        universeId: number
        placeId: number
        name: string
        creator: string
        playing: number | null
        visits: number | null
        url: string
      }
    | null = null
  if (placeId && (pres?.userPresenceType === 2 || pres?.userPresenceType === 3)) {
    const universeLookup = await tryFetch<RbxUniversePlace>(
      `${R.universes}/universes/v1/places/${placeId}/universe`,
    )
    const universeId = universeLookup?.universeId ?? null
    if (universeId) {
      const details = await tryFetch<RbxUniverseDetails>(
        `${R.games}/v1/games?universeIds=${universeId}`,
      )
      const first = details?.data?.[0]
      if (first) {
        currentGame = {
          universeId,
          placeId,
          name: first.name,
          creator: first.creator?.name ?? '—',
          playing: first.playing ?? null,
          visits: first.visits ?? null,
          url: `https://www.roblox.com/games/${placeId}`,
        }
      }
    }
  }

  // 4. Groups may return dozens of entries — cap to top 6 by member count
  //    so the modal doesn't scroll forever, and fetch icons for those in
  //    one batched thumbnail request.
  const groupsTop = (groupsRes?.data || [])
    .slice()
    .sort((a, b) => (b.group?.memberCount ?? 0) - (a.group?.memberCount ?? 0))
    .slice(0, 6)
  const groupIconsMap = new Map<number, string>()
  if (groupsTop.length) {
    const groupIcons = await tryFetch<RbxThumb>(
      `${R.thumbnails}/v1/groups/icons?groupIds=${groupsTop.map((g) => g.group.id).join(',')}&size=150x150&format=Png&isCircular=true`,
    )
    for (const t of groupIcons?.data || []) {
      if (t.imageUrl) groupIconsMap.set(t.targetId, t.imageUrl)
    }
  }

  // 4b. Limiteds — sort by RAP descending (the API's own sort order is
  //     acquisition-based, not value-based) and cap to 30 so the thumbnail
  //     batch call and the grid stay a reasonable size.
  const limitedsTop = (collectiblesRes?.data || [])
    .slice()
    .sort((a, b) => (b.recentAveragePrice ?? 0) - (a.recentAveragePrice ?? 0))
    .slice(0, 30)
  const limitedIconsMap = new Map<number, string>()
  if (limitedsTop.length) {
    const assetIds = limitedsTop.map((c) => c.assetId).filter((id): id is number => !!id)
    const limitedIcons = await tryFetch<RbxThumb>(
      `${R.thumbnails}/v1/assets?assetIds=${assetIds.join(',')}&size=150x150&format=Png&isCircular=false`,
    )
    for (const t of limitedIcons?.data || []) {
      if (t.imageUrl) limitedIconsMap.set(t.targetId, t.imageUrl)
    }
  }

  // 5. Classic Roblox Badges (Veteran, Bricksmith, Homestead, Warrior, etc.)
  //    are returned as a flat array with `imageUrl` already baked in —
  //    unlike `/v1/badges/{id}/icon` which needs a second thumbnail batch
  //    call. So no icon fan-out here.
  const badgesTop = (badgesRes || []).slice(0, 10)

  const headshotUrl = headshotRes?.data?.[0]?.imageUrl || null
  const fullbodyUrl = fullbodyRes?.data?.[0]?.imageUrl || null

  const data = {
    id: userId,
    username: profile?.name || fallbackName || String(userId),
    displayName: profile?.displayName || fallbackDisplayName || profile?.name || String(userId),
    description: profile?.description ?? '',
    created: profile?.created ?? null,
    isBanned: !!profile?.isBanned,
    hasVerifiedBadge: !!profile?.hasVerifiedBadge,
    profileUrl: `https://www.roblox.com/users/${userId}/profile`,
    presence: {
      type: presenceLabel(pres?.userPresenceType),
      lastLocation: pres?.lastLocation ?? null,
      lastOnline: pres?.lastOnline ?? null,
    },
    counts: {
      friends: friends?.count ?? null,
      followers: followers?.count ?? null,
      following: following?.count ?? null,
      groups: groupsRes?.data?.length ?? null,
      badges: badgesRes?.length ?? null,
    },
    badges: badgesTop.map((b) => ({
      id: b.id,
      name: b.name,
      description: b.description,
      icon_url: b.imageUrl || null,
    })),
    groups: groupsTop.map((g) => ({
      id: g.group.id,
      name: g.group.name,
      memberCount: g.group.memberCount,
      role: g.role.name,
      rank: g.role.rank,
      icon_url: groupIconsMap.get(g.group.id) || null,
      url: `https://www.roblox.com/groups/${g.group.id}`,
    })),
    currentGame,
    thumbnails: {
      headshot: headshotUrl,
      fullbody: fullbodyUrl,
    },
    limiteds: limitedsTop.map((c) => ({
      id: c.userAssetId ?? c.assetId ?? 0,
      assetId: c.assetId ?? 0,
      name: c.name || 'Unknown Item',
      rap: c.recentAveragePrice ?? null,
      serial: c.serialNumber ?? null,
      icon_url: (c.assetId && limitedIconsMap.get(c.assetId)) || null,
      url: `https://www.roblox.com/catalog/${c.assetId}`,
    })),
    rolimons,
    fetchedAt: new Date().toISOString(),
  }

  return NextResponse.json(
    { success: true, data },
    {
      headers: {
        // 5-min freshness at the edge; another 10 min of stale-while-
        // revalidate so a background refresh always keeps the last known
        // profile hot even if Roblox's APIs are briefly flaky.
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    },
  )
}

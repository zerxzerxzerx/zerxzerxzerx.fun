import { NextResponse } from 'next/server'

// Edge runtime: cold start ~50 ms vs ~500 ms on Node.js Lambda. Only does
// fetch + regex + JSON on the response HTML — all edge-compatible.
export const runtime = 'edge'
// Same 10-min refresh window as the GitHub route. TikTok has no public API
// for profile data and rate-limits aggressive scraping, so 10 min is a good
// balance — Next.js's Data Cache serves cached data instantly to every
// visitor and only refetches from TikTok once per window.
const REFRESH_SECONDS = 600
export const revalidate = 600

// TikTok usernames: 2–24 chars, lowercase letters/digits/underscores/periods.
// (TikTok's actual rules are a bit fuzzier, but this covers everything valid.)
const USERNAME_RE = /^[A-Za-z0-9._]{1,30}$/

function formatCount(n: number): string {
  if (n < 1000) return n.toString()
  if (n < 1_000_000) {
    const v = n / 1000
    return (v < 10 ? v.toFixed(1) : v.toFixed(0)).replace(/\.0$/, '') + 'k'
  }
  if (n < 1_000_000_000) {
    const v = n / 1_000_000
    return (v < 10 ? v.toFixed(1) : v.toFixed(0)).replace(/\.0$/, '') + 'M'
  }
  return (n / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'B'
}

// TikTok's "empty display name" is a real thing — accounts with no nickname
// set have a `nickname` field containing U+FFF6 or similar specials/private-use
// characters. Strip them out; if what's left is empty, treat as no nickname.
function cleanNickname(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const cleaned = raw
    .replace(/[\uFFF0-\uFFFF\uE000-\uF8FF]/g, '')
    .trim()
  return cleaned.length > 0 ? cleaned : null
}

type UniversalData = {
  __DEFAULT_SCOPE__?: {
    'webapp.user-detail'?: {
      userInfo?: {
        user?: {
          id?: string
          uniqueId?: string
          nickname?: string
          signature?: string
          avatarLarger?: string
          avatarMedium?: string
          avatarThumb?: string
          verified?: boolean
          createTime?: number
          privateAccount?: boolean
          region?: string
        }
        stats?: {
          followerCount?: number
          followingCount?: number
          heartCount?: number
          videoCount?: number
          friendCount?: number
        }
      }
      statusCode?: number
      statusMsg?: string
    }
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const username = searchParams.get('username')?.trim()

  if (!username || !USERNAME_RE.test(username)) {
    return NextResponse.json(
      { error: 'invalid_username', message: 'A valid TikTok username is required.' },
      { status: 400 },
    )
  }

  try {
    // TikTok gates the profile page behind a browser-shaped User-Agent; a
    // plain "curl/8.x" gets a challenge page instead of the real HTML. A
    // recent-ish Chrome UA works reliably.
    const upstream = await fetch(`https://www.tiktok.com/@${encodeURIComponent(username)}`, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      next: { revalidate: REFRESH_SECONDS },
      // TikTok is the flakiest of the three upstreams — bound it so the
      // serverless function doesn't burn its whole budget on a hang.
      signal: AbortSignal.timeout(8000),
    })

    if (!upstream.ok) {
      const message =
        upstream.status === 404
          ? 'TikTok user not found.'
          : `TikTok returned ${upstream.status}.`
      return NextResponse.json({ error: 'tiktok_error', message }, { status: upstream.status })
    }

    const html = await upstream.text()

    // Profile data is embedded in a JSON blob in the page HTML. This is the
    // same shape TikTok's own SPA rehydrates from, so it stays consistent
    // even when their UI markup shifts.
    const blob = html.match(
      /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">([\s\S]*?)<\/script>/,
    )
    if (!blob) {
      return NextResponse.json(
        { error: 'tiktok_parse', message: 'Could not read TikTok profile data.' },
        { status: 502 },
      )
    }

    let parsed: UniversalData
    try {
      parsed = JSON.parse(blob[1]) as UniversalData
    } catch {
      return NextResponse.json(
        { error: 'tiktok_parse', message: 'TikTok returned unreadable profile data.' },
        { status: 502 },
      )
    }

    const detail = parsed.__DEFAULT_SCOPE__?.['webapp.user-detail']
    const userInfo = detail?.userInfo

    // TikTok surfaces "user not found" as statusCode 10221 or missing user.
    if (!userInfo?.user || (detail?.statusCode && detail.statusCode !== 0)) {
      return NextResponse.json(
        { error: 'tiktok_not_found', message: 'TikTok user not found.' },
        { status: 404 },
      )
    }

    const u = userInfo.user
    const s = userInfo.stats ?? {}
    const followers = s.followerCount ?? 0
    const following = s.followingCount ?? 0
    const likes = s.heartCount ?? 0
    const videos = s.videoCount ?? 0

    const data = {
      unique_id: u.uniqueId ?? username,
      nickname: cleanNickname(u.nickname),
      bio: (u.signature ?? '').trim() || null,
      avatar_url: u.avatarLarger || u.avatarMedium || u.avatarThumb || null,
      verified: !!u.verified,
      private_account: !!u.privateAccount,
      region: u.region ?? null,
      profile_url: `https://www.tiktok.com/@${u.uniqueId ?? username}`,
      stats: {
        followers,
        following,
        likes,
        videos,
        followers_label: formatCount(followers),
        following_label: formatCount(following),
        likes_label: formatCount(likes),
        videos_label: formatCount(videos),
      },
      created_at: u.createTime ? new Date(u.createTime * 1000).toISOString() : null,
      fetched_at: new Date().toISOString(),
    }

    return NextResponse.json(
      { success: true, data },
      {
        headers: {
          'Cache-Control': `public, s-maxage=${REFRESH_SECONDS}, stale-while-revalidate=${REFRESH_SECONDS * 2}`,
        },
      },
    )
  } catch {
    return NextResponse.json(
      { error: 'network_error', message: 'Failed to reach TikTok.' },
      { status: 502 },
    )
  }
}

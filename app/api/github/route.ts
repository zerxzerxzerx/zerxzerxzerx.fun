import { NextResponse } from 'next/server'

// Edge runtime: cold start ~50 ms vs ~500 ms on Node.js Lambda. Only uses
// fetch + regex + JSON, all edge-compatible. Cache-miss revalidations run
// noticeably faster and closer to the visitor.
export const runtime = 'edge'
// Refresh window for both the REST profile call (pfp, public repos, followers,
// bio, etc.) and the HTML scrape (contribution count). 10 minutes keeps the
// numbers fresh without hammering GitHub — none of these metrics change fast
// enough to warrant tighter polling, and Next.js's Data Cache will serve the
// cached copy instantly to every visitor within the window, then refresh in
// the background on the next request past it.
const REFRESH_SECONDS = 600
export const revalidate = 600

// Format follower/repo counts the way GitHub itself does: 1.2k, 34, 8.4M.
function formatCount(n: number): string {
  if (n < 1000) return n.toString()
  if (n < 1_000_000) {
    const v = n / 1000
    return (v < 10 ? v.toFixed(1) : v.toFixed(0)).replace(/\.0$/, '') + 'k'
  }
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
}

// Normalise blog/website URLs — GitHub stores them as bare strings, sometimes
// missing a scheme (e.g. "example.com").
function normaliseUrl(raw: string | null): { url: string; display: string } | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  const display = trimmed.replace(/^https?:\/\//i, '').replace(/\/$/, '')
  return { url, display }
}

// GitHub's REST /users endpoint does NOT expose the contribution count — the
// number shown on the profile page ("N contributions in the last year") is
// only available via the GraphQL API (which requires a token) or by scraping
// the profile HTML. We scrape so this works with no secrets. Note: the main
// profile page loads contributions via a lazy <include-fragment>, so the h2
// we want is only present in the fragment endpoint at
// /users/{username}/contributions — not at /{username}. If GitHub ever
// changes the markup, the regex misses and we silently fall back to null,
// which the UI hides.
async function fetchContributions(username: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://github.com/users/${encodeURIComponent(username)}/contributions`,
      {
        headers: {
          Accept: 'text/html',
          // GitHub sometimes gates fragment endpoints behind a browser-shaped
          // UA; using a plain UA works reliably.
          'User-Agent':
            'Mozilla/5.0 (compatible; zerxbio/1.0; +https://github.com/zerxzerxzerx/zerxbio)',
        },
        next: { revalidate: REFRESH_SECONDS },
        // Contribution scrape is best-effort — bound the wait so a slow
        // github.com doesn't hold up the parallel REST call.
        signal: AbortSignal.timeout(8000),
      },
    )
    if (!res.ok) return null
    const html = await res.text()
    const match = html.match(
      /id=["']js-contribution-activity-description["'][^>]*>\s*([\d,]+)\s+contribution/i,
    )
    if (!match) return null
    const n = parseInt(match[1].replace(/,/g, ''), 10)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const username = searchParams.get('username')?.trim()

  if (!username || !/^[A-Za-z0-9-]{1,39}$/.test(username)) {
    return NextResponse.json(
      { error: 'invalid_username', message: 'A valid GitHub username is required.' },
      { status: 400 },
    )
  }

  // Auth is optional — the unauthenticated limit is 60/hr which is fine for a
  // bio page, but a token bumps us to 5000/hr if the user sets one.
  const token = process.env.GITHUB_TOKEN
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'zerxbio',
  }
  if (token) headers.Authorization = `Bearer ${token}`

  try {
    // Kick off REST + HTML scrape in parallel. Each call has its own Data
    // Cache entry with the same revalidation window so they refresh together.
    const [upstream, contributions] = await Promise.all([
      fetch(`https://api.github.com/users/${encodeURIComponent(username)}`, {
        headers,
        next: { revalidate: REFRESH_SECONDS },
        signal: AbortSignal.timeout(8000),
      }),
      fetchContributions(username),
    ])

    if (!upstream.ok) {
      const body = await upstream.json().catch(() => null)
      const message =
        upstream.status === 404
          ? 'GitHub user not found.'
          : upstream.status === 403
            ? 'GitHub rate limit hit. Try again in a few minutes.'
            : body?.message || `GitHub returned ${upstream.status}.`
      return NextResponse.json({ error: 'github_error', message }, { status: upstream.status })
    }

    const u = (await upstream.json()) as {
      login: string
      name: string | null
      bio: string | null
      avatar_url: string
      html_url: string
      blog: string | null
      location: string | null
      twitter_username: string | null
      company: string | null
      public_repos: number
      followers: number
      following: number
      created_at: string
    }

    const data = {
      login: u.login,
      name: u.name ?? null,
      bio: u.bio ?? null,
      avatar_url: u.avatar_url,
      profile_url: u.html_url,
      blog: normaliseUrl(u.blog),
      location: u.location ?? null,
      twitter_username: u.twitter_username ?? null,
      company: u.company ?? null,
      stats: {
        repos: u.public_repos,
        followers: u.followers,
        following: u.following,
        contributions,
        repos_label: formatCount(u.public_repos),
        followers_label: formatCount(u.followers),
        following_label: formatCount(u.following),
        contributions_label: contributions !== null ? formatCount(contributions) : null,
      },
      created_at: u.created_at,
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
      { error: 'network_error', message: 'Failed to reach GitHub.' },
      { status: 502 },
    )
  }
}

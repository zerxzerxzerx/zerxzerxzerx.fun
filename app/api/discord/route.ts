import { NextResponse } from 'next/server'

// Edge runtime: cold start ~50 ms vs ~500 ms on Node.js Lambda. This route
// only uses fetch + JSON + BigInt, all of which are edge-compatible. The
// win only matters on cache misses (Vercel serves cached responses without
// invoking the function at all), but when it does miss, the visitor waits
// ~450 ms less. Also runs closer to the visitor geographically.
export const runtime = 'edge'
export const revalidate = 300

const DISCORD_EPOCH = 1420070400000n

function creationDateFromSnowflake(id: string): string {
  const ts = Number((BigInt(id) >> 22n) + DISCORD_EPOCH)
  return new Date(ts).toISOString()
}

// Public flag → badge metadata. Bits + CDN icon hashes taken from
// https://discord.com/developers/docs/resources/user#user-object-user-flags
const FLAG_BADGES: Record<number, { name: string; description: string; icon_url: string }> = {
  1: { name: 'STAFF', description: 'Discord Staff', icon_url: 'https://cdn.discordapp.com/badge-icons/5e74e9b61934fc1f67c65515d1f7e60d.png' },
  2: { name: 'PARTNER', description: 'Partnered Server Owner', icon_url: 'https://cdn.discordapp.com/badge-icons/3f9748e53446a137a052f3454e2de41e.png' },
  4: { name: 'HYPESQUAD', description: 'HypeSquad Events Coordinator', icon_url: 'https://cdn.discordapp.com/badge-icons/bf01d1073931f921909045f3a39fd264.png' },
  8: { name: 'BUG_HUNTER_LEVEL_1', description: 'Bug Hunter Level 1', icon_url: 'https://cdn.discordapp.com/badge-icons/2717692c7dca7289b35297368a940dd0.png' },
  64: { name: 'HYPESQUAD_ONLINE_HOUSE_1', description: 'HypeSquad Bravery', icon_url: 'https://cdn.discordapp.com/badge-icons/8a88d63823d8a71cd5e390baa45efa02.png' },
  128: { name: 'HYPESQUAD_ONLINE_HOUSE_2', description: 'HypeSquad Brilliance', icon_url: 'https://cdn.discordapp.com/badge-icons/011940fd013da3f7fb926e4a1cd2e618.png' },
  256: { name: 'HYPESQUAD_ONLINE_HOUSE_3', description: 'HypeSquad Balance', icon_url: 'https://cdn.discordapp.com/badge-icons/3aa41de486fa12454c3761e8e223442e.png' },
  512: { name: 'PREMIUM_EARLY_SUPPORTER', description: 'Early Nitro Supporter', icon_url: 'https://cdn.discordapp.com/badge-icons/7060786766c9c840eb3019e725d2b358.png' },
  16384: { name: 'BUG_HUNTER_LEVEL_2', description: 'Bug Hunter Level 2', icon_url: 'https://cdn.discordapp.com/badge-icons/848f79194d4be5ff5f81505cbd0ce1e6.png' },
  131072: { name: 'VERIFIED_DEVELOPER', description: 'Early Verified Bot Developer', icon_url: 'https://cdn.discordapp.com/badge-icons/6df5892e0f35b051f8b61eace34f4967.png' },
  262144: { name: 'CERTIFIED_MODERATOR', description: 'Moderator Programs Alumni', icon_url: 'https://cdn.discordapp.com/badge-icons/fee1624003e2fee35cb398e125dc479b.png' },
  4194304: { name: 'ACTIVE_DEVELOPER', description: 'Active Developer', icon_url: 'https://cdn.discordapp.com/badge-icons/6bdc42827a38498929a4920da12695d9.png' },
}

function badgesFromFlags(flags: number) {
  return Object.entries(FLAG_BADGES)
    .filter(([bit]) => (flags & Number(bit)) !== 0)
    .map(([, badge]) => badge)
}

function avatarUrl(id: string, hash: string | null | undefined) {
  if (!hash) {
    // New-username-system default avatars are picked via (id >> 22) % 6.
    // See https://discord.com/developers/docs/reference#image-formatting
    const idx = Number((BigInt(id) >> 22n) % 6n)
    return `https://cdn.discordapp.com/embed/avatars/${idx}.png`
  }
  const ext = hash.startsWith('a_') ? 'gif' : 'png'
  // Rendered at 56–64 px; 128 gives 2× DPI headroom without shipping the
  // 1024 px asset (~200 KB saved per modal open on mobile).
  return `https://cdn.discordapp.com/avatars/${id}/${hash}.${ext}?size=128`
}

function bannerUrl(id: string, hash: string | null | undefined) {
  if (!hash) return null
  const ext = hash.startsWith('a_') ? 'gif' : 'png'
  // Banner renders at ~440 px wide inside the expanded card; 512 covers 2×
  // DPI on mobile without pulling the full 1024 px asset.
  return `https://cdn.discordapp.com/banners/${id}/${hash}.${ext}?size=512`
}

type Nameplate = { sku_id?: string; asset?: string; label?: string; palette?: string }

function nameplateWithUrls(np: Nameplate | undefined | null) {
  if (!np?.asset) return null
  const base = `https://cdn.discordapp.com/assets/collectibles/${np.asset}`
  // Asset path looks like `nameplates/gothica/nevermore/` — pull the two
  // meaningful segments and title-case them for a human-readable label.
  const segments = np.asset.split('/').filter(Boolean)
  const meaningful = segments.filter((s) => s !== 'nameplates').slice(0, 2)
  const cleanLabel = meaningful.length
    ? meaningful.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' · ')
    : null
  return {
    sku_id: np.sku_id,
    asset: np.asset,
    label: cleanLabel,
    palette: np.palette,
    webm_url: `${base}asset.webm`,
    static_url: `${base}static.png`,
  }
}

type AvatarDecoration = { asset?: string; sku_id?: string; expires_at?: number | null }
function decorationWithUrl(d: AvatarDecoration | undefined | null) {
  if (!d?.asset) return null
  return {
    asset: d.asset,
    sku_id: d.sku_id,
    expires_at: d.expires_at ?? null,
    url: `https://cdn.discordapp.com/avatar-decoration-presets/${d.asset}.png?size=96&passthrough=true`,
  }
}

type PrimaryGuild = {
  identity_guild_id?: string
  identity_enabled?: boolean
  tag?: string
  badge?: string
}
function primaryGuildWithUrl(g: PrimaryGuild | undefined | null) {
  if (!g?.identity_guild_id || !g?.tag) return null
  return {
    guild_id: g.identity_guild_id,
    enabled: !!g.identity_enabled,
    tag: g.tag,
    badge: g.badge ?? null,
    badge_url: g.badge
      ? `https://cdn.discordapp.com/clan-badges/${g.identity_guild_id}/${g.badge}.png?size=32`
      : null,
  }
}

// Human label for premium_type. 0 = none, 1 = Nitro Classic, 2 = Nitro, 3 = Nitro Basic.
const NITRO_LABELS: Record<number, string> = { 1: 'Nitro Classic', 2: 'Nitro', 3: 'Nitro Basic' }

// Discord doesn't expose Nitro in public_flags, but any premium_type > 0 means
// the user is on a Nitro plan and should get the diamond badge.
const NITRO_BADGE = {
  name: 'PREMIUM',
  description: 'Discord Nitro',
  icon_url: 'https://cdn.discordapp.com/badge-icons/2ba85e8026a8614b640c2837bcdfe21b.png',
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')?.trim()

  if (!id || !/^\d{15,25}$/.test(id)) {
    return NextResponse.json(
      { error: 'invalid_id', message: 'A valid Discord snowflake id is required.' },
      { status: 400 },
    )
  }

  const token = process.env.DISCORD_BOT_TOKEN
  if (!token) {
    return NextResponse.json(
      {
        error: 'missing_token',
        message:
          'Server missing DISCORD_BOT_TOKEN. Create an application at https://discord.com/developers/applications, add a bot, copy its token, and put it in .env.local.',
      },
      { status: 503 },
    )
  }

  try {
    const upstream = await fetch(
      `https://discord.com/api/v10/users/${encodeURIComponent(id)}`,
      {
        headers: { Authorization: `Bot ${token}`, Accept: 'application/json' },
        next: { revalidate: 300 },
        // Bound the wait so a slow Discord doesn't burn the whole 60 s
        // serverless budget and leave the client staring at a spinner.
        signal: AbortSignal.timeout(8000),
      },
    )

    if (!upstream.ok) {
      const body = await upstream.json().catch(() => null)
      const message =
        upstream.status === 404
          ? 'Discord user not found.'
          : upstream.status === 401
            ? 'Bot token invalid. Check DISCORD_BOT_TOKEN in .env.local.'
            : body?.message || `Discord returned ${upstream.status}.`
      return NextResponse.json({ error: 'discord_error', message }, { status: upstream.status })
    }

    const u = (await upstream.json()) as {
      id: string
      username: string
      global_name?: string | null
      discriminator?: string
      avatar?: string | null
      banner?: string | null
      accent_color?: number | null
      banner_color?: string | null
      public_flags?: number
      flags?: number
      premium_type?: number
      collectibles?: { nameplate?: Nameplate | null } | null
      primary_guild?: PrimaryGuild | null
      avatar_decoration_data?: AvatarDecoration | null
    }

    const flags = u.public_flags ?? u.flags ?? 0
    const bUrl = bannerUrl(u.id, u.banner)
    const flagBadges = badgesFromFlags(flags)
    // Discord's REST /users/{id} endpoint only reports premium_type reliably for
    // the bot's own account, so for other users it's usually 0. Infer Nitro
    // from features that require an active plan: animated avatars, custom
    // banners, and avatar decorations are all Nitro-gated.
    const hasNitro =
      (u.premium_type ?? 0) > 0 ||
      !!u.avatar?.startsWith('a_') ||
      !!u.banner ||
      !!u.avatar_decoration_data?.asset
    const badges = hasNitro ? [...flagBadges, NITRO_BADGE] : flagBadges

    const data = {
      id: u.id,
      username: u.username,
      global_name: u.global_name ?? null,
      discriminator: u.discriminator && u.discriminator !== '0' ? u.discriminator : null,
      avatar: {
        url: avatarUrl(u.id, u.avatar),
        is_animated: !!u.avatar?.startsWith('a_'),
        is_default: !u.avatar,
      },
      banner:
        bUrl || u.banner_color
          ? {
              url: bUrl,
              color: u.banner_color ?? null,
              is_animated: !!u.banner?.startsWith('a_'),
            }
          : null,
      accent_color:
        u.accent_color != null
          ? { hex: '#' + u.accent_color.toString(16).padStart(6, '0') }
          : null,
      collectibles: {
        nameplate: nameplateWithUrls(u.collectibles?.nameplate ?? null),
      },
      avatar_decoration: decorationWithUrl(u.avatar_decoration_data ?? null),
      primary_guild: primaryGuildWithUrl(u.primary_guild ?? null),
      badges,
      premium_type: u.premium_type ?? 0,
      // Prefer the exact tier from Discord; otherwise fall back to a generic
      // "Nitro" label when we've inferred the badge from other signals.
      premium_label: NITRO_LABELS[u.premium_type ?? 0] ?? (hasNitro ? 'Nitro' : null),
      creation_date: creationDateFromSnowflake(u.id),
    }

    return NextResponse.json(
      { success: true, data },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
    )
  } catch (e) {
    return NextResponse.json(
      { error: 'network_error', message: 'Failed to reach Discord.' },
      { status: 502 },
    )
  }
}

// Shared Lanyard/Discord types + pure URL/formatting helpers. Split out from
// BioLink.tsx so the live client component and the server-side OG image
// generator (app/opengraph-image.tsx) both build off the same definitions
// instead of two copies drifting apart.

export type DiscordStatus = 'online' | 'idle' | 'dnd' | 'offline'

export type LanyardDiscordUser = {
  id: string
  username: string
  global_name: string | null
  avatar: string | null
}

export type LanyardActivity = {
  type: number
  name: string
  state?: string | null
}

export type LanyardSpotify = {
  timestamps: { start: number; end: number }
  song: string
  artist: string
  album_art_url: string
}

export type LanyardData = {
  discord_status: DiscordStatus
  discord_user: LanyardDiscordUser
  activities: LanyardActivity[]
  spotify: LanyardSpotify | null
  listening_to_spotify: boolean
}

// Avatar decorations, nameplate collectibles, and profile badges live on
// Discord's private /users/{id}/profile endpoint — Lanyard (and every public
// bot API) has no access to them. dstn.to mirrors that private endpoint
// publicly, so this is a separate data source from everything above.
export type AvatarDecoration = { asset: string }
export type Nameplate = { asset: string; palette: string }
export type DiscordBadge = { id: string; description: string; icon: string }

export type DstnProfile = {
  avatarDecoration: AvatarDecoration | null
  nameplate: Nameplate | null
  badges: DiscordBadge[]
}

// size=160 was undersized and the real cause of the blurry/pixelated look —
// at DECORATION_SCALE the ring renders around ~123 CSS px, which already
// needs more than 160 source px on any HiDPI/Retina display. Checked what
// this asset's actual native resolution is by requesting several sizes
// directly against the CDN: anything requested at or above 288 came back
// as a flat 288x288 (the true ceiling for this preset), while 160 and 256
// were honored as asked. Requesting 512 here just lets the CDN clamp down
// to whatever each decoration's real native resolution is — safe for other
// (possibly higher-res) decorations too — instead of hardcoding 288.
export function avatarDecorationUrl(decoration: AvatarDecoration): string {
  return `https://cdn.discordapp.com/avatar-decoration-presets/${decoration.asset}.png?size=512&passthrough=false`
}

// Nameplate asset paths come back with a trailing slash, e.g.
// "nameplates/gothica/nevermore/" — append the static frame filename.
export function nameplateUrl(nameplate: Nameplate): string {
  return `https://cdn.discordapp.com/assets/collectibles/${nameplate.asset}static.png`
}

export function badgeIconUrl(icon: string): string {
  return `https://cdn.discordapp.com/badge-icons/${icon}.png`
}

// Discord activity type 4 is the custom status (the text the user sets
// themselves) — distinct from online/idle/dnd/offline presence.
export function customStatusText(data: LanyardData): string | null {
  return data.activities.find((a) => a.type === 4)?.state ?? null
}

// Discord's display name (global_name) falls back to the legacy username
// when unset — same precedence the Discord client itself uses.
export function displayName(user: LanyardDiscordUser): string {
  return user.global_name || user.username
}

export function avatarUrl(user: LanyardDiscordUser): string | null {
  if (!user.avatar) return null
  const ext = user.avatar.startsWith('a_') ? 'gif' : 'png'
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=128`
}

// Thin fetch wrappers (no React, safe to call from a server-side route like
// opengraph-image.tsx as well as from the client hooks in BioLink.tsx).
export async function fetchLanyard(userId: string): Promise<LanyardData | null> {
  try {
    const r = await fetch(`https://api.lanyard.rest/v1/users/${userId}`, { cache: 'no-store' })
    const j = (await r.json().catch(() => null)) as { success?: boolean; data?: LanyardData } | null
    return j?.success && j.data ? j.data : null
  } catch {
    return null
  }
}

export async function fetchDstnProfile(userId: string): Promise<DstnProfile | null> {
  try {
    const r = await fetch(`https://dcdn.dstn.to/profile/${userId}`, { cache: 'no-store' })
    const j = await r.json().catch(() => null)
    if (!j?.user) return null
    return {
      avatarDecoration: j.user.avatar_decoration_data
        ? { asset: j.user.avatar_decoration_data.asset as string }
        : null,
      nameplate: j.user.collectibles?.nameplate
        ? {
            asset: j.user.collectibles.nameplate.asset as string,
            palette: j.user.collectibles.nameplate.palette as string,
          }
        : null,
      badges: Array.isArray(j.badges) ? j.badges : [],
    }
  } catch {
    return null
  }
}

'use client'

import { useCallback, useMemo } from 'react'
import { AnimatePresence, m, useReducedMotion } from 'framer-motion'
import { useCachedPoll } from '@/lib/useCachedPoll'
import { BadgeCheck, Boxes, Building2, ShieldCheck, UserPlus, Users } from 'lucide-react'

// Response shape — mirrors the JSON emitted by /api/roblox/route.ts.
type RobloxData = {
  id: number
  username: string
  displayName: string
  description: string
  created: string | null
  isBanned: boolean
  hasVerifiedBadge: boolean
  profileUrl: string
  presence: {
    type: 'Offline' | 'Online' | 'In-Game' | 'Studio'
    lastLocation: string | null
    lastOnline: string | null
  }
  counts: {
    friends: number | null
    followers: number | null
    following: number | null
    groups: number | null
    badges: number | null
  }
  badges: { id: number; name: string; description: string | null; icon_url: string | null }[]
  groups: {
    id: number
    name: string
    memberCount: number
    role: string
    rank: number
    icon_url: string | null
    url: string
  }[]
  currentGame: {
    universeId: number
    placeId: number
    name: string
    creator: string
    playing: number | null
    visits: number | null
    url: string
  } | null
  thumbnails: {
    headshot: string | null
    fullbody: string | null
  }
  rolimons: {
    value: number | null
    rap: number | null
    rank: number | null
    badges: { key: string; name: string; tier: 'value' | 'trade' | 'special' }[]
  } | null
  fetchedAt: string
}

type ApiResponse = {
  success?: boolean
  data?: RobloxData
  error?: string
  message?: string
}

// 5-min server cache; poll every 5 min so presence transitions (online →
// in-game → offline) surface without a manual reopen.
const POLL_MS = 5 * 60 * 1000

// Compact number formatter — 12,345 → "12.3K", 1,200,000 → "1.2M". Keeps
// stat pills from wrapping onto two lines on narrow modal widths.
function fmtCount(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  if (n < 1000) return n.toLocaleString('en-US')
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  return `${(n / 1_000_000_000).toFixed(1)}B`
}

// Roblox joins go back to 2006 — showing full "X years, Y months" gives a
// more human read than a raw ISO date.
function fmtAccountAge(iso: string | null): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  const now = Date.now()
  const days = Math.floor((now - then) / (86_400 * 1000))
  if (days < 30) return `Created ${days}d ago`
  const months = Math.floor(days / 30.44)
  if (months < 12) return `Created ${months} month${months === 1 ? '' : 's'} ago`
  const years = Math.floor(days / 365.25)
  const extraMonths = Math.floor((days - years * 365.25) / 30.44)
  if (extraMonths === 0) return `Created ${years}y ago`
  return `Created ${years}y ${extraMonths}mo ago`
}

function fmtLastOnline(iso: string | null): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30.44)
  if (mo < 12) return `${mo}mo ago`
  const y = Math.floor(d / 365.25)
  return `${y}y ago`
}

// Presence status → dot color + label. Matches Roblox web's own palette:
// green for website-online, blue for in-game, purple for Studio, grey off.
const PRESENCE_STYLE: Record<RobloxData['presence']['type'], { color: string; label: string }> = {
  Online: { color: '#43B581', label: 'Online' },
  'In-Game': { color: '#2196F3', label: 'In-Game' },
  Studio: { color: '#B067F5', label: 'In Studio' },
  Offline: { color: '#747F8D', label: 'Offline' },
}

function PresencePill({ presence }: { presence: RobloxData['presence'] }) {
  const style = PRESENCE_STYLE[presence.type]
  const isLive = presence.type !== 'Offline'
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/90 backdrop-blur-sm"
      title={presence.lastLocation ?? style.label}
    >
      <span className="relative flex h-1.5 w-1.5">
        {isLive && (
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
            style={{ backgroundColor: style.color }}
          />
        )}
        <span
          className="relative inline-flex h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: style.color }}
        />
      </span>
      {style.label}
    </span>
  )
}

function StatPill({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex-1 rounded-xl bg-bg-raised px-2.5 py-2 text-center">
      <div className="mx-auto flex h-4 w-4 items-center justify-center text-fg-muted">{icon}</div>
      <div className="mt-1 font-mono text-sm font-semibold text-fg">{value}</div>
      <div className="text-[9px] font-medium uppercase tracking-wider text-fg-muted">{label}</div>
    </div>
  )
}

// Currently-playing card — mirrors the Discord Spotify-row layout with a
// large thumbnail on the left and details on the right, since it reads as
// a "now doing X" card and users are already primed for that pattern by
// the Discord modal.
function CurrentGameCard({ game }: { game: NonNullable<RobloxData['currentGame']> }) {
  return (
    <a
      href={game.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center gap-3 rounded-xl bg-bg-raised p-3 transition-colors hover:bg-bg-subtle"
    >
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-[#2196F3]/15 text-[#2196F3] ring-1 ring-[#2196F3]/30">
        <Boxes size={22} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[#2196F3]">
          Now Playing
        </div>
        <div className="truncate text-sm font-semibold text-fg">{game.name}</div>
        <div className="truncate text-xs text-fg-muted">
          by {game.creator}
          {game.playing != null && ` · ${fmtCount(game.playing)} playing`}
        </div>
      </div>
    </a>
  )
}

// Skeleton reuses the same block sizes as the loaded modal so opening
// doesn't shift the surrounding scroll position when data lands.
function RobloxSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex gap-3 rounded-xl bg-bg-raised p-3">
        <div className="h-40 w-32 shrink-0 animate-pulse rounded-xl bg-white/5" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-24 animate-pulse rounded bg-white/10" />
          <div className="h-3 w-16 animate-pulse rounded bg-white/5" />
          <div className="h-3 w-full animate-pulse rounded bg-white/5" />
          <div className="h-3 w-3/4 animate-pulse rounded bg-white/5" />
        </div>
      </div>
      <div className="flex gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-14 flex-1 animate-pulse rounded-xl bg-bg-raised" />
        ))}
      </div>
      <div className="h-20 animate-pulse rounded-xl bg-bg-raised" />
      <div className="h-32 animate-pulse rounded-xl bg-bg-raised" />
    </div>
  )
}

export default function RobloxProfile({ username }: { username: string }) {
  const fetcher = useCallback(async () => {
    const r = await fetch(`/api/roblox?username=${encodeURIComponent(username)}`)
    const j = (await r.json()) as ApiResponse
    if (!r.ok || !j.data) throw new Error(j.message || 'Failed to load Roblox profile')
    return j.data
  }, [username])

  const { data, error } = useCachedPoll<RobloxData>({
    cacheKey: `zerxbio:roblox:${username}:v1`,
    pollMs: POLL_MS,
    resetKey: username,
    fetcher,
  })

  const accountAge = useMemo(() => fmtAccountAge(data?.created ?? null), [data?.created])
  const lastOnline = useMemo(
    () => (data?.presence.type === 'Offline' ? fmtLastOnline(data.presence.lastOnline) : null),
    [data?.presence],
  )

  if (error && !data) {
    return (
      <div className="rounded-xl bg-bg-raised px-4 py-6 text-center text-sm text-fg-muted">
        {error}
      </div>
    )
  }

  if (!data) return <RobloxSkeleton />

  return (
    <div className="space-y-4">
      {/* --- Hero: Roblox-style headshot card + name + description --- */}
      <div className="rounded-xl bg-bg-raised p-3">
        <div className="flex gap-3">
          <HeadshotCard
            src={data.thumbnails.headshot}
            alt={data.displayName}
            presence={data.presence}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-bold text-fg">{data.displayName}</span>
              {data.hasVerifiedBadge && (
                <BadgeCheck size={14} className="shrink-0 text-[#2196F3]" aria-label="Verified" />
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-2">
              <a
                href={data.profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-xs text-fg-muted transition-colors hover:text-fg"
              >
                @{data.username}
              </a>
            </div>
            {data.description ? (
              <p className="mt-2 max-h-24 overflow-y-auto whitespace-pre-line text-[11px] leading-relaxed text-fg-muted">
                {data.description}
              </p>
            ) : (
              <p className="mt-2 text-[11px] italic text-fg-faint">No description set.</p>
            )}
            {accountAge && (
              <div className="mt-2 text-[10px] uppercase tracking-wider text-fg-faint">
                {accountAge}
                {lastOnline && ` · last seen ${lastOnline}`}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* --- Currently playing (only if in-game / studio) ----------- */}
      <AnimatePresence>
        {data.currentGame && (
          <m.div
            key="game"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
          >
            <CurrentGameCard game={data.currentGame} />
          </m.div>
        )}
      </AnimatePresence>

      {/* --- Stat pills row --------------------------------------- */}
      <div className="flex gap-2">
        <StatPill icon={<UserPlus size={14} />} label="Followers" value={fmtCount(data.counts.followers)} />
        <StatPill icon={<UserPlus size={14} />} label="Following" value={fmtCount(data.counts.following)} />
        <StatPill icon={<Users size={14} />} label="Friends" value={fmtCount(data.counts.friends)} />
        <StatPill icon={<Building2 size={14} />} label="Groups" value={fmtCount(data.counts.groups)} />
      </div>

      {/* --- Rolimons: trading value, RAP, rank + RoliBadges ------- */}
      {data.rolimons && (data.rolimons.value != null || data.rolimons.badges.length > 0) && (
        <RolimonsSection rolimons={data.rolimons} userId={data.id} />
      )}

      {/* --- Recent badges ---------------------------------------- */}
      {data.badges.length > 0 && (
        <BadgesRow badges={data.badges} />
      )}

      {/* --- Top groups ------------------------------------------- */}
      {data.groups.length > 0 && (
        <GroupsList groups={data.groups} />
      )}
    </div>
  )
}

// --- Presence style helpers -------------------------------------------
// Same palette as PresencePill. Kept as a plain lookup so both the pill
// and the headshot status dot resolve from a single source of truth.
const PRESENCE_DOT_TITLE: Record<RobloxData['presence']['type'], string> = {
  Online: 'Website',
  'In-Game': 'In-Game',
  Studio: 'In Studio',
  Offline: 'Offline',
}

// Roblox-style headshot card. Square 1:1 crop of the headshot thumbnail
// with a colored presence dot in the bottom-right — visually rhymes with
// roblox.com's own `.user-profile-header-details-avatar-container`.
function HeadshotCard({
  src,
  alt,
  presence,
}: {
  src: string | null
  alt: string
  presence: RobloxData['presence']
}) {
  const style = PRESENCE_STYLE[presence.type]
  const isLive = presence.type !== 'Offline'
  return (
    // Outer container intentionally NOT overflow-hidden so the presence dot
    // can hang off the bottom-right corner. Image clipping lives on the
    // inner div instead.
    <div className="relative block h-32 w-32 shrink-0">
      <div className="h-full w-full overflow-hidden rounded-full bg-bg-subtle">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={alt}
            referrerPolicy="no-referrer"
            draggable={false}
            className="h-full w-full select-none object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-fg-faint">
            <Users size={28} />
          </div>
        )}
      </div>
      <span
        title={presence.lastLocation || PRESENCE_DOT_TITLE[presence.type]}
        // Position + size dialed in via the debug positioner:
        // ~148.7° around the avatar circle (4-o'clock), 17 px dot.
        className="absolute bottom-[7px] right-[16px] flex h-[17px] w-[17px]"
      >
        {isLive && (
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
            style={{ backgroundColor: style.color }}
          />
        )}
        <span
          className="relative inline-flex h-[17px] w-[17px] rounded-full"
          style={{ backgroundColor: style.color }}
        />
      </span>
    </div>
  )
}

// Rolimons stat-pill icons. Lifted from the icon set Rolimons ships on
// their own player pages — the wallet card upstream uses these same
// glyphs (trophy for rank, upslope line-chart for value, sparkline for
// RAP) so users who know the site read them instantly. Inlined as
// components rather than <img src="/rolimons/rank.svg"> so they pick up
// `currentColor` from the surrounding `text-fg-muted` and don't cost an
// extra HTTP round trip for a ~200-byte glyph.
function RolimonsRankIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M2 2v9c0 1 1 2 2 2h2.2c.4 2 1.7 3.7 4.8 4v2.1c-2.2.2-3 1.3-3 2.6v.3h8v-.3c0-1.3-.8-2.4-3-2.6V17c3.1-.3 4.4-2 4.8-4H20c1 0 2-1 2-2V2h-4c-.9 0-2 1-2 2H8c0-1-1.1-2-2-2H2zm2 2h2v7H4V4zm14 0h2v7h-2V4zM8 6h8v5.5c0 1.933-.585 3.5-4 3.5s-4-1.567-4-3.5V6z" />
    </svg>
  )
}

function RolimonsValueIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.007 11.778l4.233-7.332 1.732 1-5.233 9.064-6.512-3.76L5.464 19H22v2H2V3h2v14.536l5.495-9.518 6.512 3.76z" />
    </svg>
  )
}

function RolimonsRapIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
      <path d="M23 24c-3.6 0-5.03-4.176-6.413-8.214C15.277 11.958 13.92 8 11 8a3.44 3.44 0 0 0-3.053 2.321L6.05 9.684C6.101 9.534 7.321 6 11 6c4.35 0 6.012 4.855 7.48 9.138C19.689 18.667 20.83 22 23 22a3.44 3.44 0 0 0 3.053-2.321l1.896.637C27.899 20.466 26.679 24 23 24z" />
      <path d="M4 28V17h2v-2H4V2H2v26a2 2 0 0 0 2 2h26v-2z" />
      <path d="M8 15h2v2H8zM12 15h2v2h-2zM20 15h2v2h-2zM24 15h2v2h-2zM28 15h2v2h-2z" />
    </svg>
  )
}

// Badge key → local SVG asset. The SVGs are lifted verbatim from
// rolimons.com's own badge sprites (colors and iconography are the
// community-recognized tier signal). Served from `/public/rolimons/` so
// no CSP change is needed vs. hotlinking from rolimons.com (which is
// Cloudflare-gated).
const ROLI_BADGE_ICON: Record<string, string> = {
  value_1m: '/rolimons/1m.svg',
  value_500k: '/rolimons/500k.svg',
  value_100k: '/rolimons/100k.svg',
  create_100_trade_ads: '/rolimons/frequent-trader.svg',
  create_10_trade_ads: '/rolimons/trade-advertiser.svg',
  own_10_items: '/rolimons/collector.svg',
  own_1_kotn_item: '/rolimons/evening-royalty.svg',
  verified: '/rolimons/verified.svg',
}

// Rolimons is the community-standard trading value tracker for Roblox
// limiteds. The three stats (Value / RAP / Rank) form the "wallet card"
// every trader recognizes at a glance, so we mirror that layout — three
// pills across the top, badge shelf below. Badges are tier-colored text
// pills (see `ROLI_TIER_CLASS`) rather than icons because their SVG
// assets aren't reachable from the JSON API path.
function RolimonsSection({
  rolimons,
  userId,
}: {
  rolimons: NonNullable<RobloxData['rolimons']>
  userId: number
}) {
  const shouldReduce = useReducedMotion()
  return (
    <div className="space-y-1.5">
      <div className="px-1">
        {/* Header doubles as the outbound link — hover glows the label with
            the Rolimons green so the affordance is obvious without needing
            a separate "↗ rolimons.com" trailing link. */}
        <a
          href={`https://www.rolimons.com/player/${userId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-[10px] font-semibold uppercase tracking-wider text-fg-muted transition-colors hover:text-fg"
        >
          Rolimons
        </a>
      </div>
      <div className="flex gap-2">
        <StatPill icon={<RolimonsValueIcon />} label="Value" value={fmtCount(rolimons.value)} />
        <StatPill icon={<RolimonsRapIcon />} label="RAP" value={fmtCount(rolimons.rap)} />
        <StatPill
          icon={<RolimonsRankIcon />}
          label="Rank"
          value={rolimons.rank != null ? `#${rolimons.rank.toLocaleString('en-US')}` : '—'}
        />
      </div>
      {rolimons.badges.length > 0 && (
        <div className="scrollbar-none flex flex-wrap items-center gap-2 rounded-xl bg-bg-raised p-2">
          {rolimons.badges.map((b, idx) => {
            const icon = ROLI_BADGE_ICON[b.key]
            return (
              <m.span
                key={b.key}
                initial={shouldReduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: shouldReduce ? 0 : idx * 0.03 }}
                title={b.name}
                aria-label={b.name}
                className="inline-flex h-8 w-8 items-center justify-center"
              >
                {icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={icon}
                    alt={b.name}
                    draggable={false}
                    loading="lazy"
                    decoding="async"
                    className="h-8 w-8 select-none"
                  />
                ) : (
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-fg-muted">
                    {b.name}
                  </span>
                )}
              </m.span>
            )
          })}
        </div>
      )}
    </div>
  )
}

function BadgesRow({ badges }: { badges: RobloxData['badges'] }) {
  const shouldReduce = useReducedMotion()
  return (
    <div className="space-y-1.5">
      <div className="px-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
          Recent Badges
        </div>
      </div>
      {/* Horizontal scroll — badges wrap to as many columns as fit, but on
          narrow modal widths we want the row to keep flowing rather than
          truncating hard. Snap so scrolling always parks a badge in view. */}
      <div className="scrollbar-none flex snap-x snap-mandatory gap-2 overflow-x-auto rounded-xl bg-bg-raised p-2">
        {badges.map((b, idx) => (
          <m.div
            key={b.id}
            initial={shouldReduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: shouldReduce ? 0 : idx * 0.03 }}
            className="group relative flex shrink-0 snap-start flex-col items-center gap-1"
            title={b.description || b.name}
          >
            {b.icon_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={b.icon_url}
                alt={b.name}
                referrerPolicy="no-referrer"
                loading="lazy"
                decoding="async"
                className="h-12 w-12 object-contain"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-bg-subtle text-fg-muted ring-1 ring-white/5">
                <ShieldCheck size={16} />
              </div>
            )}
            <div className="w-14 truncate text-center text-[9px] text-fg-muted">{b.name}</div>
          </m.div>
        ))}
      </div>
    </div>
  )
}

function GroupsList({ groups }: { groups: RobloxData['groups'] }) {
  return (
    <div className="space-y-1.5">
      <div className="px-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
          Top Groups
        </div>
      </div>
      <div className="space-y-1.5">
        {groups.map((g) => (
          <a
            key={g.id}
            href={g.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-2.5 rounded-xl bg-bg-raised p-2 transition-colors hover:bg-bg-subtle"
          >
            {g.icon_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={g.icon_url}
                alt=""
                referrerPolicy="no-referrer"
                loading="lazy"
                decoding="async"
                className="h-8 w-8 shrink-0 rounded-full bg-bg-subtle object-cover"
              />
            ) : (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg-subtle text-fg-muted">
                <Users size={14} />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-fg">{g.name}</div>
              <div className="truncate text-[10px] text-fg-muted">
                {g.role} · {fmtCount(g.memberCount)} members
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}

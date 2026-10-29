'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCachedPoll } from '@/lib/useCachedPoll'
import Modal from '@/components/Modal'
import {
  AlertTriangle,
  BadgeCheck,
  Flame,
  Gem,
  Handshake,
  Shield,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react'

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
    iconUrl: string | null
  } | null
  thumbnails: {
    headshot: string | null
    fullbody: string | null
  }
  limiteds: {
    id: number
    assetId: number
    name: string
    rap: number | null
    serial: number | null
    icon_url: string | null
    url: string
  }[]
  rolimons: {
    value: number | null
    rap: number | null
    rank: number | null
    badges: { key: string; name: string; tier: 'value' | 'trade' | 'special' }[]
    history: { t: number; value: number; rap: number }[]
  } | null
  fetchedAt: string
}

// Response shape from /api/roblox/item/route.ts — the per-item catalog
// detail fetched lazily when a limited tile is clicked (not bundled into
// the main /api/roblox payload above, since it's a ~175KB whole-catalog
// pull on Rolimons' side and most opens of the profile never click a
// limited at all).
type LimitedDetail = {
  assetId: number
  name: string | null
  description: string | null
  creator: string | null
  icon_url: string | null
  rap: number | null
  value: number | null
  bestPrice: number | null
  totalQuantity: number | null
  demand: number | null
  demandLabel: string | null
  trend: number | null
  trendLabel: string | null
  projected: boolean
  hyped: boolean
  rare: boolean
  url: string
  rolimonsUrl: string
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
  if (days < 30) return `Created ${days} day${days === 1 ? '' : 's'} ago`
  const months = Math.floor(days / 30.44)
  if (months < 12) return `Created ${months} month${months === 1 ? '' : 's'} ago`
  const years = Math.floor(days / 365.25)
  const extraMonths = Math.floor((days - years * 365.25) / 30.44)
  const yearPart = `${years} year${years === 1 ? '' : 's'}`
  if (extraMonths === 0) return `Created ${yearPart} ago`
  return `Created ${yearPart}, ${extraMonths} month${extraMonths === 1 ? '' : 's'} ago`
}

function fmtChartDate(t: number): string {
  return new Date(t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtAxisMonth(t: number): string {
  return new Date(t * 1000).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
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

// Animates a number counting up from its previous value to `target` on
// change — the "balance loading in" feel wallet apps use when a portfolio
// first renders. Snaps straight to the target under reduced-motion.
function useCountUp(target: number | null, durationMs = 900): number {
  const [current, setCurrent] = useState(0)
  const prevTarget = useRef<number | null>(null)

  useEffect(() => {
    if (target == null || target === prevTarget.current) return
    const from = prevTarget.current ?? 0
    prevTarget.current = target

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setCurrent(target)
      return
    }

    const start = performance.now()
    let raf: number
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      const eased = 1 - Math.pow(1 - t, 3)
      setCurrent(Math.round(from + (target - from) * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, durationMs])

  return current
}

// Compact account avatar — a colored ring (presence color) wraps the photo,
// the same visual language account/wallet apps use for a status-aware
// profile icon, instead of the old corner dot on a large 128px photo.
function Avatar({
  src,
  alt,
  presence,
}: {
  src: string | null
  alt: string
  presence: RobloxData['presence']
}) {
  const style = PRESENCE_STYLE[presence.type]
  return (
    <div className="relative h-14 w-14 shrink-0">
      <div
        className="h-14 w-14 shrink-0 rounded-full p-[2px]"
        style={{ backgroundColor: style.color }}
      >
        <div className="h-full w-full rounded-full bg-bg-raised p-[2px]">
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
                <Users size={18} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Portal-based tooltip for anchors nested inside a *clipping* ancestor —
// the universal `.tooltip-anchor`/`.tooltip-bubble` CSS pair (see
// globals.css) only solves *stacking* (siblings painting over the bubble);
// it can't survive an ancestor with `overflow` set, which clips the
// absolutely-positioned bubble outright regardless of z-index. The Rolimons
// badge strip below has exactly that: `overflow-x-auto` on the scroll row
// itself (needed for the horizontal scroll + edge-fade mask) *and*
// `overflow-hidden` on its rounded-corner card parent. Portaling to
// document.body and positioning from the anchor's live `getBoundingClientRect()`
// sidesteps both — there's no ancestor left to clip it.
function FloatingTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const show = () => {
    // Touch devices get no hover tooltip at all (same rule the CSS version
    // follows via `@media (hover: hover)`) — there's no hover-intent signal
    // to hang it off, and a tap-to-show version has no clear dismissal.
    if (!window.matchMedia('(hover: hover)').matches) return
    const rect = anchorRef.current?.getBoundingClientRect()
    if (!rect) return
    setPos({ top: rect.top, left: rect.left + rect.width / 2 })
  }
  const hide = () => setPos(null)

  return (
    <span
      ref={anchorRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center"
    >
      {children}
      {pos &&
        createPortal(
          <span
            className="pointer-events-none fixed z-[70] -translate-x-1/2 -translate-y-[calc(100%+5px)] whitespace-nowrap rounded-md border border-line bg-bg-tertiary px-[7px] py-[3px] text-[9px] font-semibold uppercase tracking-wide text-fg"
            style={{ top: pos.top, left: pos.left }}
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  )
}

// Icon sits inline beside the number (not stacked below it as a label
// stand-in — that read as awkward/misplaced). A small custom tooltip
// above the icon carries the actual label text — hover only (no click
// toggle: a tap-to-open version kept the tooltip stuck visible, which
// read worse than just not having a touch affordance at all).
function StatCell({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: number | null
  icon: LucideIcon
}) {
  const animated = useCountUp(value)
  return (
    <div className="tooltip-anchor flex flex-1 items-center justify-center gap-1.5 py-1.5">
      <span className="tooltip-bubble">{label}</span>
      <Icon size={12} strokeWidth={2} className="shrink-0 text-fg-faint" aria-hidden="true" />
      <span className="font-mono text-xs font-medium text-fg-muted">
        {value != null ? fmtCount(animated) : '—'}
      </span>
    </div>
  )
}

// Subtle stat strip — no card background, just hairline dividers between
// columns so it reads as part of the surrounding page rather than another
// boxed widget. Numbers still count up on load.
function StatsRow({
  stats,
}: {
  stats: { label: string; value: number | null; icon: LucideIcon }[]
}) {
  return (
    <div className="flex divide-x divide-white/[0.06]">
      {stats.map((s) => (
        <StatCell key={s.label} label={s.label} value={s.value} icon={s.icon} />
      ))}
    </div>
  )
}

// Currently-playing card — mirrors the Discord Spotify-row layout with a
// large thumbnail on the left and details on the right, since it reads as
// a "now doing X" card and users are already primed for that pattern by
// the Discord modal. The real game icon comes from Roblox's thumbnails API
// (fetched server-side in app/api/roblox/route.ts); the pulsing dot moves
// to a small corner badge on the icon when one is available, and remains
// the full placeholder box on the rare occasion the icon fetch fails.
function CurrentGameCard({ game }: { game: NonNullable<RobloxData['currentGame']> }) {
  return (
    <a
      href={game.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center gap-3 rounded-xl bg-bg-raised p-3 transition-colors hover:bg-bg-subtle"
    >
      {game.iconUrl ? (
        <div className="relative h-12 w-12 shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={game.iconUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="h-12 w-12 rounded-md object-cover"
          />
          <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#2196F3] opacity-60" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-[#2196F3] ring-2 ring-bg-raised" />
          </span>
        </div>
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-[#2196F3]/15 text-[#2196F3] ring-1 ring-[#2196F3]/30">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#2196F3] opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#2196F3]" />
          </span>
        </div>
      )}
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
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-xl bg-bg-raised p-3">
        <div className="h-14 w-14 shrink-0 animate-pulse rounded-full bg-white/5" />
        <div className="flex-1 space-y-2">
          <div className="h-3.5 w-24 animate-pulse rounded bg-white/10" />
          <div className="h-3 w-16 animate-pulse rounded bg-white/5" />
        </div>
      </div>
      <div className="h-28 animate-pulse rounded-2xl bg-bg-raised" />
      <div className="h-14 animate-pulse rounded-xl bg-bg-raised" />
      <div className="h-24 animate-pulse rounded-xl bg-bg-raised" />
    </div>
  )
}

export default function RobloxProfile({
  userId,
  username,
}: {
  /** Numeric Roblox user id — skips the username→id lookup round-trip. */
  userId?: string
  username?: string
}) {
  const key = userId ? `id:${userId}` : `username:${username}`
  const fetcher = useCallback(async () => {
    const qs = userId
      ? `id=${encodeURIComponent(userId)}`
      : `username=${encodeURIComponent(username ?? '')}`
    const r = await fetch(`/api/roblox?${qs}`)
    const j = (await r.json()) as ApiResponse
    if (!r.ok || !j.data) throw new Error(j.message || 'Failed to load Roblox profile')
    return j.data
  }, [userId, username])

  const { data, error } = useCachedPoll<RobloxData>({
    cacheKey: `zerxbio:roblox:${key}:v2`,
    pollMs: POLL_MS,
    resetKey: key,
    fetcher,
  })

  const accountAge = useMemo(() => fmtAccountAge(data?.created ?? null), [data?.created])
  const lastOnline = useMemo(
    () => (data?.presence.type === 'Offline' ? fmtLastOnline(data.presence.lastOnline) : null),
    [data?.presence],
  )
  const [activeTab, setActiveTab] = useState<ProfileTab | null>(null)
  // Which limited (if any) has its detail modal open — set from a grid
  // tile's onClick in LimitedsGrid below, cleared on modal close. Declared
  // here (above the early returns) since hooks can't follow a conditional
  // return.
  const [selectedLimited, setSelectedLimited] = useState<RobloxData['limiteds'][number] | null>(
    null,
  )

  if (error && !data) {
    return (
      <div className="rounded-xl bg-bg-raised px-4 py-6 text-center text-sm text-fg-muted">
        {error}
      </div>
    )
  }

  if (!data) return <RobloxSkeleton />

  const hasRolimons = !!data.rolimons && (data.rolimons.value != null || data.rolimons.badges.length > 0)

  // Tab availability depends on what actually came back for this profile —
  // a user with no groups just doesn't get a Groups pill, rather than an
  // empty tab. Order is fixed (Rolimons first — it's the richest section)
  // so the default landing tab doesn't jump around as other data streams
  // settle in behind it.
  const availableTabs: { key: ProfileTab; label: string }[] = [
    ...(hasRolimons ? [{ key: 'rolimons' as const, label: 'Rolimons' }] : []),
    ...(data.limiteds.length > 0 ? [{ key: 'limiteds' as const, label: 'Limiteds' }] : []),
    ...(data.groups.length > 0 ? [{ key: 'groups' as const, label: 'Groups' }] : []),
    ...(data.badges.length > 0 ? [{ key: 'badges' as const, label: 'Badges' }] : []),
  ]
  const effectiveTab =
    activeTab && availableTabs.some((t) => t.key === activeTab) ? activeTab : (availableTabs[0]?.key ?? null)

  return (
    <>
    <div className="space-y-3">
      {/* --- Account header: compact ringed avatar + name + presence --- */}
      <div className="profile-card-enter flex items-center gap-3 rounded-xl bg-bg-raised p-3">
        <Avatar src={data.thumbnails.headshot} alt={data.displayName} presence={data.presence} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-bold text-fg">{data.displayName}</span>
            {data.hasVerifiedBadge && (
              <BadgeCheck size={14} className="shrink-0 text-[#2196F3]" aria-label="Verified" />
            )}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <a
              href={data.profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate text-xs text-fg-muted transition-colors hover:text-fg"
            >
              @{data.username}
            </a>
          </div>
        </div>
      </div>

      {/* --- Description + account age --------------------------------- */}
      <div className="profile-card-enter space-y-1.5 rounded-xl bg-bg-raised p-3" style={{ animationDelay: '60ms' }}>
        {data.description && (
          <p className="max-h-20 overflow-y-auto whitespace-pre-line text-[11px] leading-relaxed text-fg-muted">
            {data.description}
          </p>
        )}
        {accountAge && (
          <div className="text-[10px] uppercase tracking-wider text-fg-faint">
            {accountAge}
            {lastOnline && ` · last seen ${lastOnline}`}
          </div>
        )}
      </div>

      {/* --- Currently playing (only if in-game / studio) ----------- */}
      {data.currentGame && (
        <div className="profile-card-enter" style={{ animationDelay: '120ms' }}>
          <CurrentGameCard game={data.currentGame} />
        </div>
      )}

      {/* --- Social stats row ---------------------------------------- */}
      <div className="profile-card-enter" style={{ animationDelay: '180ms' }}>
        <StatsRow
          stats={[
            { label: 'Followers', value: data.counts.followers, icon: Users },
            { label: 'Following', value: data.counts.following, icon: Users },
            { label: 'Friends', value: data.counts.friends, icon: Handshake },
            { label: 'Groups', value: data.counts.groups, icon: Shield },
          ]}
        />
      </div>

      {/* --- Segmented tabs: Rolimons / Groups / Badges switch the panel
          below instead of stacking every section vertically ------------ */}
      {availableTabs.length > 0 && effectiveTab && (
        <div className="profile-card-enter" style={{ animationDelay: '240ms' }}>
          {availableTabs.length > 1 && (
            <TabBar tabs={availableTabs} active={effectiveTab} onChange={setActiveTab} />
          )}
          {/* `key` forces a remount on tab switch so .profile-card-enter's
              animation replays — same transition language as the rest of
              this modal's section entrances, just re-triggered on demand. */}
          <div key={effectiveTab} className="profile-card-enter mt-2.5 space-y-3">
            {effectiveTab === 'rolimons' && data.rolimons && (
              <>
                <PortfolioCard rolimons={data.rolimons} userId={data.id} />
                {data.rolimons.history.length > 1 && (
                  <ValueHistoryChart
                    history={data.rolimons.history}
                    liveValue={data.rolimons.value}
                    liveRap={data.rolimons.rap}
                    fetchedAt={data.fetchedAt}
                  />
                )}
              </>
            )}
            {effectiveTab === 'limiteds' && (
              <LimitedsGrid limiteds={data.limiteds} onSelect={setSelectedLimited} />
            )}
            {effectiveTab === 'groups' && <GroupsList groups={data.groups} />}
            {effectiveTab === 'badges' && <BadgesGrid badges={data.badges} />}
          </div>
        </div>
      )}
    </div>
    {/* Nested on top of this Roblox modal, not inline in the tab panel —
        reuses the same Modal shell (portaled to document.body, so it
        stacks and animates independently; see the modalStack note in
        Modal.tsx for why Escape still only closes this one). */}
    {selectedLimited && (
      <LimitedDetailModal item={selectedLimited} onClose={() => setSelectedLimited(null)} />
    )}
    </>
  )
}

type ProfileTab = 'rolimons' | 'limiteds' | 'groups' | 'badges'

// Pill segmented control — same visual language as the chart's own range
// buttons (active = bg-white/10, inactive = faint text), just applied to
// whole sections instead of a time window.
function TabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: ProfileTab; label: string }[]
  active: ProfileTab
  onChange: (key: ProfileTab) => void
}) {
  return (
    <div className="flex gap-1 rounded-full bg-bg-raised p-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`flex-1 rounded-full py-1.5 text-[11px] font-semibold transition-colors ${
            active === t.key ? 'bg-white/10 text-fg' : 'text-fg-faint hover:text-fg-muted'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
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

// Rounded, colored "24h change"-style chip — the pattern every crypto
// wallet uses next to a balance (Exodus, Coinbase, etc.): a filled pill
// with a directional arrow, not just colored text, so gains/losses read
// at a glance even at a distance from the number itself.
function ChangePill({ pct }: { pct: number }) {
  const up = pct >= 0
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        up ? 'bg-emerald-400/15 text-emerald-400' : 'bg-red-400/15 text-red-400'
      }`}
    >
      {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {up ? '+' : ''}
      {pct.toFixed(1)}%
    </span>
  )
}

// The wallet "balance" hero — Rank is the headline number, RAP/Value sit
// underneath as secondary figures in their own chip, and the badge shelf
// lives in the same card below a hairline divider with an edge fade so it
// reads as a swipeable collectibles strip.
function PortfolioCard({
  rolimons,
  userId,
}: {
  rolimons: NonNullable<RobloxData['rolimons']>
  userId: number
}) {
  const value = useCountUp(rolimons.value)
  const rap = useCountUp(rolimons.rap)
  const rank = useCountUp(rolimons.rank)

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-bg-raised to-bg-subtle ring-1 ring-white/5">
      <a
        href={`https://www.rolimons.com/player/${userId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="relative block p-4 text-center transition-opacity hover:opacity-90"
      >
        <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
          Rolimons
        </div>
        <div className="mt-1 flex items-center justify-center gap-2">
          <span className="font-mono text-3xl font-bold text-fg">
            {rolimons.rank != null ? `#${Math.round(rank).toLocaleString('en-US')}` : '—'}
          </span>
        </div>
        <div className="mt-3 flex items-center justify-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-1 text-fg-muted">
            Value
            <span className="font-mono font-semibold text-fg">
              {rolimons.value != null ? fmtCount(value) : '—'}
            </span>
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-1 text-fg-muted">
            RAP
            <span className="font-mono font-semibold text-fg">
              {rolimons.rap != null ? fmtCount(rap) : '—'}
            </span>
          </span>
        </div>
      </a>
      {rolimons.badges.length > 0 && (
        <div
          className="scrollbar-none relative flex gap-2 overflow-x-auto border-t border-line px-3 py-2.5 [mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-12px),transparent)]"
        >
          {rolimons.badges.map((b, idx) => {
            const icon = ROLI_BADGE_ICON[b.key]
            return (
              <span
                key={b.key}
                aria-label={b.name}
                className="badge-row-enter inline-flex shrink-0"
                style={{ animationDelay: `${idx * 30}ms` }}
              >
                <FloatingTooltip label={b.name}>
                  {icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={icon}
                      alt={b.name}
                      draggable={false}
                      loading="lazy"
                      decoding="async"
                      className="h-7 w-7 select-none"
                    />
                  ) : (
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-fg-muted">
                      {b.name}
                    </span>
                  )}
                </FloatingTooltip>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

const RANGE_OPTIONS: { key: string; label: string; days: number | null }[] = [
  { key: '1w', label: '1W', days: 7 },
  { key: '1m', label: '1M', days: 30 },
  { key: '3m', label: '3M', days: 90 },
  { key: '6m', label: '6M', days: 180 },
  { key: '1y', label: '1Y', days: 365 },
  { key: 'all', label: 'ALL', days: null },
]

// Value/RAP history, redrawn from scratch per the Rolimons player-page
// chart (cyan Value + green RAP lines, range buttons, crosshair tooltip) —
// see lib/rolimonsHistory.ts for where the plotted points come from (a
// digitized approximation of the real chart, plus real recorded points
// going forward). Hand-rolled SVG rather than a charting dependency, same
// as the rest of this file's visuals.
function ValueHistoryChart({
  history,
  liveValue,
  liveRap,
  fetchedAt,
}: {
  history: { t: number; value: number; rap: number }[]
  liveValue: number | null
  liveRap: number | null
  fetchedAt: string
}) {
  const [range, setRange] = useState('all')
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  // Merge in the live point from this fetch so the line always ends "now",
  // even before a recorded snapshot exists for today.
  const points = useMemo(() => {
    const live =
      liveValue != null && liveRap != null
        ? [{ t: Math.floor(new Date(fetchedAt).getTime() / 1000), value: liveValue, rap: liveRap }]
        : []
    const all = [...history, ...live].filter(
      (p) => p.t && Number.isFinite(p.value) && Number.isFinite(p.rap),
    )
    all.sort((a, b) => a.t - b.t)
    const deduped: typeof all = []
    for (const p of all) {
      if (deduped.length && deduped[deduped.length - 1].t === p.t) deduped[deduped.length - 1] = p
      else deduped.push(p)
    }
    return deduped
  }, [history, liveValue, liveRap, fetchedAt])

  const opt = RANGE_OPTIONS.find((o) => o.key === range) ?? RANGE_OPTIONS[RANGE_OPTIONS.length - 1]
  const filtered = useMemo(() => {
    if (points.length < 2 || opt.days == null) return points
    const cutoff = points[points.length - 1].t - opt.days * 86_400
    const sliced = points.filter((p) => p.t >= cutoff)
    return sliced.length >= 2 ? sliced : points.slice(-2)
  }, [points, opt])

  const handleMove = useCallback(
    (clientX: number) => {
      const svg = svgRef.current
      if (!svg || filtered.length === 0) return
      const rect = svg.getBoundingClientRect()
      const relX = ((clientX - rect.left) / rect.width) * 100
      const minT = filtered[0].t
      const spanT = Math.max(1, filtered[filtered.length - 1].t - minT)
      let best = 0
      let bestDist = Infinity
      for (let i = 0; i < filtered.length; i++) {
        const px = ((filtered[i].t - minT) / spanT) * 100
        const dist = Math.abs(px - relX)
        if (dist < bestDist) {
          bestDist = dist
          best = i
        }
      }
      setHoverIdx(best)
    },
    [filtered],
  )

  if (filtered.length < 2) return null

  const W = 300
  const H = 110
  const PAD_X = 4
  const PAD_TOP = 8
  const PAD_BOTTOM = 18

  const minT = filtered[0].t
  const maxT = filtered[filtered.length - 1].t
  const spanT = Math.max(1, maxT - minT)
  const vals = filtered.flatMap((p) => [p.value, p.rap])
  const minV = Math.min(...vals)
  const maxV = Math.max(...vals)
  const spanV = Math.max(1, maxV - minV)

  const xPos = (t: number) => PAD_X + ((t - minT) / spanT) * (W - PAD_X * 2)
  const yPos = (v: number) => PAD_TOP + (1 - (v - minV) / spanV) * (H - PAD_TOP - PAD_BOTTOM)

  const valuePath = filtered
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xPos(p.t).toFixed(2)},${yPos(p.value).toFixed(2)}`)
    .join(' ')
  const rapPath = filtered
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xPos(p.t).toFixed(2)},${yPos(p.rap).toFixed(2)}`)
    .join(' ')

  const first = filtered[0]
  const last = filtered[filtered.length - 1]
  // Closed area under the Value line, for the gradient fill — the "filled
  // portfolio chart" look every wallet app uses instead of a bare stroke.
  const valueAreaPath = `${valuePath} L${xPos(last.t).toFixed(2)},${(H - PAD_BOTTOM).toFixed(2)} L${xPos(first.t).toFixed(2)},${(H - PAD_BOTTOM).toFixed(2)} Z`
  const hovered = hoverIdx != null ? filtered[hoverIdx] : null
  const active = hovered ?? last
  const valuePct = first.value ? ((active.value - first.value) / first.value) * 100 : 0
  const rapPct = first.rap ? ((active.rap - first.rap) / first.rap) * 100 : 0

  const xTickCount = Math.min(4, filtered.length)
  const xTicks =
    xTickCount > 1
      ? Array.from(
          { length: xTickCount },
          (_, i) => filtered[Math.round((i / (xTickCount - 1)) * (filtered.length - 1))],
        )
      : filtered

  return (
    <div className="rounded-2xl bg-bg-raised p-3">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-fg-muted">
        {fmtChartDate(active.t)}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs">
        <span className="flex items-center gap-1.5 text-fg">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#f5f5f5]" />
          {fmtCount(active.value)}
          <ChangePill pct={valuePct} />
        </span>
        <span className="flex items-center gap-1.5 text-fg">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#8a8a8a]" />
          {fmtCount(active.rap)}
          <ChangePill pct={rapPct} />
        </span>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="mt-2 h-[100px] w-full touch-none select-none"
        onMouseMove={(e) => handleMove(e.clientX)}
        onMouseLeave={() => setHoverIdx(null)}
        onTouchStart={(e) => handleMove(e.touches[0].clientX)}
        onTouchMove={(e) => handleMove(e.touches[0].clientX)}
        onTouchEnd={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id="roli-value-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f5f5f5" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#f5f5f5" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[minV, (minV + maxV) / 2, maxV].map((v, i) => (
          <line
            key={i}
            x1={PAD_X}
            x2={W - PAD_X}
            y1={yPos(v)}
            y2={yPos(v)}
            stroke="currentColor"
            className="text-white/5"
            strokeWidth="1"
          />
        ))}
        <path d={valueAreaPath} fill="url(#roli-value-fill)" stroke="none" />
        <path d={rapPath} fill="none" stroke="#8a8a8a" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        <path d={valuePath} fill="none" stroke="#f5f5f5" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        {hovered && (
          <line
            x1={xPos(hovered.t)}
            x2={xPos(hovered.t)}
            y1={PAD_TOP}
            y2={H - PAD_BOTTOM}
            stroke="currentColor"
            className="text-white/20"
            strokeWidth="1"
          />
        )}
        {hovered && (
          <>
            <circle cx={xPos(hovered.t)} cy={yPos(hovered.value)} r="2.5" fill="#f5f5f5" />
            <circle cx={xPos(hovered.t)} cy={yPos(hovered.rap)} r="2.5" fill="#8a8a8a" />
          </>
        )}
      </svg>

      <div className="mt-1 flex justify-between text-[8px] uppercase tracking-wide text-fg-faint">
        {xTicks.map((p, i) => (
          <span key={i}>{fmtAxisMonth(p.t)}</span>
        ))}
      </div>

      <div className="mt-2.5 flex gap-1 rounded-full bg-black/20 p-1">
        {RANGE_OPTIONS.map((o) => (
          <button
            key={o.key}
            onClick={() => setRange(o.key)}
            className={`flex-1 rounded-full py-1 text-[9px] font-semibold uppercase tracking-wide transition-colors ${
              range === o.key ? 'bg-white/10 text-fg' : 'text-fg-faint hover:text-fg-muted'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// Grid rather than the old horizontal scroller — a dedicated tab has the
// full modal width to spend, so a 4-column grid shows more badges at once
// without needing a swipe gesture to discover them.
function BadgesGrid({ badges }: { badges: RobloxData['badges'] }) {
  return (
    <div className="grid grid-cols-4 gap-2 rounded-xl bg-bg-raised p-3">
      {badges.map((b, idx) => (
        <div
          key={b.id}
          className="badge-row-enter tooltip-anchor group flex flex-col items-center gap-1"
          style={{ animationDelay: `${idx * 30}ms` }}
        >
          <span className="tooltip-bubble">{b.description || b.name}</span>
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
          <div className="w-full truncate text-center text-[9px] text-fg-muted">{b.name}</div>
        </div>
      ))}
    </div>
  )
}

// 3-column grid of owned limiteds, sorted server-side by RAP descending —
// mirrors Rolimons' own inventory cards (thumbnail, RAP, serial) but pulled
// from Roblox's official collectibles endpoint instead of scraping theirs.
// Tiles used to link straight out to the Roblox catalog page; they now open
// `onSelect`'s detail modal instead (value/RAP/demand/trend/best price —
// see LimitedDetailModal below), which is where that catalog link now lives
// alongside a Rolimons one. No hover tooltip here (unlike the other grids
// in this file) — the tile's own name is already shown directly below the
// thumbnail, and the tile is now a click target that opens a whole modal
// with the full name front and center, so a hover-only bubble is redundant.
function LimitedsGrid({
  limiteds,
  onSelect,
}: {
  limiteds: RobloxData['limiteds']
  onSelect: (item: RobloxData['limiteds'][number]) => void
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {limiteds.map((item, idx) => (
        <div key={item.id} className="badge-row-enter" style={{ animationDelay: `${idx * 20}ms` }}>
          <button
            type="button"
            onClick={() => onSelect(item)}
            className="group flex w-full flex-col overflow-hidden rounded-xl bg-bg-raised text-left transition-colors hover:bg-bg-subtle"
          >
            <div className="flex aspect-square items-center justify-center bg-bg-subtle">
              {item.icon_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.icon_url}
                  alt={item.name}
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-contain p-1.5"
                />
              ) : (
                <ShieldCheck size={16} className="text-fg-muted" />
              )}
            </div>
            <div className="space-y-0.5 p-1.5">
              <div className="truncate text-[10px] font-medium text-fg">{item.name}</div>
              <div className="flex items-center justify-between text-[9px] text-fg-muted">
                <span>{item.rap != null ? fmtCount(item.rap) : '—'}</span>
                {item.serial != null && <span className="text-fg-faint">#{item.serial}</span>}
              </div>
            </div>
          </button>
        </div>
      ))}
    </div>
  )
}

// Color-coded demand/trend lookup tables, indexed 0-4 to match Rolimons'
// own Terrible→Amazing / Lowering→Fluctuating scales (see DEMAND_LABELS /
// TREND_LABELS in app/api/roblox/item/route.ts, which this mirrors).
// Demand ramps red (bad) → neutral → emerald (good); trend reuses the same
// ramp but gives "Fluctuating" (idx 4) its own blue treatment since it
// isn't unambiguously good the way a flat "Raising" trend is. Split into
// `text` (label color) and `bar` (solid fill for the Gauge segments below)
// rather than one pill-badge color — see Gauge for why.
const DEMAND_META: { text: string; bar: string }[] = [
  { text: 'text-red-400', bar: 'bg-red-400' },
  { text: 'text-orange-400', bar: 'bg-orange-400' },
  { text: 'text-fg-muted', bar: 'bg-white/30' },
  { text: 'text-emerald-400', bar: 'bg-emerald-400' },
  { text: 'text-emerald-400', bar: 'bg-emerald-400' },
]
const TREND_META: { text: string; bar: string }[] = [
  { text: 'text-red-400', bar: 'bg-red-400' },
  { text: 'text-orange-400', bar: 'bg-orange-400' },
  { text: 'text-fg-muted', bar: 'bg-white/30' },
  { text: 'text-emerald-400', bar: 'bg-emerald-400' },
  { text: 'text-[#2196F3]', bar: 'bg-[#2196F3]' },
]

// 5-segment gauge bar standing in for the Demand/Trend filled-pill badges
// that used to live here — those read as a generic "AI dashboard" chip.
// Both labels are ordinal 0-4 scales on Rolimons' own item pages, so a
// single lit notch at the current index reads as "a position on that
// scale" (e.g. Stable sitting dead-center, flanked by two dim segments on
// each side). A *cumulative* fill (0..activeIndex all lit) was tried first
// but that reads as progress/magnitude — it makes Stable look "60% of the
// way to good" rather than neutral — which is the wrong read for a
// categorical state rather than an amount.
function Gauge({ activeIndex, color }: { activeIndex: number | null; color: string }) {
  return (
    <div className="mt-2 flex gap-1">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className={`h-1.5 flex-1 rounded-full transition-colors ${
            activeIndex != null && i === activeIndex ? color : 'bg-white/10'
          }`}
        />
      ))}
    </div>
  )
}

// Small bordered number tile — the Value/RAP/Best Price/Quantity 2x2 grid
// in LimitedDetailModal. Reuses useCountUp/fmtCount so these animate in
// the same "balance loading" style as the rest of the profile's numbers.
function StatTile({ label, value }: { label: string; value: number | null }) {
  const animated = useCountUp(value)
  return (
    <div className="rounded-xl bg-bg-raised p-2.5 text-center">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-fg-faint">{label}</div>
      <div className="mt-0.5 font-mono text-sm font-bold text-fg">
        {value != null ? fmtCount(animated) : '—'}
      </div>
    </div>
  )
}

// Rare/Projected/Hyped flag chip — same filled-pill language as ChangePill
// above, just icon + label instead of a percentage.
function TagChip({ icon: Icon, label, color }: { icon: LucideIcon; label: string; color: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${color}`}>
      <Icon size={10} />
      {label}
    </span>
  )
}

// In-memory, module-level cache for per-item detail lookups — reopening the
// same limited within a session (easy to do: back out of the detail modal
// and tap the same tile again) previously refetched and re-flashed the
// loading state every time. TTL matches the backing route's own
// revalidate=300 (app/api/roblox/item/route.ts), so this never serves data
// staler than the server would anyway.
const ITEM_DETAIL_CACHE_TTL_MS = 5 * 60 * 1000
const itemDetailCache = new Map<number, { at: number; data: LimitedDetail }>()

// Per-item catalog detail — opened from a LimitedsGrid tile click instead
// of linking straight out to Roblox's catalog page. `item` is what's
// already known from the main /api/roblox payload (name/rap/serial/icon),
// so the modal has something to render instantly; `detail` is fetched
// lazily from /api/roblox/item (see that route for why it's a separate,
// on-demand call) and fills in value/demand/trend/best price/quantity —
// the same figures Rolimons' own item page shows — once it lands.
function LimitedDetailModal({
  item,
  onClose,
}: {
  item: RobloxData['limiteds'][number]
  onClose: () => void
}) {
  const [detail, setDetail] = useState<LimitedDetail | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    const cached = itemDetailCache.get(item.assetId)
    if (cached && Date.now() - cached.at < ITEM_DETAIL_CACHE_TTL_MS) {
      setDetail(cached.data)
      setFailed(false)
      return
    }
    setDetail(null)
    setFailed(false)
    fetch(`/api/roblox/item?assetId=${item.assetId}`)
      .then((r) => r.json())
      .then((j: { success?: boolean; data?: LimitedDetail }) => {
        if (cancelled) return
        if (j.success && j.data) {
          setDetail(j.data)
          itemDetailCache.set(item.assetId, { at: Date.now(), data: j.data })
        } else {
          setFailed(true)
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [item.assetId])

  const loading = !detail && !failed
  const demandMeta = detail?.demand != null ? DEMAND_META[detail.demand] : null
  const trendMeta = detail?.trend != null ? TREND_META[detail.trend] : null
  const icon = detail?.icon_url || item.icon_url

  return (
    <Modal title={item.name} onClose={onClose} hideTitle>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-bg-raised">
            {icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={icon}
                alt={item.name}
                referrerPolicy="no-referrer"
                loading="lazy"
                decoding="async"
                className="h-full w-full object-contain p-1.5"
              />
            ) : (
              <ShieldCheck size={20} className="text-fg-muted" />
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="truncate text-sm font-semibold text-fg">{item.name}</div>
            <div className="flex flex-wrap items-center gap-1.5">
              {item.serial != null && (
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-fg-muted">
                  Serial #{item.serial}
                </span>
              )}
              {detail?.rare && <TagChip icon={Gem} label="Rare" color="text-[#B067F5] bg-[#B067F5]/15" />}
              {detail?.projected && (
                <TagChip icon={AlertTriangle} label="Projected" color="text-orange-400 bg-orange-400/15" />
              )}
              {detail?.hyped && <TagChip icon={Flame} label="Hyped" color="text-red-400 bg-red-400/15" />}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <StatTile label="Value" value={detail?.value ?? null} />
          <StatTile label="RAP" value={detail?.rap ?? item.rap ?? null} />
          <StatTile label="Best Price" value={detail?.bestPrice ?? null} />
          <StatTile label="Quantity" value={detail?.totalQuantity ?? null} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-bg-raised p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
                Demand
              </span>
              <span className={`text-xs font-bold ${demandMeta?.text ?? 'text-fg-faint'}`}>
                {detail?.demandLabel ?? '—'}
              </span>
            </div>
            <Gauge activeIndex={detail?.demand ?? null} color={demandMeta?.bar ?? 'bg-white/10'} />
          </div>
          <div className="rounded-xl bg-bg-raised p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
                Trend
              </span>
              <span className={`text-xs font-bold ${trendMeta?.text ?? 'text-fg-faint'}`}>
                {detail?.trendLabel ?? '—'}
              </span>
            </div>
            <Gauge activeIndex={detail?.trend ?? null} color={trendMeta?.bar ?? 'bg-white/10'} />
          </div>
        </div>

        {loading && (
          <div className="text-center text-[10px] uppercase tracking-wider text-fg-faint">
            Loading catalog data…
          </div>
        )}
        {failed && (
          <div className="text-center text-[10px] uppercase tracking-wider text-fg-faint">
            Catalog data unavailable
          </div>
        )}

        <div className="flex gap-2">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 rounded-xl bg-bg-raised py-2 text-center text-[11px] font-semibold text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg"
          >
            View on Roblox
          </a>
          <a
            href={detail?.rolimonsUrl || `https://www.rolimons.com/item/${item.assetId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 rounded-xl bg-bg-raised py-2 text-center text-[11px] font-semibold text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg"
          >
            View on Rolimons
          </a>
        </div>
      </div>
    </Modal>
  )
}

function GroupsList({ groups }: { groups: RobloxData['groups'] }) {
  return (
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
  )
}


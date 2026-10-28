'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useReducedMotion } from 'framer-motion'
import { Check, Copy, Gamepad2, Loader2, MoreHorizontal } from 'lucide-react'
import { useCachedPoll } from '@/lib/useCachedPoll'
import { subscribeLanyard } from '@/lib/lanyard'

type DiscordUser = {
  id: string
  username: string
  global_name: string | null
  discriminator: string | null
  avatar?: { url: string; is_animated: boolean; is_default?: boolean } | null
  avatar_decoration?: { url: string } | null
  banner?: { url: string | null; color?: string | null; is_animated?: boolean } | null
  accent_color?: { hex: string | null } | null
  collectibles?: {
    nameplate?: {
      webm_url: string
      static_url: string
      label?: string
      palette?: string
    } | null
  } | null
  primary_guild?: {
    tag: string
    badge_url: string | null
  } | null
  badges?: { name: string; description: string; icon_url: string }[]
  premium_type?: number
  premium_label?: string | null
  creation_date?: string
}

type ApiResponse = {
  success?: boolean
  data?: DiscordUser
  error?: string
  message?: string
}

// Matches the route's own revalidate=300 (app/api/discord/route.ts) — same
// convention as RobloxProfile/TikTokProfile's POLL_MS.
const POLL_MS = 5 * 60 * 1000

// Avatar decoration (the animated-frame PNG Discord renders around the pfp)
// scale + offset. Decoration art ships on a fixed square canvas with varying
// internal padding per-asset, so there's no formula that fits every
// decoration — these were dialed in by eye via the `?debugdecoration=1`
// positioner below and should be re-tuned the same way if they ever look off
// for a different decoration asset.
const DECORATION_SCALE = 1.18
const DECORATION_NUDGE = { x: 0, y: 0 }

// Palette used for the initial-letter fallback so different users get
// different colors instead of all defaulting to the same grey blob.
const FALLBACK_PALETTE = ['#5865F2', '#EB459E', '#57F287', '#FEE75C', '#ED4245']

function fallbackColor(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return FALLBACK_PALETTE[h % FALLBACK_PALETTE.length]
}

function Avatar({
  size,
  showImg,
  imgUrl,
  onError,
  initial,
  initialBg,
  decorationUrl,
  decorationScale = DECORATION_SCALE,
  decorationNudge = DECORATION_NUDGE,
  noBorder = false,
  priority = false,
}: {
  size: number
  showImg: boolean
  imgUrl?: string
  onError: () => void
  initial: string
  initialBg: string
  decorationUrl?: string | null
  // Live overrides from the `?debugdecoration=1` positioner — defaults to
  // the dialed-in constants above when not debugging.
  decorationScale?: number
  decorationNudge?: { x: number; y: number }
  // When true, drops the inner 2px black/40 outline entirely. Used in the
  // expanded profile where the outer wrapper's border-4 already provides
  // the visible ring, and an inner border only introduces subpixel gaps
  // between border and image content (visible on zoom).
  noBorder?: boolean
  // Hints to the browser that this avatar is a modal-LCP element so it
  // gets scheduled ahead of the decoration overlay + banner. Sets
  // fetchPriority="high" on the <img> — meaningful because Discord CDN
  // avatars are the largest visible element of the profile modal.
  priority?: boolean
}) {
  const borderCls = noBorder ? '' : 'border-2 border-black/40'
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {showImg && imgUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imgUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={onError}
          fetchPriority={priority ? 'high' : 'auto'}
          decoding="async"
          // `block` kills the baseline gap that default inline images get
          // when aligned to a parent text baseline.
          className={`block rounded-full bg-bg-raised object-cover ${borderCls}`}
          style={{ width: size, height: size }}
        />
      ) : (
        <div
          className={`flex items-center justify-center rounded-full font-display font-semibold text-white ${borderCls}`}
          style={{
            width: size,
            height: size,
            backgroundColor: initialBg,
            fontSize: size * 0.42,
          }}
          aria-hidden="true"
        >
          {initial}
        </div>
      )}
      {decorationUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={decorationUrl}
          alt=""
          referrerPolicy="no-referrer"
          aria-hidden="true"
          draggable={false}
          className="pointer-events-none absolute select-none"
          style={{
            width: size * decorationScale,
            height: size * decorationScale,
            left: -((size * decorationScale - size) / 2) + decorationNudge.x,
            top: -((size * decorationScale - size) / 2) + decorationNudge.y,
            // Tailwind preflight's `img { max-width: 100% }` would otherwise
            // cap this at the 56/64px avatar box width (its nearest
            // positioned ancestor) while height scales freely — see the same
            // override on the main-page decoration in BioLink.tsx.
            maxWidth: 'none',
            objectFit: 'contain',
          }}
        />
      )}
    </div>
  )
}

// ---------- Lanyard presence ----------
// Public real-time Discord presence API (api.lanyard.rest). Only works if the
// user has joined the Lanyard Discord server; otherwise the endpoint returns
// success: false and we quietly render nothing. Polls while the modal is
// mounted — 15s cadence is plenty for status changes.
type LanyardActivity = {
  id: string
  name: string
  type: 0 | 1 | 2 | 3 | 4 | 5 // 0=game, 1=stream, 2=listen, 3=watch, 4=custom, 5=compete
  state?: string
  details?: string
  application_id?: string
  timestamps?: { start?: number; end?: number }
  assets?: {
    large_image?: string
    large_text?: string
    small_image?: string
    small_text?: string
  }
  emoji?: { name: string; id?: string; animated?: boolean }
}

type LanyardSpotify = {
  track_id: string
  timestamps: { start: number; end: number }
  song: string
  artist: string
  album_art_url: string
  album: string
}

type LanyardData = {
  spotify: LanyardSpotify | null
  discord_status: 'online' | 'idle' | 'dnd' | 'offline'
  activities: LanyardActivity[]
  listening_to_spotify: boolean
  active_on_desktop?: boolean
  active_on_mobile?: boolean
  active_on_web?: boolean
}

// Explicit state so the UI can distinguish "still fetching" from "user not in
// the Lanyard guild" from "network error". Silent-fail hid every real bug.
type LanyardState =
  | { status: 'idle'; data: null; message: null }
  | { status: 'loading'; data: null; message: null }
  | { status: 'ok'; data: LanyardData; message: null }
  | { status: 'not-monitored'; data: null; message: string }
  | { status: 'error'; data: null; message: string }

// Subscribes to the shared Lanyard poller (lib/lanyard.ts) rather than
// running its own fetch/interval — BioLink.tsx subscribes to the same
// userId for the whole time the page is open, so by the time this modal's
// profile card expands and calls this hook, the shared poll is typically
// already warm: `subscribeLanyard` replays the last known envelope
// synchronously, which is what lets `status: 'ok'` data show up on the very
// first render instead of a guaranteed loading flash. Only when this is the
// very first subscriber for that userId (Lanyard polling genuinely hasn't
// started yet) does a real request get fired.
function useLanyard(userId: string): LanyardState {
  const [state, setState] = useState<LanyardState>({
    status: 'idle',
    data: null,
    message: null,
  })
  useEffect(() => {
    if (!userId) {
      setState({ status: 'idle', data: null, message: null })
      return
    }
    // Only show the loading spinner on the first load, not on background
    // polls — otherwise the presence card would flicker every tick.
    setState((prev) =>
      prev.status === 'ok' ? prev : { status: 'loading', data: null, message: null },
    )
    return subscribeLanyard(userId, (envelope) => {
      if (envelope.ok && envelope.data) {
        setState({ status: 'ok', data: envelope.data as unknown as LanyardData, message: null })
      } else if (envelope.status === 404 || envelope.errorCode === 'user_not_monitored') {
        setState({
          status: 'not-monitored',
          data: null,
          message: envelope.errorMessage || 'User not in Lanyard guild',
        })
      } else {
        setState({ status: 'error', data: null, message: envelope.errorMessage || 'Lanyard error' })
      }
    })
  }, [userId])
  return state
}

const STATUS_LABEL: Record<LanyardData['discord_status'], string> = {
  online: 'Online',
  idle: 'Idle',
  dnd: 'Do not disturb',
  offline: 'Offline',
}

// Official Discord UI Kit status glyphs (20-unit viewBox). Each has a built-in
// solid black (#000) shell that also shows through the negative-space cutouts
// (DND pill, offline hole, idle crescent bite) since the colored shape is
// drawn on top. No extra ring needed — the shell IS the outline.
function StatusGlyph({
  status,
  size,
}: {
  status: LanyardData['discord_status']
  size: number
}) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 20 20',
    fill: 'none' as const,
    xmlns: 'http://www.w3.org/2000/svg',
    'aria-hidden': true as const,
    focusable: false as const,
  }
  switch (status) {
    case 'online':
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="10" fill="#000000" />
          <path
            d="M15.8707 10.0677C15.8707 13.3815 13.1844 16.0677 9.87073 16.0677C6.55702 16.0677 3.87073 13.3815 3.87073 10.0677C3.87073 6.75404 6.55702 4.06775 9.87073 4.06775C13.1844 4.06775 15.8707 6.75404 15.8707 10.0677Z"
            fill="#3BA55C"
          />
        </svg>
      )
    case 'idle':
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="10" fill="#000000" />
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M9.86506 15.9795C13.1819 15.9795 15.8707 13.2907 15.8707 9.97383C15.8707 7.04093 13.7684 4.59906 10.9885 4.07303C10.7215 4.02252 10.5572 4.34524 10.7078 4.57139C11.1832 5.28534 11.4603 6.14272 11.4603 7.06482C11.4603 9.55246 9.44369 11.5691 6.95606 11.5691C6.03396 11.5691 5.17658 11.292 4.46263 10.8166C4.23648 10.666 3.91375 10.8303 3.96427 11.0972C4.4903 13.8772 6.93216 15.9795 9.86506 15.9795Z"
            fill="#FAA61A"
          />
        </svg>
      )
    case 'dnd':
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="10" fill="#000000" />
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            transform="translate(0.12927 -0.0677)"
            d="M9.87073 16.0677C13.1844 16.0677 15.8707 13.3815 15.8707 10.0677C15.8707 6.75404 13.1844 4.06775 9.87073 4.06775C6.55702 4.06775 3.87073 6.75404 3.87073 10.0677C3.87073 13.3815 6.55702 16.0677 9.87073 16.0677ZM7.56304 8.68313C6.79833 8.68313 6.17842 9.30305 6.17842 10.0677C6.17842 10.8325 6.79833 11.4524 7.56304 11.4524H12.1784C12.9431 11.4524 13.563 10.8325 13.563 10.0677C13.563 9.30305 12.9431 8.68313 12.1784 8.68313H7.56304Z"
            fill="#ED4245"
          />
        </svg>
      )
    case 'offline':
    default:
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="10" fill="#000000" />
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M9.95898 16.0677C13.2727 16.0677 15.959 13.3815 15.959 10.0677C15.959 6.75404 13.2727 4.06775 9.95898 4.06775C6.64528 4.06775 3.95898 6.75404 3.95898 10.0677C3.95898 13.3815 6.64528 16.0677 9.95898 16.0677ZM9.95898 7.29852C8.42958 7.29852 7.18975 8.53835 7.18975 10.0677C7.18975 11.5972 8.42958 12.837 9.95898 12.837C11.4884 12.837 12.7282 11.5972 12.7282 10.0677C12.7282 8.53835 11.4884 7.29852 9.95898 7.29852Z"
            fill="#747F8D"
          />
        </svg>
      )
  }
}

// Positions a StatusGlyph on the bottom-right of the avatar. No boxShadow
// ring needed — the glyph's built-in #18191C shell provides the outline.
// (ringColor kept in the signature for API stability; a future variant
// without a shell could bring it back.)
function StatusDot({
  status,
  size,
}: {
  status: LanyardData['discord_status']
  size: number
  ringColor: string
}) {
  return (
    // Sits at the 4–5 o'clock position with its center on the avatar's edge,
    // so exactly half of the glyph overlaps the pfp and half hangs outside.
    // Slight negative inset lets the glyph's center land on the circle.
    // The tooltip anchor lives on an inner wrapper, not this span, since its
    // `position: relative` would otherwise clobber this span's `absolute`
    // placement (same specificity, later in the cascade).
    <span
      role="img"
      aria-label={STATUS_LABEL[status]}
      className="absolute -bottom-[2.4px] -right-[2.4px] block leading-none"
      style={{ width: size, height: size }}
    >
      <span className="tooltip-anchor block h-full w-full">
        <span className="tooltip-bubble">{STATUS_LABEL[status]}</span>
        <StatusGlyph status={status} size={size} />
      </span>
    </span>
  )
}

// A speech-bubble-style custom status that hovers up-right of the pfp with a
// two-dot thought-bubble tail pointing back down to the avatar. Absolutely
// positioned — must be rendered inside a `relative` parent that sits at the
// avatar's location (the pfp wrapper). Kept `pointer-events-none` so it never
// steals hover from the header behind it.
function CustomStatusBubble({ activity }: { activity: LanyardActivity }) {
  const emojiUrl = activity.emoji?.id
    ? `https://cdn.discordapp.com/emojis/${activity.emoji.id}.${activity.emoji.animated ? 'gif' : 'png'}?size=32`
    : null

  return (
    <div className="pointer-events-none absolute -top-5 left-[72px] z-20">
      {/* Bubble body — no ring/border, just a soft shadow so it feels like a
          clean floating chat bubble. */}
      <div className="relative flex max-w-[220px] items-center gap-1.5 rounded-2xl bg-bg-raised px-3 py-1 shadow-md">
        {emojiUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={emojiUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="h-4 w-4 shrink-0"
          />
        ) : activity.emoji?.name ? (
          <span aria-hidden="true" className="shrink-0 text-sm leading-none">
            {activity.emoji.name}
          </span>
        ) : null}
        {activity.state && (
          <span className="truncate text-xs text-fg">
            {activity.state}
          </span>
        )}
      </div>
      {/* Tail: a single small circle between the pfp and the bubble body. */}
      <span className="absolute -bottom-[6px] -left-[6px] block h-2 w-2 rounded-full bg-bg-raised" />
    </div>
  )
}

// Format a "started X ago" duration for game activities.
function fmtElapsed(startMs: number, nowMs: number): string {
  const s = Math.max(0, Math.floor((nowMs - startMs) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

// Try to resolve an activity's large_image into a fetchable URL. Discord
// encodes app assets and external images differently; we handle both.
function resolveActivityImage(activity: LanyardActivity): string | null {
  const asset = activity.assets?.large_image
  if (!asset) return null
  if (asset.startsWith('mp:external/')) {
    // External URL proxied through media.discordapp.net
    return `https://media.discordapp.net/${asset.slice(3)}`
  }
  if (asset.startsWith('spotify:')) {
    return `https://i.scdn.co/image/${asset.slice(8)}`
  }
  if (activity.application_id) {
    return `https://cdn.discordapp.com/app-assets/${activity.application_id}/${asset}.png`
  }
  return null
}

// Roblox's Discord application id — used to detect the Roblox game activity
// even if the display name has been localized or renamed.
const ROBLOX_APP_ID = '363445589247131654'

// Inline SVG of the Roblox squircle logo (tilted rounded square with a small
// centered notch). The notch is a real cutout via fill-rule="evenodd" so
// whatever sits behind the logo shows through — no white infill.
function RobloxLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <defs>
        <linearGradient id="rblx-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#B7C6D4" />
          <stop offset="1" stopColor="#8FA5B7" />
        </linearGradient>
      </defs>
      <path
        transform="rotate(15 16 16)"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M4 4H28V28H4ZM13 13V19H19V13H13Z"
        fill="url(#rblx-grad)"
      />
    </svg>
  )
}

// Case-insensitive because Discord's activity feed reports the display name
// as "ROBLOX" for the launcher but "Roblox" for individual games.
function isRobloxActivity(activity: LanyardActivity): boolean {
  if (activity.application_id === ROBLOX_APP_ID) return true
  return (activity.name ?? '').toLowerCase() === 'roblox'
}

// Renders a brand mark for a given activity in the game card's right slot —
// mirrors how Spotify's logo sits on the right of its own card. Returns null
// for activities we don't have a badge for.
function BrandBadge({ activity }: { activity: LanyardActivity }) {
  if (isRobloxActivity(activity)) return <RobloxLogo className="h-12 w-12 shrink-0" />
  return null
}

// Renders every rich presence signal Lanyard reports — Spotify + all game /
// stream / watch activities, stacked. Custom status (type 4) is intentionally
// omitted because it renders as a chat bubble on the pfp. Returns null if
// nothing worth showing.
function PresenceCard({ presence }: { presence: LanyardData }) {
  const [now, setNow] = useState(() => Date.now())
  // Tick every second so the Spotify progress bar / game elapsed timer moves.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // Normalize once — Lanyard's schema in flight during hot-reload has been
  // observed to briefly have activities === undefined, which then crashes
  // `.find()`. Defaulting to [] keeps the component robust.
  const activities = presence.activities ?? []
  const hasSpotify = presence.listening_to_spotify && !!presence.spotify

  // Dedupe: when the rich Spotify card is showing, Lanyard also lists Spotify
  // as a listen-type activity (name === 'Spotify'). Filter it out so we don't
  // render the same play twice.
  const otherActivities = activities.filter(
    (a) => a.type !== 4 && !(hasSpotify && a.name === 'Spotify'),
  )

  if (!hasSpotify && otherActivities.length === 0) return null

  return (
    <div className="space-y-2">
      {hasSpotify && presence.spotify && (
        <SpotifyRow spotify={presence.spotify} now={now} />
      )}
      {otherActivities.map((activity) => (
        <ActivityRow key={activity.id} activity={activity} now={now} />
      ))}
    </div>
  )
}

// A single Spotify "now playing" row — album art on the left, song/artist +
// progress bar in the middle, Spotify glyph on the right.
//
// Normal-motion path: the bar is a pure CSS keyframe animation that runs once
// over the full track length. `animation-delay` is negative and equal to the
// elapsed time at mount, so the bar starts at the current position and
// interpolates at the browser's refresh rate — no React re-renders required.
// It re-arms whenever the song changes (dep on `.start`).
//
// Reduced-motion path: the global rule in globals.css force-collapses every
// animation to 0.001 ms, which would leave `fill-mode: forwards` holding the
// bar at 100% forever. Song position is real information, not decoration, so
// instead we fall back to a static width driven by the parent `now` tick —
// no smoothness, but the position stays truthful.
function SpotifyRow({ spotify, now }: { spotify: LanyardSpotify; now: number }) {
  const shouldReduce = useReducedMotion()
  const dur = Math.max(1, spotify.timestamps.end - spotify.timestamps.start)
  const staticPct = (Math.min(dur, Math.max(0, now - spotify.timestamps.start)) / dur) * 100

  const animatedStyle = useMemo<React.CSSProperties>(() => {
    const elapsed = Math.min(dur, Math.max(0, Date.now() - spotify.timestamps.start))
    return {
      width: '0%',
      animation: `spotify-progress ${dur}ms linear forwards`,
      animationDelay: `-${elapsed}ms`,
    }
    // dur is derived from the same two timestamps as .start, so keying on
    // .start alone is sufficient — a new song changes .start and re-arms.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotify.timestamps.start])

  const barStyle: React.CSSProperties = shouldReduce ? { width: `${staticPct}%` } : animatedStyle

  return (
    <div className="flex items-center gap-3 rounded-xl bg-bg-raised p-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={spotify.album_art_url}
        alt=""
        referrerPolicy="no-referrer"
        className="h-12 w-12 shrink-0 rounded-md object-cover"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-fg">{spotify.song}</div>
        <div className="truncate text-xs text-fg-muted">by {spotify.artist}</div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/5">
          <div className="h-full bg-[#1DB954]" style={barStyle} />
        </div>
      </div>
      {/* Spotify glyph mirrored on the right side, sized to match the album
          art so it visually balances the row. */}
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 17 17"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-8 w-8 shrink-0"
      >
        <path
          d="M8.474 0C3.79404 0 0 3.79393 0 8.47389C0 13.154 3.79404 16.9477 8.474 16.9477C13.1545 16.9477 16.9481 13.154 16.9481 8.47389C16.9481 3.79424 13.1545 0.00040476 8.4739 0.00040476L8.474 0ZM12.3601 12.2218C12.2083 12.4707 11.8825 12.5496 11.6336 12.3968C9.64396 11.1815 7.1393 10.9063 4.18959 11.5802C3.90535 11.645 3.62201 11.4669 3.55725 11.1826C3.49219 10.8982 3.66957 10.6149 3.95453 10.5501C7.1825 9.81234 9.95138 10.1302 12.1851 11.4952C12.434 11.648 12.5129 11.9729 12.3601 12.2218ZM13.3973 9.91413C13.2061 10.2253 12.7993 10.3234 12.4886 10.1322C10.2108 8.73182 6.73868 8.32635 4.04448 9.14417C3.69507 9.24972 3.32603 9.0528 3.21998 8.704C3.11475 8.35459 3.31176 7.98625 3.66057 7.88C6.73808 6.94622 10.564 7.39854 13.1798 9.00595C13.4904 9.1972 13.5886 9.60398 13.3973 9.91423V9.91413ZM13.4864 7.51147C10.7552 5.88928 6.24922 5.74013 3.64165 6.53154C3.22292 6.65853 2.78011 6.42215 2.65322 6.00343C2.52632 5.5845 2.7625 5.14199 3.18153 5.01469C6.17485 4.106 11.1509 4.28157 14.2953 6.14823C14.6727 6.37176 14.7962 6.85818 14.5726 7.23431C14.3499 7.61094 13.8622 7.7351 13.4868 7.51147H13.4864Z"
          fill="#1ED760"
        />
      </svg>
    </div>
  )
}

// Resolved app-icon URLs keyed by application_id. Discord's detectable-games
// icon lookup (see app/api/discord/activity-icon/route.ts) never changes for
// a given game within a tab's lifetime, so every ActivityRow mount for the
// same game — including the re-render this component gets every second from
// PresenceCard's elapsed-time tick — shares one fetch instead of re-hitting
// the API route. `null` is cached too, so a game with no detectable-apps
// entry doesn't get re-queried on every render either.
const gameIconCache = new Map<string, string | null>()

// Mirrors how Discord's own client fills in a game's thumbnail when the
// activity itself has no per-session rich-presence image (assets.large_image)
// — e.g. Valorant never sets one — by looking up the game's default icon from
// Discord's public "detectable applications" list instead of showing a
// generic glyph.
function useGameIconFallback(applicationId: string | undefined, enabled: boolean): string | null {
  const [url, setUrl] = useState<string | null>(
    () => (applicationId && gameIconCache.get(applicationId)) || null,
  )

  useEffect(() => {
    if (!enabled || !applicationId) return
    const cached = gameIconCache.get(applicationId)
    if (cached !== undefined) {
      setUrl(cached)
      return
    }
    let cancelled = false
    fetch(`/api/discord/activity-icon?app_id=${applicationId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { url?: string } | null) => {
        const resolved = j?.url ?? null
        gameIconCache.set(applicationId, resolved)
        if (!cancelled) setUrl(resolved)
      })
      .catch(() => {
        gameIconCache.set(applicationId, null)
      })
    return () => {
      cancelled = true
    }
  }, [applicationId, enabled])

  return url
}

// A single game / stream / watch activity row.
function ActivityRow({ activity, now }: { activity: LanyardActivity; now: number }) {
  const img = resolveActivityImage(activity)
  // Roblox launcher on the home screen has no game thumbnail — Discord's
  // Gamepad2 fallback looks generic there, so substitute the Roblox mark.
  // Once the user joins an actual place, Discord fills in the game's image
  // and we fall back to the normal thumbnail flow.
  const useRobloxThumb = !img && isRobloxActivity(activity)
  const fallbackIcon = useGameIconFallback(activity.application_id, !img && !useRobloxThumb)
  const elapsed = activity.timestamps?.start
    ? fmtElapsed(activity.timestamps.start, now)
    : null
  return (
    <div className="flex items-center gap-3 rounded-xl bg-bg-raised p-3">
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={img}
          alt=""
          referrerPolicy="no-referrer"
          className="h-12 w-12 shrink-0 rounded-md object-cover"
        />
      ) : useRobloxThumb ? (
        <RobloxLogo className="h-12 w-12 shrink-0" />
      ) : fallbackIcon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={fallbackIcon}
          alt=""
          referrerPolicy="no-referrer"
          className="h-12 w-12 shrink-0 rounded-md object-cover"
        />
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-white/5">
          <Gamepad2 size={20} className="text-fg-muted" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-fg">{activity.name}</div>
        {activity.details && (
          <div className="truncate text-xs text-fg-muted">{activity.details}</div>
        )}
        {activity.state && (
          <div className="truncate text-xs text-fg-muted">{activity.state}</div>
        )}
        {elapsed && (
          <div className="mt-0.5 text-[10px] text-fg-muted opacity-70">for {elapsed}</div>
        )}
      </div>
      {/* Only show the right-side brand badge when the thumbnail isn't already
          the same brand mark — otherwise it'd be doubled up. */}
      {!useRobloxThumb && <BrandBadge activity={activity} />}
    </div>
  )
}

// Wraps PresenceCard (and the loading / error branches) with padding so it
// nests cleanly inside the profile-header card. Returns null when there's
// nothing worth showing so the profile card ends flush after the name row.
function PresenceSlot({ state }: { state: LanyardState }) {
  let inner: JSX.Element | null = null
  let isRich = false
  if (state.status === 'loading') {
    inner = (
      <div className="flex items-center gap-2 rounded-xl bg-bg-raised px-3 py-2.5 text-xs text-fg-muted">
        <Loader2 size={12} className="animate-spin" />
        <span>Loading presence…</span>
      </div>
    )
  } else if (state.status === 'not-monitored') {
    inner = (
      <div className="rounded-xl bg-bg-raised px-3 py-2.5 text-xs text-fg-muted">
        Live presence unavailable — this account isn&apos;t in the Lanyard guild.
      </div>
    )
  } else if (state.status === 'error') {
    inner = (
      <div className="rounded-xl bg-bg-raised px-3 py-2.5 text-xs text-fg-muted">
        Presence unavailable ({state.message}).
      </div>
    )
  } else if (state.status === 'ok' && presenceIsRich(state.data)) {
    // Only show a card when there's an actual rich activity (spotify / game /
    // stream). A plain "online" / "dnd" is already communicated by the dot on
    // the pfp, so no need for a duplicate pill.
    inner = <PresenceCard presence={state.data} />
    isRich = true
  }

  if (!inner) return null
  // When a rich activity is showing, extend the card vertically by adding
  // space in the *middle* (pt-10) rather than at the bottom — keeps the
  // activity anchored near the card edge while giving the whole card visible
  // extra height. Status pills stay compact.
  const wrapperCls = isRich ? 'px-3 pb-3 pt-10' : 'px-3 pb-3'
  return <div className={wrapperCls}>{inner}</div>
}

// PresenceCard returns null when there's nothing worth showing (offline w/ no
// activity, online w/ no activity, etc.). Mirror that decision here so we know
// when to fall back to a plain status pill instead of leaving a gap.
function presenceIsRich(p: LanyardData): boolean {
  const activities = p.activities ?? []
  if (p.listening_to_spotify && p.spotify) return true
  // Custom status (type 4) is shown as a bubble on the pfp — not counted here.
  if (activities.some((a) => a.type !== 4)) return true
  return false
}

// Temporary dial-in tool for DECORATION_SCALE/DECORATION_NUDGE above — append
// `?debugdecoration=1` to the page URL to show a live control panel + enable
// arrow-key nudging over the decoration image. Tune until it lines up, copy
// the readout at the bottom of the panel back into the constants above, then
// this hook/panel can be deleted (it's dead weight for every normal visitor
// since `enabled` stays false without the query param).
const DECORATION_DEBUG_STORAGE_KEY = 'zerxbio:decoration-debug'

function useDecorationDebug() {
  const [enabled, setEnabled] = useState(false)
  const [scale, setScale] = useState(DECORATION_SCALE)
  const [nudge, setNudge] = useState(DECORATION_NUDGE)

  useEffect(() => {
    const isEnabled = new URLSearchParams(window.location.search).has('debugdecoration')
    setEnabled(isEnabled)
    if (!isEnabled) return
    try {
      const saved = localStorage.getItem(DECORATION_DEBUG_STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved) as { scale: number; nudge: { x: number; y: number } }
        setScale(parsed.scale)
        setNudge(parsed.nudge)
      }
    } catch {
      /* corrupt/missing storage, fall back to defaults */
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    localStorage.setItem(DECORATION_DEBUG_STORAGE_KEY, JSON.stringify({ scale, nudge }))
  }, [enabled, scale, nudge])

  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      // Don't hijack arrow keys while the user is editing a number input —
      // those already use arrows to step the field natively.
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const step = e.shiftKey ? 5 : 1
      if (e.key === 'ArrowLeft') setNudge((n) => ({ ...n, x: n.x - step }))
      else if (e.key === 'ArrowRight') setNudge((n) => ({ ...n, x: n.x + step }))
      else if (e.key === 'ArrowUp') setNudge((n) => ({ ...n, y: n.y - step }))
      else if (e.key === 'ArrowDown') setNudge((n) => ({ ...n, y: n.y + step }))
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])

  return { enabled, scale, setScale, nudge, setNudge }
}

// Floating control panel rendered only when the positioner is enabled.
// Deliberately plain inputs/buttons (no new deps) since this never ships to
// real visitors.
function DecorationDebugPanel({
  scale,
  setScale,
  nudge,
  setNudge,
}: {
  scale: number
  setScale: (v: number) => void
  nudge: { x: number; y: number }
  setNudge: (v: { x: number; y: number }) => void
}) {
  const code = `const DECORATION_SCALE = ${scale.toFixed(3)}\nconst DECORATION_NUDGE = { x: ${nudge.x}, y: ${nudge.y} }`
  // Portaled to document.body — this renders inside Modal's panel, whose
  // `.modal-panel-enter`/`-exit` CSS animation leaves a lingering non-`none`
  // `transform` on the panel (fill-mode `both` holds it after the animation
  // finishes), which creates a new containing block for any `position:fixed`
  // descendant. Without the portal this panel would be pinned to the modal
  // card's corner instead of the actual viewport corner.
  return createPortal(
    <div className="fixed bottom-4 right-4 z-[200] w-64 space-y-2 rounded-xl border border-line bg-bg-card p-3 text-xs text-fg shadow-2xl">
      <div className="font-semibold">Decoration debug</div>
      <label className="flex items-center justify-between gap-2">
        Scale
        <input
          type="number"
          step={0.005}
          value={scale}
          onChange={(e) => setScale(parseFloat(e.target.value) || 0)}
          className="w-20 rounded-md border border-line bg-bg px-1.5 py-0.5 text-right"
        />
      </label>
      <label className="flex items-center justify-between gap-2">
        Nudge X
        <input
          type="number"
          step={1}
          value={nudge.x}
          onChange={(e) => setNudge({ ...nudge, x: parseFloat(e.target.value) || 0 })}
          className="w-20 rounded-md border border-line bg-bg px-1.5 py-0.5 text-right"
        />
      </label>
      <label className="flex items-center justify-between gap-2">
        Nudge Y
        <input
          type="number"
          step={1}
          value={nudge.y}
          onChange={(e) => setNudge({ ...nudge, y: parseFloat(e.target.value) || 0 })}
          className="w-20 rounded-md border border-line bg-bg px-1.5 py-0.5 text-right"
        />
      </label>
      <button
        type="button"
        onClick={() => {
          setScale(DECORATION_SCALE)
          setNudge(DECORATION_NUDGE)
        }}
        className="w-full rounded-md bg-bg-raised px-2 py-1 text-center hover:bg-bg-subtle"
      >
        Reset to current constants
      </button>
      <div className="text-fg-muted">Arrow keys nudge · hold Shift for 5px steps</div>
      <pre className="whitespace-pre-wrap break-all rounded-md bg-bg px-2 py-1.5 text-[10px] text-fg-muted">
        {code}
      </pre>
    </div>,
    document.body,
  )
}

export default function DiscordProfile({ userId }: { userId: string }) {
  const fetcher = useCallback(async () => {
    const r = await fetch(`/api/discord?id=${userId}`)
    const j = (await r.json()) as ApiResponse
    if (!r.ok || !j.data) throw new Error(j.message || 'Failed to load profile')
    return j.data
  }, [userId])

  // Hydrates instantly from sessionStorage on reopen (matching
  // Roblox/TikTok/Wallet's modals) instead of guaranteeing a loading
  // spinner flash every time this modal is reopened within the same
  // session — the route already sets revalidate=300 + a public
  // s-maxage Cache-Control, so POLL_MS here just mirrors that server-side
  // freshness window rather than forcing a tighter one client-side.
  const { data: user, error } = useCachedPoll<DiscordUser>({
    cacheKey: `zerxbio:discord:profile:${userId}`,
    pollMs: POLL_MS,
    resetKey: userId,
    fetcher,
  })

  const [copied, setCopied] = useState(false)
  const [avatarBroken, setAvatarBroken] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [idCopied, setIdCopied] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const decorationDebug = useDecorationDebug()
  // Only start polling Lanyard once the modal is expanded — no point burning
  // a request every 15s for a card the user hasn't looked at yet.
  const presence = useLanyard(expanded ? userId : '')
  const presenceData = presence.status === 'ok' ? presence.data : null
  // Custom status (activity.type === 4) surfaces as a chat bubble on the pfp
  // rather than a card in the presence area — closer to how Discord itself
  // treats it in the profile popup, and keeps it visible alongside a game.
  const customStatus =
    presenceData?.activities?.find((a) => a.type === 4 && (a.state || a.emoji)) ?? null

  // `user`/`error` now come from useCachedPoll above — this just resets the
  // per-profile local UI state (avatar-broken flag, expanded card) when the
  // viewed user changes, same trigger (`userId`) the cached poll itself
  // resets on.
  useEffect(() => {
    setAvatarBroken(false)
    setExpanded(false)
  }, [userId])

  const copyUsername = async () => {
    if (!user) return
    try {
      await navigator.clipboard.writeText(user.username)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked, no-op */
    }
  }

  const copyUserId = async () => {
    if (!user) return
    try {
      await navigator.clipboard.writeText(user.id)
      setIdCopied(true)
      setTimeout(() => {
        setIdCopied(false)
        setMenuOpen(false)
      }, 1200)
    } catch {
      /* clipboard blocked, no-op */
    }
  }

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  useEffect(() => {
    if (!expanded) setMenuOpen(false)
  }, [expanded])

  if (error) {
    return (
      <div className="rounded-xl bg-bg-raised px-4 py-6 text-center text-sm text-fg-muted">
        {error}
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl bg-bg-raised">
        <Loader2 className="animate-spin text-fg-muted" size={20} />
      </div>
    )
  }

  const nameplate = user.collectibles?.nameplate
  const bannerImgUrl = user.banner?.url
  const bannerBg = user.accent_color?.hex || user.banner?.color || '#1e1e1e'
  const avatarUrl = user.avatar?.url
  const decorationUrl = user.avatar_decoration?.url
  const showAvatarImg = !!avatarUrl && !avatarBroken
  const initial = (user.global_name || user.username || '?').charAt(0).toUpperCase()
  const initialBg = fallbackColor(user.id || user.username)
  const primaryGuild = user.primary_guild

  const handleAvatarError = () => setAvatarBroken(true)

  return (
    <div className="space-y-3">
      {/* Collapsed/expanded swap — plain CSS entrance via `.profile-card-enter`
          (see globals.css) instead of framer-motion's AnimatePresence. This
          toggle only ever runs collapsed→expanded once per modal session, so
          no exit animation is needed: the collapsed card is simply unmounted
          the instant `expanded` flips, and the expanded card fades/slides in
          on its own entrance. */}
      {!expanded ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-expanded={false}
            aria-label="Show full profile"
            className="relative block h-24 w-full overflow-hidden rounded-xl text-left"
            style={{ backgroundColor: bannerBg }}
          >
            {nameplate?.webm_url ? (
              // Nameplates are subtle ambient loops and Discord plays them for
              // every viewer, so we intentionally don't gate them behind
              // `useReducedMotion` — that check made the collapsed card fall
              // back to a still frame for anyone with the OS preference on.
              <video
                autoPlay
                loop
                muted
                playsInline
                className="absolute inset-0 h-full w-full object-cover"
                poster={nameplate.static_url}
              >
                <source src={nameplate.webm_url} type="video/webm" />
              </video>
            ) : nameplate?.static_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={nameplate.static_url}
                alt=""
                referrerPolicy="no-referrer"
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : bannerImgUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={bannerImgUrl}
                alt=""
                referrerPolicy="no-referrer"
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : null}
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/10 to-transparent" />
            <div className="relative flex h-full items-center gap-3 px-4">
              <Avatar
                size={56}
                showImg={showAvatarImg}
                imgUrl={avatarUrl}
                onError={handleAvatarError}
                initial={initial}
                initialBg={initialBg}
                decorationUrl={decorationUrl}
                decorationScale={decorationDebug.scale}
                decorationNudge={decorationDebug.nudge}
                priority
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-white [text-shadow:_0_1px_3px_rgb(0_0_0_/_60%)]">
                  {user.global_name || user.username}
                </div>
                <div className="truncate text-xs text-white/80 [text-shadow:_0_1px_2px_rgb(0_0_0_/_60%)]">
                  @{user.username}
                </div>
              </div>
            </div>
          </button>
        ) : (
          <div className="profile-card-enter space-y-3">
            {/* Banner + avatar header — the whole card uses the profile
                accent/banner color so it mimics Discord's theme-tinted popup.
                Overflow-hidden lives on the banner sub-div only so the options
                dropdown can extend beyond the card without being clipped. */}
            <div
              className="relative rounded-xl"
              style={{ backgroundColor: bannerBg }}
            >
              <div className="relative h-24 w-full overflow-hidden rounded-t-xl">
                {bannerImgUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={bannerImgUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    // object-cover so the banner fills the width edge-to-edge
                    // like Discord's own profile popup. A small vertical crop
                    // is fine — banners are designed with that in mind.
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                )}
              </div>

              {/* pt-3 inside the row pushes avatar + name text down away from
                  the banner's edge, so the display name isn't sitting right
                  under it. items-end still keeps the avatar hanging out of
                  the banner like Discord's own popup. */}
              <div className="relative -mt-8 flex items-end gap-3 px-4 pb-4 pt-3">
                <div
                  className="relative rounded-full border-4"
                  style={{ borderColor: bannerBg }}
                >
                  <Avatar
                    size={64}
                    showImg={showAvatarImg}
                    imgUrl={avatarUrl}
                    onError={handleAvatarError}
                    initial={initial}
                    initialBg={initialBg}
                    decorationUrl={decorationUrl}
                    decorationScale={decorationDebug.scale}
                    decorationNudge={decorationDebug.nudge}
                    noBorder
                    priority
                  />
                  {presenceData && (
                    <StatusDot
                      status={presenceData.discord_status}
                      size={23.5}
                      ringColor={bannerBg}
                    />
                  )}
                  {customStatus && <CustomStatusBubble activity={customStatus} />}
                </div>

                <div className="min-w-0 flex-1 pb-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-bold text-white [text-shadow:_0_1px_2px_rgb(0_0_0_/_50%)]">
                      {user.global_name || user.username}
                    </span>
                    {primaryGuild && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/90 backdrop-blur-sm">
                        {primaryGuild.badge_url && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={primaryGuild.badge_url}
                            alt=""
                            referrerPolicy="no-referrer"
                            className="h-3 w-3"
                          />
                        )}
                        {primaryGuild.tag}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs text-white/70 [text-shadow:_0_1px_2px_rgb(0_0_0_/_50%)]">
                      @{user.username}
                    </span>
                    {user.badges && user.badges.length > 0 && (
                      <span className="flex shrink-0 items-center gap-1">
                        {user.badges.map((b) => (
                          <span key={b.name} className="tooltip-anchor inline-flex">
                            <span className="tooltip-bubble">{b.description}</span>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={b.icon_url}
                              alt={b.description}
                              referrerPolicy="no-referrer"
                              className="h-5 w-5 drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]"
                            />
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                </div>

                {/* Options menu (three dots) — matches Discord's guild-settings
                    ellipsis mark. Sits at the right edge of the header row and
                    reveals a single "Copy User ID" item, styled to match the
                    rest of the profile card. */}
                <div ref={menuRef} className="relative pb-1">
                  <button
                    type="button"
                    onClick={() => setMenuOpen((v) => !v)}
                    aria-label="More options"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-white/70 transition-colors hover:bg-white/15 hover:text-white [text-shadow:_0_1px_2px_rgb(0_0_0_/_50%)]"
                  >
                    <MoreHorizontal size={16} />
                  </button>
                  {menuOpen && (
                    <div
                      role="menu"
                      className="absolute right-0 top-full z-30 mt-1.5 min-w-[160px] overflow-hidden rounded-xl bg-bg-raised shadow-lg ring-1 ring-black/20"
                    >
                      <button
                        role="menuitem"
                        type="button"
                        onClick={copyUserId}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm text-fg transition-colors hover:bg-bg-subtle"
                      >
                        <span>Copy User ID</span>
                        {idCopied ? (
                          <Check size={13} className="text-accent" />
                        ) : (
                          <Copy size={13} className="text-fg-muted" />
                        )}
                      </button>
                    </div>
                  )}
                </div>

              </div>

              {/* Live presence (Lanyard) nested INSIDE the profile card so the
                  activity strip (Spotify / game) reads as part of the profile
                  header rather than a floating sibling. PresenceSlot wraps its
                  own padding and returns null when there's nothing to show, so
                  the card ends flush after the name row in that case. */}
              <PresenceSlot state={presence} />
            </div>

            {/* Copy username */}
            <button
              type="button"
              onClick={copyUsername}
              className="flex w-full items-center justify-between rounded-xl bg-bg-raised px-4 py-3 text-sm transition-colors duration-200 hover:bg-bg-subtle"
            >
              <span className="font-mono text-fg">@{user.username}</span>
              <span className="flex items-center gap-1.5 text-xs text-fg-muted">
                {copied ? (
                  <>
                    <Check size={13} className="text-accent" /> Copied
                  </>
                ) : (
                  <>
                    <Copy size={13} /> Copy
                  </>
                )}
              </span>
            </button>

            {/* Meta */}
            {user.creation_date && (
              <div className="text-center text-xs text-fg-muted">
                On Discord since {new Date(user.creation_date.replace(' ', 'T')).getFullYear()}
              </div>
            )}
          </div>
      )}
      {decorationDebug.enabled && (
        <DecorationDebugPanel
          scale={decorationDebug.scale}
          setScale={decorationDebug.setScale}
          nudge={decorationDebug.nudge}
          setNudge={decorationDebug.setNudge}
        />
      )}
    </div>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import { useReducedMotion } from 'framer-motion'
import { Loader2, X } from 'lucide-react'
import { Icon, type IconKey } from '@/lib/icons'
import { ZERX } from '@/lib/constants'
import Modal from '@/components/Modal'
import { subscribeLanyard } from '@/lib/lanyard'
import {
  avatarDecorationUrl,
  avatarUrl,
  badgeIconUrl,
  customStatusText,
  displayName,
  fetchDstnProfile,
  type DiscordStatus,
  type DstnProfile,
  type LanyardData,
  type LanyardSpotify,
} from '@/lib/discord'

// None of these 4 profile components are needed for the initial page
// render — `activeModal` below starts `null` and they only ever mount after
// a click, so bundling their ~3000+ combined lines of source (plus
// framer-motion usage, chart rendering, etc.) into the main page chunk for
// every visitor — even ones who never open a modal — was pure dead weight
// on first load. `next/dynamic(..., { ssr: false })` splits each into its
// own chunk that's fetched only when actually needed; `ssr: false` is free
// here since none of them were ever part of the server-rendered HTML to
// begin with (the conditional render below never executes on the server).
//
// The raw `import()` calls are kept as separate references (not just left
// inside `dynamic()`) so they can be invoked early — on hover/focus/touch of
// the trigger button, before the actual click — which starts the chunk
// fetch during the brief moment a user is moving their pointer toward the
// button instead of only after they've already clicked. Next/webpack dedupes
// this against the `dynamic()` call automatically: it's the same module,
// so the browser simply has it cached (or already in flight) by the time
// `dynamic()` asks for it.
const importDiscordProfile = () => import('@/components/DiscordProfile')
const importRobloxProfile = () => import('@/components/RobloxProfile')
const importTikTokProfile = () => import('@/components/TikTokProfile')
const importWalletProfile = () => import('@/components/WalletProfile')

function ModalLoadingFallback() {
  return (
    <div className="flex h-40 items-center justify-center">
      <Loader2 className="animate-spin text-fg-muted" size={20} />
    </div>
  )
}

const DiscordProfile = dynamic(importDiscordProfile, {
  ssr: false,
  loading: ModalLoadingFallback,
})
const RobloxProfile = dynamic(importRobloxProfile, {
  ssr: false,
  loading: ModalLoadingFallback,
})
const TikTokProfile = dynamic(importTikTokProfile, {
  ssr: false,
  loading: ModalLoadingFallback,
})
const WalletProfile = dynamic(importWalletProfile, {
  ssr: false,
  loading: ModalLoadingFallback,
})

const STATUS_LABEL: Record<DiscordStatus, string> = {
  online: 'Online',
  idle: 'Idle',
  dnd: 'Do not disturb',
  offline: 'Offline',
}

// Avatar is a 96px circle; the badge sits on its edge at a given angle
// (degrees, 0 = right, 90 = down — atan2 convention) with a radial offset
// from the rim and its own pixel size.
const AVATAR_SIZE = 96
const AVATAR_RADIUS = AVATAR_SIZE / 2
const STATUS_BADGE_CONFIG = { angleDeg: 47, radiusOffset: 0, size: 30 }

// Position + size dialed in via the drag/arrow-key/number-input positioner
// (same workflow as STATUS_BUBBLE_OFFSET below): the decoration-presets PNG
// is a square canvas drawn centered on the avatar, scaled up slightly and
// nudged a couple px so the wing art sits flush against the avatar's edge.
const DECORATION_SCALE = 1.278
const DECORATION_NUDGE = { x: -1, y: 4 }

const STATUS_BUBBLE_OFFSET = { x: 12, y: 13 }
const STATUS_BUBBLE_TAIL_OFFSET = { x: -34, y: -16 }

// Official Discord UI Kit status glyphs (20-unit viewBox) — the solid black
// shell doubles as the outline, so no extra ring is needed around it.
function StatusGlyph({ status, size }: { status: DiscordStatus; size: number }) {
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

// Live "now playing" row sourced from Lanyard's Spotify presence — real data,
// not decoration. The progress bar is a pure CSS keyframe (`spotify-progress`
// in globals.css) with a negative animation-delay equal to elapsed time, so
// it starts mid-track and advances at native refresh rate with no re-renders.
// Reduced-motion users get a static width driven by a 1s tick instead, since
// song position is real information and shouldn't just freeze at 0%.
function SpotifyRow({ spotify }: { spotify: LanyardSpotify }) {
  const shouldReduceMotion = useReducedMotion()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!shouldReduceMotion) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [shouldReduceMotion])

  const dur = Math.max(1, spotify.timestamps.end - spotify.timestamps.start)
  const staticPct = (Math.min(dur, Math.max(0, now - spotify.timestamps.start)) / dur) * 100

  const animatedStyle = useMemo<React.CSSProperties>(() => {
    const elapsed = Math.min(dur, Math.max(0, Date.now() - spotify.timestamps.start))
    return {
      width: '0%',
      animation: `spotify-progress ${dur}ms linear forwards`,
      animationDelay: `-${elapsed}ms`,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotify.timestamps.start])

  const barStyle: React.CSSProperties = shouldReduceMotion ? { width: `${staticPct}%` } : animatedStyle

  return (
    <div className="flex w-full items-center gap-3 rounded-xl bg-bg-raised p-3">
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

// Subscribes to the shared Lanyard poller (lib/lanyard.ts) instead of
// running its own fetch/interval — this is the always-on, page-level
// consumer, so it's what keeps the shared poll warm; DiscordProfile.tsx's
// own `useLanyard` subscribes to the same userId and gets the current value
// replayed instantly when the modal's profile card expands, with no second
// poller started for the same user.
function useLanyard(userId: string) {
  const [data, setData] = useState<LanyardData | null>(null)

  useEffect(() => {
    if (!userId) {
      setData(null)
      return
    }
    return subscribeLanyard(userId, (envelope) => {
      if (envelope.ok && envelope.data) setData(envelope.data as LanyardData)
    })
  }, [userId])

  return data
}

// Separate fetch from Lanyard — decorations/nameplates/badges only change
// when the user equips something new, so this polls far less aggressively
// than presence does. Pauses while the tab is hidden, same as every other
// poller in the app (useCachedPoll, lib/lanyard.ts) — a backgrounded tab
// shouldn't keep hitting dstn.to every 5 minutes forever.
function useDstnProfile(userId: string) {
  const [data, setData] = useState<DstnProfile | null>(null)

  useEffect(() => {
    if (!userId) return
    let alive = true
    const load = async () => {
      const result = await fetchDstnProfile(userId)
      if (alive && result) setData(result)
    }
    let intervalId: ReturnType<typeof setInterval> | null = null
    const start = () => {
      if (intervalId != null) return
      void load()
      intervalId = setInterval(load, 5 * 60_000)
    }
    const stop = () => {
      if (intervalId != null) {
        clearInterval(intervalId)
        intervalId = null
      }
    }
    const onVis = () => {
      if (document.hidden) stop()
      else start()
    }
    start()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      alive = false
      stop()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [userId])

  return data
}

type ActiveModal = 'discord' | 'roblox' | 'tiktok' | 'wallet' | null

export default function BioLink() {
  const lanyard = useLanyard(ZERX.discordId)
  const dstn = useDstnProfile(ZERX.discordId)
  const [avatarOk, setAvatarOk] = useState(true)
  const [activeModal, setActiveModal] = useState<ActiveModal>(null)
  const [pendingExternalUrl, setPendingExternalUrl] = useState<string | null>(null)
  const status = lanyard?.discord_status ?? 'offline'
  const name = lanyard ? displayName(lanyard.discord_user) : null
  const avatar = lanyard ? avatarUrl(lanyard.discord_user) : null
  const statusText = lanyard ? customStatusText(lanyard) : null
  const hasSpotify = !!(lanyard?.listening_to_spotify && lanyard.spotify)

  const badgeAngleRad = (STATUS_BADGE_CONFIG.angleDeg * Math.PI) / 180
  const badgeOrbitRadius = AVATAR_RADIUS + STATUS_BADGE_CONFIG.radiusOffset
  const badgeCenterX = AVATAR_RADIUS + badgeOrbitRadius * Math.cos(badgeAngleRad)
  const badgeCenterY = AVATAR_RADIUS + badgeOrbitRadius * Math.sin(badgeAngleRad)

  const decorationSize = AVATAR_SIZE * DECORATION_SCALE
  const decorationOffset = (decorationSize - AVATAR_SIZE) / 2

  // The Nitro tenure badge (id "premium_tenure_*") is shown in the Discord
  // modal instead (see DiscordProfile.tsx / app/api/discord/route.ts), which
  // pulls the same real tenure badge from dstn — keeping it off the bio-page
  // row avoids showing it twice.
  const bioBadges = dstn?.badges.filter((b) => !b.id.startsWith('premium_tenure')) ?? []

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-6 px-6 bio-enter">
      <button
        type="button"
        onClick={() => setActiveModal('discord')}
        onMouseEnter={() => void importDiscordProfile()}
        onFocus={() => void importDiscordProfile()}
        onTouchStart={() => void importDiscordProfile()}
        aria-label="View Discord profile"
        className="flex flex-col items-center gap-6 rounded-3xl transition-opacity duration-200 hover:opacity-90"
      >
        <div className="relative shrink-0" style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}>
          {statusText && (
            <div
              className="absolute -top-10 left-24 z-10 max-w-[170px]"
              style={{ transform: `translate(${STATUS_BUBBLE_OFFSET.x}px, ${STATUS_BUBBLE_OFFSET.y}px)` }}
            >
              <div className="rounded-2xl bg-bg-raised px-3 py-1.5 shadow-lg ring-1 ring-white/5">
                <span className="truncate text-xs font-medium text-fg">{statusText}</span>
              </div>
              <div
                className="relative"
                style={{
                  transform: `translate(${STATUS_BUBBLE_TAIL_OFFSET.x}px, ${STATUS_BUBBLE_TAIL_OFFSET.y}px)`,
                }}
              >
                <span
                  className="absolute -bottom-[14px] left-5 block h-2.5 w-2.5 rounded-full bg-bg-raised ring-1 ring-white/5"
                  aria-hidden="true"
                />
                <span
                  className="absolute -bottom-[22px] left-3 block h-1.5 w-1.5 rounded-full bg-bg-raised ring-1 ring-white/5"
                  aria-hidden="true"
                />
              </div>
            </div>
          )}
          {avatar && avatarOk ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatar}
              alt=""
              referrerPolicy="no-referrer"
              onError={() => setAvatarOk(false)}
              fetchPriority="high"
              decoding="async"
              className="relative block h-24 w-24 rounded-full bg-bg-raised object-cover"
            />
          ) : name ? (
            <div
              className="relative flex h-24 w-24 items-center justify-center rounded-full bg-bg-raised font-body text-3xl font-medium text-fg"
              aria-hidden="true"
            >
              {name.charAt(0).toUpperCase()}
            </div>
          ) : (
            <div
              className="relative h-24 w-24 animate-pulse rounded-full bg-bg-raised"
              aria-hidden="true"
            />
          )}
          {dstn?.avatarDecoration && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarDecorationUrl(dstn.avatarDecoration)}
              alt=""
              aria-hidden="true"
              referrerPolicy="no-referrer"
              draggable={false}
              className="pointer-events-none absolute select-none"
              style={{
                width: decorationSize,
                height: decorationSize,
                left: -decorationOffset + DECORATION_NUDGE.x,
                top: -decorationOffset + DECORATION_NUDGE.y,
                // Tailwind's preflight ships `img { max-width: 100%; height:
                // auto }` to make images responsive by default. For an
                // absolutely-positioned element, that 100% resolves against
                // the nearest positioned ancestor — our 96px avatar wrapper —
                // so it silently caps this image's width at 96px no matter
                // what's set above, while height grows uncapped. maxWidth:
                // 'none' opts this image out of that rule so width and height
                // always scale together.
                maxWidth: 'none',
                objectFit: 'contain',
              }}
            />
          )}
          {/* Tooltip anchor lives on an inner wrapper, not this span, since its
              `position: relative` would otherwise clobber this span's
              `absolute` placement (same specificity, later in the cascade). */}
          <span
            role="img"
            aria-label={STATUS_LABEL[status]}
            className="absolute block leading-none"
            style={{
              width: STATUS_BADGE_CONFIG.size,
              height: STATUS_BADGE_CONFIG.size,
              left: badgeCenterX - STATUS_BADGE_CONFIG.size / 2,
              top: badgeCenterY - STATUS_BADGE_CONFIG.size / 2,
            }}
          >
            <span className="tooltip-anchor block h-full w-full">
              <span className="tooltip-bubble">{STATUS_LABEL[status]}</span>
              <StatusGlyph status={status} size={STATUS_BADGE_CONFIG.size} />
            </span>
          </span>
        </div>

        <div className="flex flex-col items-center gap-1.5 text-center">
          {name ? (
            <h1 className="name-glow font-body text-2xl font-normal text-fg [text-shadow:0_0_4px_rgba(255,255,255,0),0_0_10px_rgba(255,255,255,0),0_0_22px_rgba(255,255,255,0),0_0_40px_rgba(255,255,255,0)] transition-[text-shadow] duration-300 ease-out hover:[text-shadow:0_0_4px_rgba(255,255,255,0.95),0_0_10px_rgba(255,255,255,0.7),0_0_22px_rgba(255,255,255,0.45),0_0_40px_rgba(255,255,255,0.22)]">
              {name}
            </h1>
          ) : (
            <div className="h-7 w-24 animate-pulse rounded-md bg-white/10" aria-hidden="true" />
          )}
          {lanyard ? (
            <p className="max-w-xs truncate text-sm text-fg-muted">
              @{lanyard.discord_user.username}
            </p>
          ) : (
            <div className="h-5 w-28 animate-pulse rounded-md bg-white/10" aria-hidden="true" />
          )}
          {!!bioBadges.length && (
            <div className="mt-1 flex items-center gap-1.5">
              {bioBadges.map((badge) => (
                <span key={badge.id} className="tooltip-anchor inline-flex">
                  <span className="tooltip-bubble">{badge.description}</span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={badgeIconUrl(badge.icon)}
                    alt={badge.description}
                    referrerPolicy="no-referrer"
                    className="h-5 w-5"
                  />
                </span>
              ))}
            </div>
          )}
        </div>
      </button>

      <div className="flex w-full items-center justify-center gap-3">
        <SocialLink
          iconKey="telegram"
          label="Telegram"
          url={ZERX.socials.telegram}
          onRequestOpen={setPendingExternalUrl}
        />
        <SocialButton
          iconKey="roblox"
          label="Roblox profile"
          onClick={() => setActiveModal('roblox')}
          onPreload={importRobloxProfile}
        />
        <SocialButton
          iconKey="tiktok"
          label="TikTok profile"
          onClick={() => setActiveModal('tiktok')}
          onPreload={importTikTokProfile}
        />
      </div>

      {/* Wallet deliberately isn't a fourth icon-circle in the row above —
          pulled out into its own quiet text link instead. Still gets the
          same hover/preload treatment as the buttons above, just without the
          circular bg/border chrome (or an icon at all now), so it reads as a
          minor secondary action rather than competing for attention with
          Telegram/Roblox/TikTok. */}
      <button
        type="button"
        onClick={() => setActiveModal('wallet')}
        onMouseEnter={() => void importWalletProfile()}
        onFocus={() => void importWalletProfile()}
        onTouchStart={() => void importWalletProfile()}
        aria-label="Wallet portfolio"
        className="-mt-3 rounded-full px-2 py-1 text-[11px] text-fg-faint transition-colors duration-200 hover:text-fg-muted"
      >
        Portfolio
      </button>

      {hasSpotify && lanyard?.spotify && <SpotifyRow spotify={lanyard.spotify} />}

      {activeModal === 'discord' && (
        <Modal title="Discord" onClose={() => setActiveModal(null)}>
          <DiscordProfile userId={ZERX.discordId} />
        </Modal>
      )}
      {activeModal === 'roblox' && (
        <Modal title="Roblox" onClose={() => setActiveModal(null)}>
          <RobloxProfile userId={ZERX.robloxId} />
        </Modal>
      )}
      {activeModal === 'tiktok' && (
        <Modal title="TikTok" onClose={() => setActiveModal(null)} hideTitle>
          <TikTokProfile username={ZERX.tiktokUsername} />
        </Modal>
      )}
      {activeModal === 'wallet' && (
        <Modal title="Wallet" onClose={() => setActiveModal(null)}>
          <WalletProfile />
        </Modal>
      )}

      {pendingExternalUrl && (
        <ExternalRedirectToast
          url={pendingExternalUrl}
          onClose={() => setPendingExternalUrl(null)}
        />
      )}
    </div>
  )
}

const SOCIAL_ICON_CLASS =
  'flex h-12 w-12 items-center justify-center rounded-full bg-bg-raised transition-colors duration-200 hover:bg-bg-subtle'

function SocialLink({
  iconKey,
  label,
  url,
  onRequestOpen,
}: {
  iconKey: IconKey
  label: string
  url: string
  // Intercepting navigation for a confirmation countdown (see
  // ExternalRedirectToast below) instead of letting the <a> tag navigate
  // straight away — the href/target/rel stay in place so hover preview,
  // right-click "copy link", and modifier/middle-click "open in background
  // tab" all keep working exactly like a normal link; only a plain left
  // click is caught and redirected into the confirmation flow.
  onRequestOpen: (url: string) => void
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className={SOCIAL_ICON_CLASS}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        onRequestOpen(url)
      }}
    >
      <Icon name={iconKey} width={18} height={18} className="text-fg" />
    </a>
  )
}

// Countdown length deliberately lands in the 3-5s window: long enough to
// register as a real confirmation (not a flash the user can't read), short
// enough that anyone who does want to continue isn't stuck waiting. "Go
// now" below skips the wait entirely for that second group.
const EXTERNAL_REDIRECT_SECONDS = 4

// Shown before navigating to Telegram (the one genuinely external, non-modal
// link in this app — the Roblox/TikTok/Wallet buttons open an in-page modal,
// not a new destination, so they don't go through this). A corner toast
// rather than a full Modal on purpose: leaving the site is a minor, non-
// blocking event — it shouldn't dim/blur the whole page or demand a
// decision like the profile modals do. Deliberately a single compact row:
// no icon badge, no separate footer button — the seconds count doubles as
// the "go now" control (click it to skip the wait) and the ✕ dismisses
// without navigating. It auto-opens the target in a new tab (matching the
// `<a target="_blank">` it intercepted) once the countdown reaches 0.
// Portaled to document.body for the same reason Modal.tsx is: so it's never
// clipped or re-stacked by an ancestor's overflow/transform.
function ExternalRedirectToast({ url, onClose }: { url: string; onClose: () => void }) {
  const [secondsLeft, setSecondsLeft] = useState(EXTERNAL_REDIRECT_SECONDS)
  // Same enter/exit-via-animationend pattern as Modal.tsx: flips a flag to
  // play the exit keyframe, the real unmount only happens once that
  // animation has actually finished, so dismissal always looks intentional
  // instead of the toast just vanishing mid-frame.
  const [closing, setClosing] = useState(false)
  const requestClose = () => setClosing(true)

  const hostname = useMemo(() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '')
    } catch {
      return url
    }
  }, [url])

  const go = useCallback(() => {
    window.open(url, '_blank', 'noopener,noreferrer')
    requestClose()
  }, [url])

  useEffect(() => {
    if (closing) return
    if (secondsLeft <= 0) {
      go()
      return
    }
    const id = setTimeout(() => setSecondsLeft((s) => s - 1), 1000)
    return () => clearTimeout(id)
  }, [secondsLeft, closing, go])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      onAnimationEnd={(e) => {
        if (closing && e.target === e.currentTarget) onClose()
      }}
      className={`fixed right-4 top-4 z-[70] w-[calc(100vw-2rem)] max-w-[260px] overflow-hidden rounded-xl border border-line bg-bg-card shadow-xl sm:right-6 sm:top-6 ${
        closing ? 'toast-exit' : 'toast-enter'
      }`}
    >
      <div className="flex items-center gap-2 py-2.5 pl-3.5 pr-2">
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg-muted">
          Opening <span className="text-fg">{hostname}</span>
        </span>
        <button
          type="button"
          onClick={go}
          aria-label="Open now"
          className="shrink-0 rounded-md px-1.5 py-0.5 text-[12px] font-medium tabular-nums text-fg-muted transition-colors hover:bg-bg-raised hover:text-fg"
        >
          {secondsLeft}s
        </button>
        <button
          type="button"
          onClick={requestClose}
          aria-label="Cancel"
          className="-mr-0.5 shrink-0 rounded-md p-1 text-fg-faint transition-colors hover:bg-bg-raised hover:text-fg"
        >
          <X size={13} />
        </button>
      </div>
      <div className="h-[2px] w-full bg-white/5">
        {/* Left running even while `closing` plays out the exit animation
            (a few hundred ms at most) — freezing it there via `animation:
            none` would snap the bar's width back to the unanimated CSS
            default for that brief window, a more visible glitch than just
            letting it finish naturally. */}
        <div
          className="h-full bg-fg/40"
          style={{
            animation: `external-redirect-progress ${EXTERNAL_REDIRECT_SECONDS}s linear forwards`,
          }}
        />
      </div>
    </div>,
    document.body,
  )
}

function SocialButton({
  iconKey,
  label,
  onClick,
  onPreload,
}: {
  iconKey: IconKey
  label: string
  onClick: () => void
  // Fires the modal component's raw `import()` ahead of the actual click —
  // on hover/focus/touchstart — so the chunk is already downloading/cached
  // by the time the click handler above actually needs it.
  onPreload?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onPreload}
      onFocus={onPreload}
      onTouchStart={onPreload}
      aria-label={label}
      className={SOCIAL_ICON_CLASS}
    >
      <Icon name={iconKey} width={18} height={18} className="text-fg" />
    </button>
  )
}

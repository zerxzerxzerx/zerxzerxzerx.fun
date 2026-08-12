'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { AnimatePresence, m, useReducedMotion } from 'framer-motion'
import { User, Layers } from 'lucide-react'
import { SiRoblox } from '@icons-pack/react-simple-icons'
import { Icon, type IconKey } from '@/lib/icons'
import { ZERX, CAPABILITIES } from '@/lib/constants'
import Modal from './Modal'

// Heavy modal bodies are pulled out of the initial page bundle and loaded on
// first modal open. The idle prefetch inside BioLink (below) warms both the
// JS chunk and the underlying /api response so the first open still feels
// instant — the network cost is just paid during idle instead of on click.
const DiscordProfile = dynamic(() => import('./DiscordProfile'), { ssr: false })
const GitHubProfile = dynamic(() => import('./GitHubProfile'), { ssr: false })
const TikTokProfile = dynamic(() => import('./TikTokProfile'), { ssr: false })
const PengiNetworth = dynamic(() => import('./PengiNetworth'), { ssr: false })
const RobloxProfile = dynamic(() => import('./RobloxProfile'), { ssr: false })

type ModalKey =
  | 'about'
  | 'services'
  | 'discord'
  | 'github'
  | 'tiktok'
  | 'pengi'
  | 'roblox'
  | null

const EASE = [0.25, 0.46, 0.45, 0.94] as const

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.07, delayChildren: 0.1 },
  },
}

const item = {
  hidden: { opacity: 0, y: 14 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: EASE },
  },
}

// Reduced-motion variants — same shape but no translate + no stagger. Users
// still get a subtle fade-in so the page doesn't feel bare on load.
const containerReduced = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.2 } },
}
const itemReduced = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.2 } },
}

export default function BioLink() {
  const [modal, setModal] = useState<ModalKey>(null)
  const [pengiTip, setPengiTip] = useState(false)
  const shouldReduce = useReducedMotion()
  const containerVariants = shouldReduce ? containerReduced : container
  const itemVariants = shouldReduce ? itemReduced : item

  // Once the page is idle, warm the modal chunks + their /api responses in
  // the background. That way the first click on any tile skips both the
  // dynamic-import round trip and the upstream API fetch — modals open with
  // data already in cache instead of showing a loading spinner.
  useEffect(() => {
    const prefetch = () => {
      void import('./DiscordProfile')
      void import('./GitHubProfile')
      void import('./TikTokProfile')
      void import('./PengiNetworth')
      void import('./RobloxProfile')
      void fetch(`/api/discord?id=${ZERX.discordId}`).catch(() => {})
      void fetch(
        `/api/github?username=${encodeURIComponent(ZERX.githubUsername)}`,
      ).catch(() => {})
      void fetch(
        `/api/tiktok?username=${encodeURIComponent(ZERX.tiktokUsername)}`,
      ).catch(() => {})
      void fetch('/api/networth').catch(() => {})
      void fetch(
        `/api/roblox?username=${encodeURIComponent(ZERX.robloxUsername)}`,
      ).catch(() => {})
    }
    type IdleCb = (cb: IdleRequestCallback, opts?: IdleRequestOptions) => number
    type CancelIdleCb = (id: number) => void
    const w = window as typeof window & {
      requestIdleCallback?: IdleCb
      cancelIdleCallback?: CancelIdleCb
    }
    if (w.requestIdleCallback && w.cancelIdleCallback) {
      const id = w.requestIdleCallback(prefetch, { timeout: 2500 })
      return () => w.cancelIdleCallback!(id)
    }
    // Safari < 16.4 has no requestIdleCallback. Short setTimeout keeps us out
    // of the LCP window without punishing older browsers with worse UX.
    const id = window.setTimeout(prefetch, 1200)
    return () => window.clearTimeout(id)
  }, [])

  return (
    <>
      <m.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="mx-auto flex w-full max-w-sm flex-col items-center gap-7 px-6"
      >
        <m.div
          variants={itemVariants}
          className="mb-3 flex flex-col items-center gap-2 text-center"
        >
          <h1
            className="bg-gradient-to-b from-white to-white/60 bg-clip-text font-display text-3xl font-extrabold tracking-tight text-transparent transition-[text-shadow] duration-300 ease-out hover:[text-shadow:0_0_4px_rgba(255,255,255,0.95),0_0_10px_rgba(255,255,255,0.7),0_0_22px_rgba(255,255,255,0.45),0_0_40px_rgba(255,255,255,0.22)]"
            style={{ WebkitTextStroke: '0.2px rgba(255,255,255,0.15)' }}
          >
            zerx
          </h1>
          <p className="max-w-xs text-sm leading-relaxed text-fg-muted">
            {ZERX.headline}
          </p>
        </m.div>

        <m.div variants={itemVariants} className="w-full">
          <a
            href={ZERX.socials.telegram}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Telegram"
            className="flex w-full items-center justify-center rounded-2xl bg-bg-raised px-5 py-4 transition-colors duration-200 hover:bg-bg-subtle"
          >
            <Icon name="telegram" width={18} height={18} className="text-fg" />
          </a>
        </m.div>

        <m.div variants={itemVariants} className="grid w-full grid-cols-3 gap-3">
          <SocialTile iconKey="tiktok" label="TikTok" onClick={() => setModal('tiktok')} />
          <SocialTile iconKey="github" label="GitHub" onClick={() => setModal('github')} />
          <SocialTile iconKey="discord" label="Discord" onClick={() => setModal('discord')} />
        </m.div>

        <m.div variants={itemVariants} className="grid w-full grid-cols-2 gap-3">
          <InfoTile
            icon={<User size={16} />}
            label="About"
            onClick={() => setModal('about')}
          />
          <InfoTile
            icon={<Layers size={16} />}
            label="Services"
            onClick={() => setModal('services')}
          />
        </m.div>

        {/* Roblox tile — sits right above the pengi button, matches its
            full-width rounded-2xl silhouette so the two vanity tiles visually
            pair as a set. Rendered before pengi so the pengi button stays
            the last item in the tab order (nice thumb-reach on mobile). */}
        <m.div variants={itemVariants} className="w-full">
          <button
            type="button"
            onClick={() => setModal('roblox')}
            aria-label="Roblox"
            className="flex w-full items-center justify-center rounded-2xl bg-bg-raised px-5 py-4 transition-colors duration-200 hover:bg-bg-subtle"
          >
            <SiRoblox
              width={22}
              height={22}
              aria-hidden="true"
              focusable="false"
              className="text-fg"
            />
          </button>
        </m.div>

        <m.div variants={itemVariants} className="relative w-full">
          <button
            type="button"
            onClick={() => setModal('pengi')}
            onMouseEnter={() => setPengiTip(true)}
            onMouseLeave={() => setPengiTip(false)}
            onFocus={() => setPengiTip(true)}
            onBlur={() => setPengiTip(false)}
            aria-label="pengi"
            className="flex w-full items-center justify-center rounded-2xl bg-bg-raised px-5 py-4 transition-colors duration-200 hover:bg-bg-subtle"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/pengi.webp"
              alt=""
              aria-hidden="true"
              width={32}
              height={32}
              // Only real image on first paint. `fetchPriority=high` bumps it
              // ahead of the deferred modal JS chunks; `decoding=async` lets
              // the browser paint surrounding UI without blocking on decode;
              // explicit width/height prevents layout shift while the img
              // stream lands. Paired with the <link rel=preload> in the head
              // so the fetch kicks off during HTML parse.
              fetchPriority="high"
              decoding="async"
              className="h-8 w-8 shrink-0 rounded-full object-cover"
            />
          </button>
          <AnimatePresence>
            {pengiTip && (
              <m.div
                role="tooltip"
                initial={{ opacity: 0, x: '-50%' }}
                animate={{ opacity: 1, x: '-50%' }}
                exit={{ opacity: 0, x: '-50%' }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 whitespace-nowrap rounded-lg bg-bg-subtle px-2.5 py-1 text-xs font-medium text-fg shadow-lg ring-1 ring-white/5"
              >
                pengi
                <span
                  aria-hidden="true"
                  className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 rounded-[2px] bg-bg-subtle"
                />
              </m.div>
            )}
          </AnimatePresence>
        </m.div>
      </m.div>

      <AnimatePresence>
        {modal === 'about' && (
          <Modal title="About" onClose={() => setModal(null)}>
            <div className="space-y-4">
              {ZERX.bio.map((p) => (
                <p key={p} className="text-sm leading-relaxed text-fg-muted">
                  {p}
                </p>
              ))}
            </div>
          </Modal>
        )}
        {modal === 'discord' && (
          <Modal title="Discord" onClose={() => setModal(null)}>
            <DiscordProfile userId={ZERX.discordId} />
          </Modal>
        )}
        {modal === 'github' && (
          <Modal title="GitHub" onClose={() => setModal(null)}>
            <GitHubProfile
              username={ZERX.githubUsername}
              privateRepos={ZERX.githubPrivateRepos}
            />
          </Modal>
        )}
        {modal === 'tiktok' && (
          <Modal title="TikTok" onClose={() => setModal(null)}>
            <TikTokProfile username={ZERX.tiktokUsername} />
          </Modal>
        )}
        {modal === 'pengi' && (
          <Modal title="pengi" onClose={() => setModal(null)}>
            <PengiNetworth />
          </Modal>
        )}
        {modal === 'roblox' && (
          <Modal title="Roblox" onClose={() => setModal(null)}>
            <RobloxProfile username={ZERX.robloxUsername} />
          </Modal>
        )}
        {modal === 'services' && (
          <Modal title="Services" onClose={() => setModal(null)}>
            <div className="space-y-5">
              {CAPABILITIES.map((c) => (
                <div key={c.title} className="flex gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-bg-raised text-fg">
                    <Icon name={c.iconKey} width={15} height={15} />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-fg">{c.title}</div>
                    <div className="mt-1 text-xs leading-relaxed text-fg-muted">
                      {c.body}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </>
  )
}

function SocialTile({
  iconKey,
  label,
  url,
  onClick,
}: {
  iconKey: IconKey
  label: string
  url?: string
  onClick?: () => void
}) {
  const baseCls =
    'flex h-14 items-center justify-center rounded-xl bg-bg-raised transition-colors duration-200 hover:bg-bg-subtle'
  const icon = (
    <Icon name={iconKey} width={18} height={18} className="text-fg" />
  )

  if (onClick) {
    return (
      <button type="button" aria-label={label} onClick={onClick} className={baseCls}>
        {icon}
      </button>
    )
  }
  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={label}
        className={baseCls}
      >
        {icon}
      </a>
    )
  }
  return (
    <div aria-label={label} className={`${baseCls} cursor-default opacity-40 hover:bg-bg-raised`}>
      {icon}
    </div>
  )
}

function InfoTile({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-center gap-2 rounded-xl bg-bg-raised px-4 py-4 text-sm font-medium text-fg transition-colors duration-200 hover:bg-bg-subtle"
    >
      <span className="text-fg-muted">{icon}</span>
      <span>{label}</span>
    </button>
  )
}

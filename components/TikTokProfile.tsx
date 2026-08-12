'use client'

import { useCallback, useEffect, useState } from 'react'
import { m } from 'framer-motion'
import { BadgeCheck, Check, Copy, Loader2, Lock } from 'lucide-react'
import { useCachedPoll } from '@/lib/useCachedPoll'

type TikTokUser = {
  unique_id: string
  nickname: string | null
  bio: string | null
  avatar_url: string | null
  verified: boolean
  private_account: boolean
  region: string | null
  profile_url: string
  stats: {
    followers: number
    following: number
    likes: number
    videos: number
    followers_label: string
    following_label: string
    likes_label: string
    videos_label: string
  }
  created_at: string | null
  fetched_at?: string
}

type ApiResponse = {
  success?: boolean
  data?: TikTokUser
  error?: string
  message?: string
}

// Same background poll cadence as the GitHub modal — the API route caches
// upstream data for 10 min, so this just keeps the UI in sync with the
// server's cache when the modal is left open past a refresh cycle.
const POLL_MS = 5 * 60 * 1000

const FALLBACK_PALETTE = ['#FE2C55', '#25F4EE', '#F1F1F2', '#EB459E', '#57F287']
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
}: {
  size: number
  showImg: boolean
  imgUrl?: string | null
  onError: () => void
  initial: string
  initialBg: string
}) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {showImg && imgUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imgUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={onError}
          className="rounded-full border-2 border-black/40 bg-bg-raised object-cover"
          style={{ width: size, height: size }}
        />
      ) : (
        <div
          className="flex items-center justify-center rounded-full border-2 border-black/40 font-display font-semibold text-white"
          style={{ width: size, height: size, backgroundColor: initialBg, fontSize: size * 0.42 }}
          aria-hidden="true"
        >
          {initial}
        </div>
      )}
    </div>
  )
}

export default function TikTokProfile({ username }: { username: string }) {
  const [copied, setCopied] = useState(false)
  const [avatarBroken, setAvatarBroken] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const fetcher = useCallback(async () => {
    const r = await fetch(`/api/tiktok?username=${encodeURIComponent(username)}`)
    const j = (await r.json()) as ApiResponse
    if (!r.ok || !j.data) throw new Error(j.message || 'Failed to load profile')
    return j.data
  }, [username])

  const { data: user, error } = useCachedPoll<TikTokUser>({
    cacheKey: `zerxbio:tt:${username}`,
    pollMs: POLL_MS,
    resetKey: username,
    fetcher,
  })

  useEffect(() => {
    setAvatarBroken(false)
    setExpanded(false)
  }, [username])

  const copyUsername = async () => {
    if (!user) return
    try {
      await navigator.clipboard.writeText(user.unique_id)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked, no-op */
    }
  }

  if (error && !user) {
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

  const displayName = user.nickname || user.unique_id
  const initial = displayName.charAt(0).toUpperCase()
  const initialBg = fallbackColor(user.unique_id)
  const showAvatarImg = !!user.avatar_url && !avatarBroken
  const handleAvatarError = () => setAvatarBroken(true)
  const joinedYear = user.created_at ? new Date(user.created_at).getFullYear() : null

  return (
    <div className="space-y-3">
      {!expanded ? (
        <m.button
          key="collapsed"
          type="button"
          onClick={() => setExpanded(true)}
          aria-expanded={false}
          aria-label="Show full profile"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="relative block h-24 w-full overflow-hidden rounded-xl bg-bg-raised text-left"
        >
          <div className="relative flex h-full items-center gap-3 px-4">
            <Avatar
              size={56}
              showImg={showAvatarImg}
              imgUrl={user.avatar_url}
              onError={handleAvatarError}
              initial={initial}
              initialBg={initialBg}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-bold text-fg">{displayName}</span>
                {user.verified && (
                  <BadgeCheck size={14} className="shrink-0 text-accent" aria-label="Verified" />
                )}
              </div>
              <div className="truncate text-xs text-fg-muted">@{user.unique_id}</div>
            </div>
          </div>
        </m.button>
      ) : (
        <m.div
          key="expanded"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="space-y-3"
        >
          {/* Header — flat card, no banner (TikTok profiles don't have one). */}
          <div className="rounded-xl bg-bg-raised p-4">
            <div className="flex items-center gap-3">
              <Avatar
                size={64}
                showImg={showAvatarImg}
                imgUrl={user.avatar_url}
                onError={handleAvatarError}
                initial={initial}
                initialBg={initialBg}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-bold text-fg">{displayName}</span>
                  {user.verified && (
                    <BadgeCheck size={14} className="shrink-0 text-accent" aria-label="Verified" />
                  )}
                  {user.private_account && (
                    <Lock size={12} className="shrink-0 text-fg-muted" aria-label="Private" />
                  )}
                </div>
                <div className="truncate text-xs text-fg-muted">@{user.unique_id}</div>
              </div>
            </div>

            {user.bio && (
              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-fg-muted">
                {user.bio}
              </p>
            )}

            {/* Stats row — matches the layout used in the GitHub modal. */}
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-fg-muted">
              <div>
                <span className="font-mono text-sm font-semibold text-fg">
                  {user.stats.followers_label}
                </span>{' '}
                followers
              </div>
              <div>
                <span className="font-mono text-sm font-semibold text-fg">
                  {user.stats.following_label}
                </span>{' '}
                following
              </div>
              <div>
                <span className="font-mono text-sm font-semibold text-fg">
                  {user.stats.likes_label}
                </span>{' '}
                likes
              </div>
              {user.stats.videos > 0 && (
                <div>
                  <span className="font-mono text-sm font-semibold text-fg">
                    {user.stats.videos_label}
                  </span>{' '}
                  videos
                </div>
              )}
            </div>
          </div>

          {/* Copy username */}
          <button
            type="button"
            onClick={copyUsername}
            className="flex w-full items-center justify-between rounded-xl bg-bg-raised px-4 py-3 text-sm transition-colors duration-200 hover:bg-bg-subtle"
          >
            <span className="font-mono text-fg">@{user.unique_id}</span>
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

          {/* Open on TikTok */}
          <a
            href={user.profile_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center justify-center rounded-xl bg-bg-raised px-4 py-3 text-sm transition-colors duration-200 hover:bg-bg-subtle"
          >
            <span className="text-fg">Open on TikTok</span>
          </a>

          {/* Meta */}
          {joinedYear && (
            <div className="text-center text-xs text-fg-muted">On TikTok since {joinedYear}</div>
          )}
        </m.div>
      )}
    </div>
  )
}

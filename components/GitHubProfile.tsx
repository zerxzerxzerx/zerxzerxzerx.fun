'use client'

import { useCallback, useEffect, useState } from 'react'
import { m } from 'framer-motion'
import { ArrowUpRight, Check, Copy, Loader2, MapPin } from 'lucide-react'
import { useCachedPoll } from '@/lib/useCachedPoll'

type GitHubUser = {
  login: string
  name: string | null
  bio: string | null
  avatar_url: string
  profile_url: string
  blog: { url: string; display: string } | null
  location: string | null
  twitter_username: string | null
  company: string | null
  stats: {
    repos: number
    followers: number
    following: number
    contributions: number | null
    repos_label: string
    followers_label: string
    following_label: string
    contributions_label: string | null
  }
  created_at: string
  fetched_at?: string
}

// Client-side background poll interval. The API route already has its own
// 10-min server-side cache, so most polls return instantly from that cache;
// this just guarantees the UI reflects the latest cached snapshot when the
// modal is left open past a refresh cycle.
const POLL_MS = 5 * 60 * 1000

type ApiResponse = {
  success?: boolean
  data?: GitHubUser
  error?: string
  message?: string
}

// Same fallback palette pattern as DiscordProfile so a broken avatar still
// looks intentional rather than a grey blob.
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
}: {
  size: number
  showImg: boolean
  imgUrl?: string
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

export default function GitHubProfile({
  username,
  privateRepos,
}: {
  username: string
  privateRepos?: number
}) {
  const [copied, setCopied] = useState(false)
  const [avatarBroken, setAvatarBroken] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const fetcher = useCallback(async () => {
    const r = await fetch(`/api/github?username=${encodeURIComponent(username)}`)
    const j = (await r.json()) as ApiResponse
    if (!r.ok || !j.data) throw new Error(j.message || 'Failed to load profile')
    return j.data
  }, [username])

  const { data: user, error } = useCachedPoll<GitHubUser>({
    cacheKey: `zerxbio:gh:${username}`,
    pollMs: POLL_MS,
    resetKey: username,
    fetcher,
  })

  // Reset per-user UI bits when the target username changes.
  useEffect(() => {
    setAvatarBroken(false)
    setExpanded(false)
  }, [username])

  const copyUsername = async () => {
    if (!user) return
    try {
      await navigator.clipboard.writeText(user.login)
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

  const displayName = user.name || user.login
  const initial = displayName.charAt(0).toUpperCase()
  const initialBg = fallbackColor(user.login)
  const showAvatarImg = !avatarBroken
  const handleAvatarError = () => setAvatarBroken(true)
  const joinedYear = new Date(user.created_at).getFullYear()

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
              <div className="truncate text-sm font-bold text-fg">{displayName}</div>
              <div className="truncate text-xs text-fg-muted">@{user.login}</div>
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
          {/* Header — flat card since GitHub profiles have no banner. */}
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
                <div className="truncate text-sm font-bold text-fg">{displayName}</div>
                <div className="truncate text-xs text-fg-muted">@{user.login}</div>
              </div>
            </div>

            {user.bio && (
              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-fg-muted">
                {user.bio}
              </p>
            )}

            {/* Stats row */}
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-fg-muted">
              <div>
                <span className="font-mono text-sm font-semibold text-fg">
                  {user.stats.repos_label}
                </span>{' '}
                repos
              </div>
              {typeof privateRepos === 'number' && privateRepos > 0 && (
                <div>
                  <span className="font-mono text-sm font-semibold text-fg">{privateRepos}</span>{' '}
                  priv repos
                </div>
              )}
              {user.stats.contributions_label && (
                <div>
                  <span className="font-mono text-sm font-semibold text-fg">
                    {user.stats.contributions_label}
                  </span>{' '}
                  contribs/yr
                </div>
              )}
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
            </div>

            {(user.location || user.blog) && (
              <div className="mt-3 space-y-1.5 text-xs text-fg-muted">
                {user.location && (
                  <div className="flex items-center gap-1.5">
                    <MapPin size={12} />
                    <span className="truncate">{user.location}</span>
                  </div>
                )}
                {user.blog && (
                  <a
                    href={user.blog.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-fg-muted hover:text-fg"
                  >
                    <ArrowUpRight size={12} />
                    <span className="truncate">{user.blog.display}</span>
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Copy username */}
          <button
            type="button"
            onClick={copyUsername}
            className="flex w-full items-center justify-between rounded-xl bg-bg-raised px-4 py-3 text-sm transition-colors duration-200 hover:bg-bg-subtle"
          >
            <span className="font-mono text-fg">@{user.login}</span>
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

          {/* Open on GitHub */}
          <a
            href={user.profile_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center justify-center rounded-xl bg-bg-raised px-4 py-3 text-sm transition-colors duration-200 hover:bg-bg-subtle"
          >
            <span className="text-fg">Open on GitHub</span>
          </a>

          {/* Meta */}
          <div className="text-center text-xs text-fg-muted">On GitHub since {joinedYear}</div>
        </m.div>
      )}
    </div>
  )
}

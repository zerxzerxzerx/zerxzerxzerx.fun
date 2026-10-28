'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { useCachedPoll } from '@/lib/useCachedPoll'

type WalletAsset = {
  symbol: string
  name: string
  color: string
  balance: number
  priceUsd: number | null
  valueUsd: number | null
}

type WalletActivityItem = {
  id: string
  symbol: string
  amount: number
  direction: 'in' | 'out'
  timestamp: number
  status: 'confirmed'
  ref: string
}

type WalletPortfolio = {
  totalValueUsd: number | null
  assets: WalletAsset[]
  activity: WalletActivityItem[]
  updatedAt: number
  stale: boolean
  partial: boolean
  source: 'etherscan' | 'rpc' | 'mixed'
  addressPreview: string
}

type ApiResponse = {
  success?: boolean
  data?: WalletPortfolio
  error?: string
  message?: string
}

// Matches the API route's own s-maxage=15 — polling faster would just repeat
// the same cached server response, slower would let the modal visibly lag
// behind a refresh that already happened.
const POLL_MS = 20_000

// Real token marks, self-hosted under /public/tokens/ (same reasoning as
// the Rolimons badge SVGs in RobloxProfile.tsx: served from our own origin
// so no CSP `img-src` change is needed vs. hotlinking a third-party CDN,
// and it can't silently break if that CDN renames/removes the asset).
const TOKEN_LOGO: Record<string, string> = {
  USDT: '/tokens/usdt.svg',
  USDC: '/tokens/usdc.svg',
}

// Local count-up hook — RobloxProfile.tsx has one of these but it's
// module-private there, not exported from a shared lib, so it's duplicated
// here rather than reaching into that file's internals.
function useCountUp(target: number | null, durationMs = 700): number {
  const [value, setValue] = useState(0)
  const fromRef = useRef(0)

  useEffect(() => {
    if (target == null) return
    const from = fromRef.current
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(from + (target - from) * eased)
      if (t < 1) raf = requestAnimationFrame(tick)
      else fromRef.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, durationMs])

  return value
}

function formatUsd(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}

// Token amounts (Activity list + Assets balances). Fixed at 2dp — matching
// min/max fraction digits, same fix as formatUnitPrice below — instead of
// the old "up to 4dp, however many are non-zero" behavior that rendered
// arbitrary transfer amounts like 25.021134... as "25.0211".
function formatToken(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Per-unit price, e.g. "$1.00" — stablecoins hover right around $1 so 2dp
// usually suffices, but a depeg (or any future non-stable asset) would
// round away to the same "$1.00" at 2dp, which is exactly the kind of
// silently-wrong number this feature is required to avoid. 4dp below $1
// keeps that visible without cluttering the common at-peg case.
function formatUnitPrice(n: number): string {
  const digits = n < 1 ? 4 : 2
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function formatRelativeTime(unixSeconds: number): string {
  if (!unixSeconds) return 'recently'
  const diffMs = Date.now() - unixSeconds * 1000
  const mins = Math.round(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.round(days / 30)
  return `${months}mo ago`
}

// Real token logo (self-hosted SVG, see TOKEN_LOGO above), falling back to a
// flat (non-gradient, non-glowing) initial disc in the asset's brand color
// only if the asset ever has no entry there or the file somehow fails to
// load. No ring, no blur, no drop shadow: just the mark, the way an asset
// row icon reads in an actual wallet.
function TokenIcon({ symbol, color }: { symbol: string; color: string }) {
  const [failed, setFailed] = useState(false)
  const src = TOKEN_LOGO[symbol]

  if (!src || failed) {
    return (
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      >
        {symbol.slice(0, 1)}
      </div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={32}
      height={32}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      className="h-8 w-8 shrink-0 rounded-full"
    />
  )
}

// Matches the row-shape skeleton below so the loading state doesn't shift
// layout when real data lands (no spinner, no spot where the modal "jumps").
function WalletSkeleton() {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="h-2.5 w-20 animate-pulse rounded bg-white/5" />
        <div className="h-7 w-36 animate-pulse rounded bg-white/10" />
        <div className="h-2.5 w-24 animate-pulse rounded bg-white/5" />
      </div>
      <div className="border-t border-line-subtle">
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center gap-3 border-b border-line-subtle py-2.5">
            <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-white/10" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-20 animate-pulse rounded bg-white/10" />
              <div className="h-2.5 w-10 animate-pulse rounded bg-white/5" />
            </div>
            <div className="space-y-1.5 text-right">
              <div className="ml-auto h-3 w-16 animate-pulse rounded bg-white/10" />
              <div className="ml-auto h-2.5 w-12 animate-pulse rounded bg-white/5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function WalletProfile() {
  const fetcher = useCallback(async () => {
    // The route itself has a hard internal budget (see ROUTE_TIMEOUT_MS in
    // app/api/wallet/portfolio/route.ts) and always responds well within
    // this, but a client-side ceiling means a bad network hop can never
    // leave this stuck on the loading state forever either.
    const r = await fetch('/api/wallet/portfolio', { signal: AbortSignal.timeout(12_000) })
    const j = (await r.json()) as ApiResponse
    if (!r.ok || !j.data) throw new Error(j.message || 'Failed to load wallet data')
    return j.data
  }, [])

  const { data: portfolio, error } = useCachedPoll<WalletPortfolio>({
    cacheKey: 'zerxbio:wallet:portfolio',
    cacheTtlMs: 60_000,
    pollMs: POLL_MS,
    resetKey: 'wallet',
    fetcher,
  })

  const total = useCountUp(portfolio?.totalValueUsd ?? null)

  // Biggest position first — matches how every real wallet orders a holdings
  // list. Falls back to a stable no-op order while the pre-sorted config
  // order happens to already match (both assets priced) so this never jitters
  // the list between polls once values are in.
  const sortedAssets = useMemo(() => {
    if (!portfolio) return []
    return [...portfolio.assets].sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1))
  }, [portfolio])

  if (error && !portfolio) {
    return <div className="py-8 text-center text-[13px] text-fg-muted">{error}</div>
  }

  if (!portfolio) return <WalletSkeleton />

  return (
    <div className="space-y-4">
      {/* Balance ------------------------------------------------------- */}
      <div>
        <span className="text-[11px] font-medium uppercase tracking-wide text-fg-faint">
          Portfolio value
        </span>
        <div className="mt-1 font-mono text-[28px] font-semibold leading-none tracking-tight text-fg tabular-nums">
          {portfolio.totalValueUsd != null ? formatUsd(total) : <span className="text-fg-muted">—</span>}
        </div>
        {/* Truncated address only — the server never sends the other 34
            characters (see lib/wallet/portfolio.ts), so there's nothing
            further to redact client-side. */}
        <div className="mt-1.5 font-mono text-[11px] text-fg-faint/70">{portfolio.addressPreview}</div>
        {/* Only ever shown when something's actually degraded — a stale
            cache serve or incomplete pricing — not as a permanent status
            badge. Silence in the common case, a plain note when it matters. */}
        {portfolio.stale ? (
          <div className="mt-1 text-[11px] text-fg-faint">Showing last known balance</div>
        ) : portfolio.partial ? (
          <div className="mt-1 text-[11px] text-fg-faint">Partial balance data</div>
        ) : null}
      </div>

      {/* Assets ---------------------------------------------------------*/}
      <div>
        <div className="mb-0.5 text-[11px] font-medium uppercase tracking-wide text-fg-faint">
          Assets
        </div>
        <div className="border-t border-line-subtle">
          {sortedAssets.map((asset) => (
            <div
              key={asset.symbol}
              className="flex items-center gap-3 border-b border-line-subtle py-2"
            >
              <TokenIcon symbol={asset.symbol} color={asset.color} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-fg">{asset.name}</div>
                <div className="text-[11px] text-fg-faint">
                  {asset.symbol}
                  {asset.priceUsd != null && <span> · {formatUnitPrice(asset.priceUsd)}</span>}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-mono text-[13px] font-medium tabular-nums text-fg">
                  {asset.valueUsd != null ? formatUsd(asset.valueUsd) : '—'}
                </div>
                <div className="font-mono text-[11px] tabular-nums text-fg-faint">
                  {formatToken(asset.balance)} {asset.symbol}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Activity ---------------------------------------------------------*/}
      <div>
        <div className="mb-0.5 text-[11px] font-medium uppercase tracking-wide text-fg-faint">
          Activity
        </div>
        {portfolio.activity.length === 0 ? (
          <div className="border-t border-line-subtle py-4 text-center text-[12px] text-fg-faint">
            No recent activity
          </div>
        ) : (
          <div className="max-h-56 overflow-y-auto border-t border-line-subtle">
            {portfolio.activity.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 border-b border-line-subtle py-2"
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-bg-raised ${
                    item.direction === 'in' ? 'text-emerald-500/80' : 'text-fg-muted'
                  }`}
                >
                  {item.direction === 'in' ? (
                    <ArrowDownLeft size={13} strokeWidth={2} />
                  ) : (
                    <ArrowUpRight size={13} strokeWidth={2} />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-fg">
                    {item.direction === 'in' ? 'Received' : 'Sent'} {item.symbol}
                  </div>
                  <div className="truncate text-[11px] text-fg-faint">
                    {formatRelativeTime(item.timestamp)} · {item.ref}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono text-[13px] tabular-nums text-fg">
                    {item.direction === 'in' ? '+' : '−'}
                    {formatToken(item.amount)}
                  </div>
                  <div className="text-[11px] text-fg-faint">Confirmed</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* No address, full tx hashes, or external explorer links are shown
          here by design — see lib/wallet/portfolio.ts for what's scrubbed
          server-side before this ever reaches the client. */}
    </div>
  )
}

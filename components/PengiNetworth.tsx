'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, m, useReducedMotion } from 'framer-motion'
import { useCachedPoll } from '@/lib/useCachedPoll'
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  Check,
  Copy,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'

type Holding = {
  chain: 'LTC' | 'ETH' | 'SOL'
  name: string
  symbol: string
  icon: string
  color: string
  address: string
  explorer_url: string
  balance: number | null
  price: number | null
  usd: number | null
  share_pct: number | null
  change_24h_pct: number | null
  sparkline: number[] | null
  error: string | null
}

type ProfitBucket = {
  window_days: number
  start_usd: number
  end_usd: number
  abs: number
  pct: number
} | null

type Networth = {
  total_usd: number
  updated_at: string
  holdings: Holding[]
  history: { date: string; timestamp: number; total: number }[]
  profit: { day: ProfitBucket; week: ProfitBucket; month: ProfitBucket }
  reconstructed: boolean
  warnings?: string[]
}

type ApiResponse = {
  success?: boolean
  data?: Networth
  error?: string
  message?: string
}

// Match the 10-min server-cache cadence used by GitHub/TikTok routes.
const POLL_MS = 5 * 60 * 1000
const CACHE_KEY = 'zerxbio:pengi:v1'

type Range = 7 | 30

function fmtUsd(n: number | null | undefined, digits?: number) {
  if (n == null || Number.isNaN(n)) return 'N/A'
  const abs = Math.abs(n)
  const d = digits ?? (abs >= 100 ? 2 : abs >= 1 ? 2 : 4)
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: d,
    minimumFractionDigits: d,
  })
}

function fmtCoin(n: number | null, symbol: string, digits = 6) {
  if (n == null || Number.isNaN(n)) return `N/A ${symbol}`
  return `${n.toLocaleString('en-US', { maximumFractionDigits: digits })} ${symbol}`
}

function fmtPct(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return '0.00%'
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function fmtAbs(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return '$0'
  const abs = Math.abs(n)
  const sign = n >= 0 ? '+' : '−'
  if (abs >= 1000) return `${sign}$${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  return `${sign}$${abs.toFixed(2)}`
}

// Catmull-Rom-ish smoothing, ported straight from ZerxHub's chart.js — small
// tension keeps the curve honest.
function smoothPath(points: { x: number; y: number }[]) {
  if (points.length < 2) return ''
  if (points.length === 2) {
    return `M${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)} L${points[1].x.toFixed(1)} ${points[1].y.toFixed(1)}`
  }
  const t = 0.4
  let d = `M${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2 >= points.length ? i + 1 : i + 2]
    const cp1x = p1.x + ((p2.x - p0.x) * t) / 3
    const cp1y = p1.y + ((p2.y - p0.y) * t) / 3
    const cp2x = p2.x - ((p3.x - p1.x) * t) / 3
    const cp2y = p2.y - ((p3.y - p1.y) * t) / 3
    d += ` C${cp1x.toFixed(1)} ${cp1y.toFixed(1)} ${cp2x.toFixed(1)} ${cp2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
  }
  return d
}

function scale(v: number, min: number, max: number, out0: number, out1: number) {
  if (max === min) return (out0 + out1) / 2
  return out0 + ((v - min) / (max - min)) * (out1 - out0)
}

// Wrapped in memo() below — a fresh reference for `points` on every parent
// render (background poll rebuilds visibleHistory) would otherwise re-run the
// draw animation every 5 minutes. The custom comparator only re-renders when
// the actual data endpoints move.
function PortfolioChartInner({
  points,
  positive,
}: {
  points: { timestamp: number; total: number }[]
  positive: boolean
}) {
  const width = 380
  const height = 160
  const padTop = 8
  const padBottom = 20
  const padLeft = 4
  const padRight = 4
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const shouldReduce = useReducedMotion()

  const { linePath, areaPath, end, xLabels, pts, chartBottom } = useMemo(() => {
    if (points.length < 2) {
      return {
        linePath: '',
        areaPath: '',
        end: null,
        xLabels: [] as { x: number; label: string }[],
        pts: [] as { x: number; y: number }[],
        chartBottom: 0,
      }
    }
    const values = points.map((p) => p.total)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min || Math.max(1, max * 0.05)
    const yMin = Math.max(0, min - range * 0.2)
    const yMax = max + range * 0.2

    const chartW = width - padLeft - padRight
    const chartH = height - padTop - padBottom
    const x = (i: number) => padLeft + scale(i, 0, points.length - 1, 0, chartW)
    const y = (v: number) => padTop + scale(v, yMin, yMax, chartH, 0)

    const pts = points.map((p, i) => ({ x: x(i), y: y(p.total) }))
    const linePath = smoothPath(pts)
    const bottom = padTop + chartH
    const areaPath = `${linePath} L${pts[pts.length - 1].x.toFixed(1)} ${bottom.toFixed(1)} L${pts[0].x.toFixed(1)} ${bottom.toFixed(1)} Z`

    // 4 evenly-spaced x-axis date labels.
    const labelIdxs = [0, Math.floor(points.length / 3), Math.floor((2 * points.length) / 3), points.length - 1]
    const xLabels = labelIdxs.map((i) => {
      const d = new Date(points[i].timestamp)
      const label = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
      return { x: x(i), label }
    })

    return { linePath, areaPath, end: pts[pts.length - 1], xLabels, pts, chartBottom: bottom }
  }, [points])

  if (!linePath || !end) {
    return (
      <div className="flex h-40 items-center justify-center text-xs text-fg-muted">
        Not enough history to draw yet.
      </div>
    )
  }

  const color = positive ? '#57F287' : '#ED4245'
  const gradId = `nw-area-${positive ? 'up' : 'down'}`

  // Map pointer x to a point index. SVG uses `viewBox` so we normalize the
  // pointer's on-screen x into viewBox space, then convert that into an
  // index by inverting the same scale we used to lay out the points.
  const handleMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!svgRef.current || points.length < 2) return
    const rect = svgRef.current.getBoundingClientRect()
    const viewX = ((e.clientX - rect.left) / rect.width) * width
    const chartW = width - padLeft - padRight
    const rel = (viewX - padLeft) / chartW
    const idx = Math.round(rel * (points.length - 1))
    setHoverIdx(Math.max(0, Math.min(points.length - 1, idx)))
  }
  const clearHover = () => setHoverIdx(null)

  const hoverPt = hoverIdx != null ? pts[hoverIdx] : null
  const hoverData = hoverIdx != null ? points[hoverIdx] : null
  const hoverDate = hoverData
    ? new Date(hoverData.timestamp).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : ''
  // Keep the tooltip within the chart even when hovering near the edges.
  const tooltipLeftPct = hoverPt ? Math.max(14, Math.min(86, (hoverPt.x / width) * 100)) : 0

  return (
    <div className="relative px-1">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="h-40 w-full overflow-visible"
        onPointerMove={handleMove}
        onPointerDown={handleMove}
        onPointerLeave={clearHover}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <m.path
          d={areaPath}
          fill={`url(#${gradId})`}
          initial={shouldReduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={shouldReduce ? { duration: 0 } : { duration: 0.4, delay: 0.15 }}
        />
        <m.path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={shouldReduce ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={shouldReduce ? { duration: 0 } : { duration: 0.9, ease: 'easeOut' }}
        />
        {/* End-of-line marker hides when the user is scrubbing so the hover
            marker below is the only focal point. */}
        {hoverPt == null && (
          <>
            {/* Continuously pulsing ring — always visible even after the
                one-shot entrance completes, so the tail always reads as
                "live". Skipped for reduced-motion users. */}
            {!shouldReduce && (
              <m.circle
                cx={end.x}
                cy={end.y}
                fill={color}
                initial={{ r: 4, opacity: 0.5 }}
                animate={{ r: [4, 11, 4], opacity: [0.5, 0, 0.5] }}
                transition={{
                  duration: 1.8,
                  ease: 'easeOut',
                  repeat: Infinity,
                  delay: 0.9,
                }}
              />
            )}
            <m.circle
              cx={end.x}
              cy={end.y}
              r={4}
              fill={color}
              initial={shouldReduce ? false : { opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={shouldReduce ? { duration: 0 } : { duration: 0.25, delay: 0.9 }}
              style={{ transformOrigin: `${end.x}px ${end.y}px` }}
            />
            <m.circle
              cx={end.x}
              cy={end.y}
              r={1.6}
              fill="#fff"
              initial={shouldReduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={shouldReduce ? { duration: 0 } : { duration: 0.25, delay: 0.9 }}
            />
          </>
        )}
        {/* Hover crosshair + marker — m.* so they glide between points
            instead of teleporting when the pointer moves quickly. */}
        {hoverPt && (
          <>
            <m.line
              y1={padTop}
              y2={chartBottom}
              stroke="rgba(255,255,255,0.25)"
              strokeWidth={1}
              strokeDasharray="2 3"
              initial={false}
              animate={{ x1: hoverPt.x, x2: hoverPt.x }}
              transition={
                shouldReduce
                  ? { duration: 0 }
                  : { type: 'spring', stiffness: 500, damping: 40, mass: 0.4 }
              }
            />
            <m.circle
              r={5}
              fill={color}
              stroke="#0e0e10"
              strokeWidth={2}
              initial={false}
              animate={{ cx: hoverPt.x, cy: hoverPt.y }}
              transition={
                shouldReduce
                  ? { duration: 0 }
                  : { type: 'spring', stiffness: 500, damping: 40, mass: 0.4 }
              }
            />
          </>
        )}
        {xLabels.map((l, i) => (
          <text
            key={i}
            x={l.x}
            y={height - 6}
            fill="rgba(255,255,255,0.35)"
            fontSize="9"
            textAnchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'}
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          >
            {l.label}
          </text>
        ))}
      </svg>
      {/* HTML tooltip overlay — positioned as a % of the SVG's rendered width
          so it tracks correctly regardless of container size. `transition-[left]`
          smooths horizontal motion when the pointer moves between points. */}
      <AnimatePresence>
        {hoverData && (
          <m.div
            key="chart-tip"
            // The -50% x shift centers the tooltip on its `left` anchor point.
            // It lives inside framer's transform (not a Tailwind class) because
            // framer overwrites `transform` inline while animating y — a class
            // like `-translate-x-1/2` would silently lose the fight and the
            // tooltip would drift right, overflowing the hero card at the edge.
            initial={shouldReduce ? { opacity: 0, x: '-50%' } : { opacity: 0, x: '-50%', y: -2 }}
            animate={{ opacity: 1, x: '-50%', y: 0 }}
            exit={{ opacity: 0, x: '-50%' }}
            transition={{ duration: 0.12 }}
            className={`pointer-events-none absolute top-1 z-10 whitespace-nowrap rounded-md bg-bg px-2 py-1 text-center shadow-lg ring-1 ring-white/10 ${
              shouldReduce ? '' : 'transition-[left] duration-150 ease-out'
            }`}
            style={{ left: `${tooltipLeftPct}%` }}
          >
            <div className="font-mono text-xs font-semibold text-fg">{fmtUsd(hoverData.total)}</div>
            <div className="text-[9px] uppercase tracking-wider text-fg-muted">{hoverDate}</div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// Custom comparator: `visibleHistory` gets a new array reference on every
// parent render, but the underlying data usually hasn't changed. Compare
// length + first/last point — this catches range switches (7d ↔ 30d), new
// day rollovers, and the pinned-live-total change on the tail, while
// skipping identical-data re-renders that would otherwise replay the
// path-draw animation.
const PortfolioChart = memo(PortfolioChartInner, (prev, next) => {
  if (prev.positive !== next.positive) return false
  if (prev.points === next.points) return true
  if (prev.points.length !== next.points.length) return false
  const pl = prev.points.length
  if (!pl) return true
  const a0 = prev.points[0]
  const b0 = next.points[0]
  const aN = prev.points[pl - 1]
  const bN = next.points[pl - 1]
  return (
    a0.timestamp === b0.timestamp &&
    a0.total === b0.total &&
    aN.timestamp === bN.timestamp &&
    aN.total === bN.total
  )
})

function ProfitPill({ label, bucket }: { label: string; bucket: ProfitBucket }) {
  const positive = (bucket?.abs ?? 0) >= 0
  const color = positive ? 'text-[#57F287]' : 'text-[#ED4245]'
  return (
    <div className="flex-1 rounded-xl bg-bg-raised px-3 py-2.5">
      <div className="text-[10px] font-medium uppercase tracking-wider text-fg-muted">{label}</div>
      {bucket ? (
        <>
          <div className={`mt-0.5 font-mono text-sm font-semibold ${color}`}>
            {fmtAbs(bucket.abs)}
          </div>
          <div className={`text-[10px] ${color} opacity-80`}>{fmtPct(bucket.pct)}</div>
        </>
      ) : (
        <div className="mt-0.5 font-mono text-sm text-fg-muted">—</div>
      )}
    </div>
  )
}

// Tiny 7d sparkline drawn from CoinGecko's hourly price series. Color tracks
// 24h direction so a red dip stands out even before you read the % number.
const Sparkline = memo(function Sparkline({
  data,
  positive,
}: {
  data: number[]
  positive: boolean
}) {
  const w = 44
  const h = 16
  const path = useMemo(() => {
    if (data.length < 2) return ''
    let min = Infinity
    let max = -Infinity
    for (const v of data) {
      if (v < min) min = v
      if (v > max) max = v
    }
    const range = max - min || 1
    const step = w / (data.length - 1)
    let d = ''
    for (let i = 0; i < data.length; i++) {
      const x = i * step
      const y = h - 1 - ((data[i] - min) / range) * (h - 2)
      d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    }
    return d
  }, [data])
  if (!path) return null
  const color = positive ? '#57F287' : '#ED4245'
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      className="shrink-0"
      aria-hidden="true"
    >
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.85}
      />
    </svg>
  )
})

function HoldingRow({ h, expanded, onToggle }: { h: Holding; expanded: boolean; onToggle: () => void }) {
  const [copied, setCopied] = useState(false)
  const shouldReduce = useReducedMotion()
  const change = h.change_24h_pct
  const positive = (change ?? 0) >= 0
  const changeColor = change == null ? 'text-fg-muted' : positive ? 'text-[#57F287]' : 'text-[#ED4245]'

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(h.address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked, no-op */
    }
  }

  return (
    <div className="overflow-hidden rounded-xl bg-bg-raised">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-bg-subtle"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={h.icon} alt="" aria-hidden="true" className="h-8 w-8 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-fg">
            <span>{h.name}</span>
            <span className="text-xs font-normal text-fg-muted">{h.symbol}</span>
          </div>
          <div className="truncate text-xs text-fg-muted">{fmtCoin(h.balance, h.symbol)}</div>
        </div>
        {h.sparkline && h.sparkline.length > 1 && (
          <Sparkline data={h.sparkline} positive={positive} />
        )}
        <div className="shrink-0 text-right">
          <div className="font-mono text-sm font-semibold text-fg">{fmtUsd(h.usd)}</div>
          <div className={`text-[11px] font-medium ${changeColor}`}>
            {change == null ? '—' : fmtPct(change)}
          </div>
        </div>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <m.div
            key="expanded"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={
              shouldReduce
                ? { duration: 0 }
                : {
                    // Height uses a standard "material" curve for a smooth reveal;
                    // opacity trails slightly so content fades in as space opens.
                    height: { duration: 0.28, ease: [0.4, 0, 0.2, 1] },
                    opacity: { duration: 0.18, ease: 'easeOut' },
                  }
            }
            className="overflow-hidden"
          >
            <div className="border-t border-white/5 px-3 pb-3 pt-2 text-xs text-fg-muted">
              {h.error ? (
                <div className="flex items-center gap-1.5 text-[#ED4245]">
                  <AlertCircle size={12} /> {h.error}
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span>Price</span>
                    <span className="font-mono text-fg">{fmtUsd(h.price)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Portfolio share</span>
                    <span className="font-mono text-fg">
                      {h.share_pct != null ? `${h.share_pct.toFixed(1)}%` : '—'}
                    </span>
                  </div>
                  {/* Address row — click to copy, arrow to open in explorer.
                      Split into two buttons so each affordance is obvious. */}
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={copyAddress}
                      aria-label={copied ? 'Address copied' : 'Copy address'}
                      className="group flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-1 pl-1 pr-1.5 text-left transition-colors hover:bg-white/5"
                    >
                      <span className="truncate font-mono text-[10px] text-fg-muted transition-colors group-hover:text-fg">
                        {h.address}
                      </span>
                      {copied ? (
                        <Check size={11} className="shrink-0 text-[#57F287]" />
                      ) : (
                        <Copy
                          size={11}
                          className="shrink-0 text-fg-muted transition-colors group-hover:text-fg"
                        />
                      )}
                    </button>
                    <a
                      href={h.explorer_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Open in explorer"
                      className="shrink-0 rounded-md p-1 text-fg-muted transition-colors hover:bg-white/5 hover:text-fg"
                    >
                      <ArrowUpRight size={12} />
                    </a>
                  </div>
                </div>
              )}
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  )
}


// Turn API warning strings (e.g. "prices: 429") into human-friendly messages
// so users know why numbers look off instead of guessing.
function humanizeWarning(w: string): string {
  const [scope, ...rest] = w.split(':')
  const detail = rest.join(':').trim()
  switch (scope.trim()) {
    case 'prices':
      return `Live prices unavailable${detail ? ` (${detail})` : ''} — showing last cached values.`
    case 'history':
      return `Chart may be incomplete${detail ? ` (${detail})` : ''} — reconstruction failed.`
    default:
      return w
  }
}

// Compact amber banner surfacing whatever the API couldn't fetch. Uses
// AnimatePresence so it fades in/out when a background refresh clears the
// underlying issue.
function WarningBanner({ warnings }: { warnings: string[] }) {
  const shouldReduce = useReducedMotion()
  if (!warnings.length) return null
  return (
    <m.div
      role="status"
      aria-live="polite"
      initial={shouldReduce ? false : { opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={shouldReduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
      transition={{ duration: 0.2 }}
      className="flex gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200/90 ring-1 ring-amber-500/20"
    >
      <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-400" />
      <div className="space-y-0.5">
        {warnings.map((w) => (
          <div key={w}>{humanizeWarning(w)}</div>
        ))}
      </div>
    </m.div>
  )
}

// Shown on first load and while the API is warming up. Mirrors the real
// layout so the modal doesn't jump when data arrives.
function NetworthSkeleton() {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-bg-raised ring-1 ring-white/5">
        <div className="px-4 pt-4">
          <div className="space-y-2">
            <div className="h-2.5 w-24 animate-pulse rounded bg-white/5" />
            <div className="h-8 w-44 animate-pulse rounded bg-white/10" />
            <div className="h-3 w-32 animate-pulse rounded bg-white/5" />
          </div>
        </div>
        <div className="mt-3 h-40 animate-pulse bg-white/[0.02]" />
        <div className="flex justify-end gap-0.5 px-3 pb-3 pt-1">
          <div className="h-6 w-10 animate-pulse rounded-md bg-white/5" />
          <div className="h-6 w-10 animate-pulse rounded-md bg-white/5" />
        </div>
      </div>
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex-1 rounded-xl bg-bg-raised px-3 py-2.5">
            <div className="h-2.5 w-8 animate-pulse rounded bg-white/5" />
            <div className="mt-1.5 h-4 w-16 animate-pulse rounded bg-white/10" />
            <div className="mt-1 h-2 w-10 animate-pulse rounded bg-white/5" />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl bg-bg-raised px-3 py-3">
            <div className="h-8 w-8 animate-pulse rounded-full bg-white/10" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-24 animate-pulse rounded bg-white/10" />
              <div className="h-2.5 w-32 animate-pulse rounded bg-white/5" />
            </div>
            <div className="space-y-1.5 text-right">
              <div className="ml-auto h-3.5 w-16 animate-pulse rounded bg-white/10" />
              <div className="ml-auto h-2.5 w-12 animate-pulse rounded bg-white/5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function PengiNetworth() {
  const [range, setRange] = useState<Range>(30)
  const [expanded, setExpanded] = useState<string | null>(null)

  // Tracks the last-known real total so we can reject "half-cooked" upstream
  // responses (all balances null → total = 0). Kept in a ref so mutating it
  // from inside the fetcher doesn't trigger re-renders.
  const totalRef = useRef(0)

  const fetcher = useCallback(async () => {
    // Rely on the server's Cache-Control (s-maxage=600, SWR=1200) plus the
    // browser's HTTP cache — cold hits still fetch fresh, warm hits are ms.
    const r = await fetch('/api/networth')
    const j = (await r.json()) as ApiResponse
    if (!r.ok || !j.data) throw new Error(j.message || 'Failed to load portfolio')
    const incomingTotal = j.data.total_usd || 0
    const allNull = j.data.holdings.every((h) => h.balance == null)
    // Skip the update entirely — the hook keeps the last-known data on
    // screen, so upstream hiccups don't blank out the UI.
    if (allNull && !incomingTotal && totalRef.current > 0) return null
    totalRef.current = incomingTotal
    return j.data
  }, [])

  const { data: nw, error } = useCachedPoll<Networth>({
    cacheKey: CACHE_KEY,
    pollMs: POLL_MS,
    resetKey: 'pengi',
    fetcher,
  })

  // Keep totalRef in sync with whatever data ends up on screen — including
  // the cache-hydrated initial render — so the half-cooked guard has a
  // baseline from tick 1.
  useEffect(() => {
    if (nw) totalRef.current = nw.total_usd
  }, [nw])

  const visibleHistory = useMemo(() => {
    if (!nw?.history?.length) return []
    return nw.history.slice(-range - 1)
  }, [nw, range])

  // Header delta: only compute when we actually have enough history to
  // make an honest comparison. `spanDays` is how much of the requested
  // window we actually cover — it feeds the header subtitle.
  const rangeChange = useMemo(() => {
    if (visibleHistory.length < 2) return null
    const start = visibleHistory[0]
    const end = visibleHistory[visibleHistory.length - 1]
    if (start.total <= 0) return null
    const spanDays = (end.timestamp - start.timestamp) / (86_400 * 1000)
    const abs = end.total - start.total
    const pct = (abs / start.total) * 100
    return { abs, pct, positive: abs >= 0, spanDays }
  }, [visibleHistory])

  // Only fall into the pure error state when we have nothing else to show.
  // If cache hydrated `nw`, keep rendering it even if the background refresh
  // failed — the user still sees useful data.
  if (error && !nw) {
    return (
      <div className="rounded-xl bg-bg-raised px-4 py-6 text-center text-sm text-fg-muted">
        {error}
      </div>
    )
  }

  if (!nw) {
    return <NetworthSkeleton />
  }

  const positive = rangeChange?.positive ?? true
  const TrendIcon = positive ? TrendingUp : TrendingDown
  const trendColor = positive ? 'text-[#57F287]' : 'text-[#ED4245]'
  // If we don't cover the full requested range, show the actual span so the
  // subtitle doesn't lie ("30d" when we only have 4 days of history).
  const rangeLabel =
    rangeChange && rangeChange.spanDays < range - 1
      ? `${Math.max(1, Math.round(rangeChange.spanDays))}d`
      : `${range}d`

  return (
    <div className="space-y-4">
      {/* Hero card — total, delta, and the chart all in one continuous surface. */}
      <div className="relative overflow-hidden rounded-2xl bg-bg-raised ring-1 ring-white/5">
        <div className="relative px-4 pb-1 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-medium uppercase tracking-wider text-fg-muted">
                Net Worth · {rangeLabel}
              </div>
              <div className="mt-1 font-display text-3xl font-bold tabular-nums text-fg">
                {fmtUsd(nw.total_usd)}
              </div>
              {rangeChange ? (
                <div className={`mt-1 flex items-center gap-1.5 text-xs font-medium ${trendColor}`}>
                  <TrendIcon size={12} />
                  <span className="font-mono tabular-nums">
                    {fmtAbs(rangeChange.abs)} · {fmtPct(rangeChange.pct)}
                  </span>
                </div>
              ) : (
                <div className="mt-1 text-xs font-medium text-fg-muted">
                  <span className="font-mono">Not enough history yet</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="relative">
          <PortfolioChart points={visibleHistory} positive={positive} />
        </div>

        <div className="relative flex justify-end gap-0.5 px-3 pb-3">
          {([7, 30] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded-md px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                range === r
                  ? 'bg-fg text-bg'
                  : 'text-fg-muted hover:bg-white/5 hover:text-fg'
              }`}
            >
              {r}d
            </button>
          ))}
        </div>
      </div>

      {/* Any partial-data warnings from the API */}
      <AnimatePresence>
        {nw.warnings && nw.warnings.length > 0 && (
          <WarningBanner warnings={nw.warnings} />
        )}
      </AnimatePresence>

      {/* Profit pills — 24h / 7d / 30d */}
      <div className="flex gap-2">
        <ProfitPill label="24h" bucket={nw.profit.day} />
        <ProfitPill label="7d" bucket={nw.profit.week} />
        <ProfitPill label="30d" bucket={nw.profit.month} />
      </div>

      {/* Per-coin holdings */}
      <div className="space-y-2">
        {nw.holdings.map((h) => (
          <HoldingRow
            key={h.chain}
            h={h}
            expanded={expanded === h.chain}
            onToggle={() => setExpanded(expanded === h.chain ? null : h.chain)}
          />
        ))}
      </div>

    </div>
  )
}

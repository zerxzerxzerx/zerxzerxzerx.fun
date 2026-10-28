// Rolimons' own player-value chart (rolimons.com/player/{id}) has no public
// API — its `chart_data`/`old_chart_data` series are baked server-side into
// the page's inline <script> markup, and the page itself is Cloudflare-
// fingerprinted (403s every server-side fetch, same as the rest of this
// codebase's Rolimons integration). There's no way to pull it live.
//
// SEED_HISTORY below is a hand-digitized approximation of that chart, read
// off a screenshot of the real rolimons.com/player/3112717 "All" range view
// (Aug 2024 → Oct 2026). The three anchor points — start, the May 2026 peak,
// and the most recent point — came from hovering the real chart's tooltips
// and are exact; everything between is interpolated to match the shape
// (steady climb → mid-2025 plateau/dip → the Jan 2026 cliff jump → climb to
// peak → decline) rather than independently verified. From here on,
// `recordSnapshot` below appends real, exact points on every fetch of the
// site owner's own profile, so accuracy only improves going forward.
export type ValuePoint = { t: number; value: number; rap: number }

function d(y: number, m: number, day: number): number {
  return Math.floor(Date.UTC(y, m - 1, day) / 1000)
}

export const SEED_HISTORY: ValuePoint[] = [
  { t: d(2024, 8, 13), value: 370_287, rap: 394_358 }, // exact (chart start)
  { t: d(2024, 9, 15), value: 410_000, rap: 420_000 },
  { t: d(2024, 10, 15), value: 450_000, rap: 455_000 },
  { t: d(2024, 11, 15), value: 490_000, rap: 500_000 },
  { t: d(2024, 12, 15), value: 540_000, rap: 545_000 },
  { t: d(2025, 1, 15), value: 580_000, rap: 585_000 },
  { t: d(2025, 2, 15), value: 610_000, rap: 615_000 },
  { t: d(2025, 3, 15), value: 645_000, rap: 650_000 },
  { t: d(2025, 4, 15), value: 630_000, rap: 640_000 },
  { t: d(2025, 5, 15), value: 615_000, rap: 625_000 },
  { t: d(2025, 6, 15), value: 600_000, rap: 610_000 },
  { t: d(2025, 7, 15), value: 580_000, rap: 590_000 },
  { t: d(2025, 8, 15), value: 555_000, rap: 565_000 },
  { t: d(2025, 9, 15), value: 530_000, rap: 540_000 },
  { t: d(2025, 10, 15), value: 510_000, rap: 520_000 },
  { t: d(2025, 11, 15), value: 500_000, rap: 510_000 },
  { t: d(2025, 12, 20), value: 520_000, rap: 525_000 },
  { t: d(2026, 1, 5), value: 540_000, rap: 545_000 },
  { t: d(2026, 1, 12), value: 960_000, rap: 950_000 }, // the cliff jump
  { t: d(2026, 1, 25), value: 930_000, rap: 935_000 },
  { t: d(2026, 2, 15), value: 955_000, rap: 960_000 },
  { t: d(2026, 3, 15), value: 1_010_000, rap: 1_000_000 },
  { t: d(2026, 4, 10), value: 1_150_000, rap: 1_140_000 },
  { t: d(2026, 4, 25), value: 1_250_000, rap: 1_230_000 },
  { t: d(2026, 5, 3), value: 1_310_481, rap: 1_317_278 }, // exact (peak)
  { t: d(2026, 5, 20), value: 1_260_000, rap: 1_270_000 },
  { t: d(2026, 6, 10), value: 1_180_000, rap: 1_160_000 },
  { t: d(2026, 7, 1), value: 1_100_000, rap: 1_080_000 },
  { t: d(2026, 7, 20), value: 1_040_000, rap: 1_020_000 },
  { t: d(2026, 8, 10), value: 1_000_000, rap: 980_000 },
  { t: d(2026, 8, 30), value: 1_060_000, rap: 1_000_000 },
  { t: d(2026, 9, 15), value: 1_020_000, rap: 990_000 },
  { t: d(2026, 10, 1), value: 1_050_000, rap: 1_000_000 },
  { t: d(2026, 10, 24), value: 1_096_842, rap: 1_015_971 }, // exact (most recent)
]

// --- Going-forward recording, via Upstash's REST API (plain fetch, no SDK:
// a single HTTP call per command, so it's a no-op cost to add alongside the
// rest of this route's fetch fan-out). Requires UPSTASH_REDIS_REST_URL and
// UPSTASH_REDIS_REST_TOKEN — grab both free from a new Upstash Redis
// database (console.upstash.com) and set them as env vars; until then these
// helpers silently no-op and the chart just shows the seed history above.
const KEY_PREFIX = 'zerxbio:rolimons:history:'
const MAX_POINTS = 4000
const MIN_INTERVAL_MS = 60 * 60 * 1000 // don't log more than one point/hour

async function upstash(command: (string | number)[]): Promise<unknown> {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
      cache: 'no-store',
      signal: AbortSignal.timeout(2500),
    })
    if (!res.ok) return null
    const j = (await res.json().catch(() => null)) as { result?: unknown } | null
    return j?.result ?? null
  } catch {
    return null
  }
}

// Best-effort — never throws, so a missing/misconfigured Upstash store
// can't take down the Roblox route.
export async function recordSnapshot(userId: number, value: number | null, rap: number | null): Promise<void> {
  if (value == null || rap == null) return
  const key = KEY_PREFIX + userId
  const lastRaw = await upstash(['LINDEX', key, -1])
  if (typeof lastRaw === 'string') {
    try {
      const last = JSON.parse(lastRaw) as ValuePoint
      if (Date.now() - last.t * 1000 < MIN_INTERVAL_MS) return
    } catch {
      // malformed entry — fall through and record anyway
    }
  }
  const point: ValuePoint = { t: Math.floor(Date.now() / 1000), value, rap }
  await upstash(['RPUSH', key, JSON.stringify(point)])
  await upstash(['LTRIM', key, -MAX_POINTS, -1])
}

export async function getRecordedHistory(userId: number): Promise<ValuePoint[]> {
  const raw = await upstash(['LRANGE', KEY_PREFIX + userId, 0, -1])
  if (!Array.isArray(raw)) return []
  const points: ValuePoint[] = []
  for (const entry of raw) {
    if (typeof entry !== 'string') continue
    try {
      points.push(JSON.parse(entry) as ValuePoint)
    } catch {
      // skip malformed entry
    }
  }
  return points
}

// Seed + recorded, deduped by timestamp (recorded wins on collision) and
// sorted ascending.
export function mergeHistory(recorded: ValuePoint[]): ValuePoint[] {
  const byTime = new Map<number, ValuePoint>()
  for (const p of SEED_HISTORY) byTime.set(p.t, p)
  for (const p of recorded) byTime.set(p.t, p)
  return [...byTime.values()].sort((a, b) => a.t - b.t)
}

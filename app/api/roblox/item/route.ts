import { NextResponse } from 'next/server'
import { tryFetch } from '@/lib/robloxFetch'

// Same reasoning as app/api/roblox/route.ts: Roblox's WAF 403s the edge
// runtime's undici stack from datacenter IPs, Node's doesn't.
export const runtime = 'nodejs'
export const revalidate = 300

// economy.roblox.com's v2 asset-details endpoint is public (no auth) and,
// for a Limited/LimitedU, includes `CollectiblesItemDetails` — which is
// where `CollectibleLowestResalePrice` (the "Best Price" figure Rolimons'
// own item pages show) and `TotalQuantity` (how many of the item were ever
// minted) live. The sibling `/v1/assets/{id}/resellers` endpoint that used
// to expose the full resale listing feed now 401s anonymous callers, so
// the lowest-price summary baked into `details` is the only piece of that
// data still reachable without auth.
type RbxAssetDetails = {
  Name?: string
  Description?: string
  Creator?: { Name?: string }
  Created?: string
  Updated?: string
  AssetTypeId?: number
  CollectiblesItemDetails?: {
    CollectibleLowestResalePrice?: number | null
    TotalQuantity?: number | null
  } | null
}
type RbxThumb = { data?: { targetId: number; imageUrl?: string }[] }

// AssetTypeId 18 = "Face". Roblox's "Dynamic Head" migration reissued
// classic Faces as separate avatar Bundles carrying the actual current
// tradeable/collectible data — the classic asset's own
// `CollectiblesItemDetails` comes back null/IsLimited:false even though
// it's still RAP-tracked on Rolimons and still sits in the user's
// collectibles inventory. There's no direct reverse lookup from a Face's
// assetId to its bundle id (`/v1/assets/{id}/bundles` returns empty for
// these), so the only reliable path is Catalog's own search endpoint,
// scoped to Category=11 (Bundles) by the Face's exact name, matched to the
// official Roblox-creator entry (creatorTargetId === 1) with an
// case-insensitive exact name match — verified this isolates the right
// bundle even when unrelated same-named UGC bundles show up in the results.
const FACE_ASSET_TYPE_ID = 18
type RbxBundleSearchItem = {
  id?: number
  itemType?: string
  name?: string
  creatorName?: string
  creatorTargetId?: number
  lowestResalePrice?: number | null
  totalQuantity?: number | null
}
type RbxBundleSearch = { data?: RbxBundleSearchItem[] }

// Rolimons has no per-item endpoint — `items/v1/itemdetails` always returns
// its entire ~2,500-item catalog (~175KB) keyed by asset id, so every
// lookup here pulls the whole thing. `revalidate = 300` above keeps that
// cheap on repeat opens of the same or a different item. Each item is a
// fixed-shape tuple (not an object — this is Rolimons' own wire format):
//   [name, acronym, rap, value, defaultValue, demand, trend, projected, hyped, rare]
// `value`/`demand`/`trend` use -1 for "not set / N/A"; `projected`/`hyped`/
// `rare` are 0/1 (-1 also appears, treated the same as 0/false).
type RolimonsItemTuple = [
  string, string, number, number, number, number, number, number, number, number,
]
type RolimonsItemDetails = { success?: boolean; items?: Record<string, RolimonsItemTuple> }

// Index → label, straight off Rolimons' own item-page legend.
const DEMAND_LABELS = ['Terrible', 'Low', 'Normal', 'High', 'Amazing']
const TREND_LABELS = ['Lowering', 'Unstable', 'Stable', 'Raising', 'Fluctuating']

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const assetIdParam = searchParams.get('assetId')?.trim()
  if (!assetIdParam || !/^\d{1,20}$/.test(assetIdParam)) {
    return NextResponse.json(
      { error: 'invalid_id', message: 'A valid Roblox asset id is required.' },
      { status: 400 },
    )
  }
  const assetId = Number(assetIdParam)

  const [details, thumbRes, rolimonsItems] = await Promise.all([
    tryFetch<RbxAssetDetails>(`https://economy.roblox.com/v2/assets/${assetId}/details`),
    tryFetch<RbxThumb>(
      `https://thumbnails.roblox.com/v1/assets?assetIds=${assetId}&size=420x420&format=Png&isCircular=false`,
    ),
    tryFetch<RolimonsItemDetails>('https://api.rolimons.com/items/v1/itemdetails'),
  ])

  const tuple = rolimonsItems?.items?.[String(assetId)]
  const [, , roliRap, roliValue, , demand, trend, projected, hyped, rare] = tuple ?? []

  // Classic Face: look up its reissued Bundle so bestPrice/quantity/the
  // Rolimons link reflect the real currently-tradeable item instead of the
  // dead classic asset. Best-effort — if the search comes back empty or
  // ambiguous, fall through to the classic-asset-derived values below.
  let bundle: RbxBundleSearchItem | undefined
  if (details?.AssetTypeId === FACE_ASSET_TYPE_ID && details?.Name) {
    const bundleSearch = await tryFetch<RbxBundleSearch>(
      `https://catalog.roblox.com/v1/search/items/details?Category=11&Keyword=${encodeURIComponent(
        details.Name,
      )}`,
    )
    bundle = bundleSearch?.data?.find(
      (b) =>
        b.itemType === 'Bundle' &&
        b.creatorTargetId === 1 &&
        b.name?.toLowerCase() === details.Name!.toLowerCase(),
    )
  }

  const data = {
    assetId,
    name: details?.Name ?? null,
    description: details?.Description ?? null,
    creator: details?.Creator?.Name ?? null,
    created: details?.Created ?? null,
    updated: details?.Updated ?? null,
    icon_url: thumbRes?.data?.[0]?.imageUrl || null,
    rap: roliRap ?? null,
    value: roliValue != null && roliValue >= 0 ? roliValue : null,
    bestPrice:
      bundle?.lowestResalePrice ?? details?.CollectiblesItemDetails?.CollectibleLowestResalePrice ?? null,
    totalQuantity: bundle?.totalQuantity ?? details?.CollectiblesItemDetails?.TotalQuantity ?? null,
    demand: demand != null && demand >= 0 ? demand : null,
    demandLabel: demand != null && demand >= 0 ? DEMAND_LABELS[demand] ?? null : null,
    trend: trend != null && trend >= 0 ? trend : null,
    trendLabel: trend != null && trend >= 0 ? TREND_LABELS[trend] ?? null : null,
    projected: projected === 1,
    hyped: hyped === 1,
    rare: rare === 1,
    url: `https://www.roblox.com/catalog/${assetId}`,
    rolimonsUrl: bundle?.id
      ? `https://www.rolimons.com/bundle/${bundle.id}`
      : `https://www.rolimons.com/item/${assetId}`,
  }

  return NextResponse.json(
    { success: true, data },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    },
  )
}

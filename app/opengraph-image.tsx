import { ImageResponse } from 'next/og'
import { ZERX } from '@/lib/constants'
import { displayName, fetchDstnProfile, fetchLanyard, nameplateUrl } from '@/lib/discord'

export const runtime = 'edge'
export const alt = 'zerx'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// next/og's renderer (Satori) needs real font bytes, not just a font-family
// name — next/font/google's fonts (lib/fonts.ts) aren't reusable here, so we
// pull the same family straight from the Google Fonts CSS2 API. Google
// serves woff2 by default, which Satori can't parse; requesting with an old
// Safari UA makes the API fall back to a format Satori can read (seen in
// testing as plain woff, not the ttf the usual Vercel example expects — the
// regex below accepts either so this doesn't silently break if Google
// changes which legacy format it serves next).
//
// Also notable from testing: if NO fonts array is ever passed to
// ImageResponse, @vercel/og tries to load its own bundled default font —
// which hits a Windows-only path bug in this Next 14.2.5 install
// (`fileURLToPath` on a malformed `.\file:\...` string) and 500s every
// request. That's a local-dev-on-Windows quirk, not a production concern on
// Vercel's actual edge runtime, but it's exactly why loadFontOrNull below
// always returns *something* rather than silently degrading to no fonts.
async function loadGoogleFont(family: string, weight: number, text: string) {
  const css = await (
    await fetch(
      `https://fonts.googleapis.com/css2?family=${family}:wght@${weight}&text=${encodeURIComponent(text)}`,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/603.3.8 (KHTML, like Gecko) Version/10.1.2 Safari/603.3.8',
        },
      }
    )
  ).text()
  const match = css.match(/src: url\(([^)]+)\) format\('(?:opentype|truetype|woff)'\)/)
  if (!match) throw new Error(`no usable font resource for ${family}`)
  const res = await fetch(match[1])
  if (!res.ok) throw new Error(`failed fetching font bytes for ${family}`)
  return res.arrayBuffer()
}

async function loadFontOrNull(family: string, weight: number, text: string) {
  try {
    return await loadGoogleFont(family, weight, text)
  } catch {
    return null
  }
}

// Satori fetches remote <img src> URLs itself, and its fetch path chokes on
// the Discord CDN responses here (crashes with "Cannot read properties of
// undefined (reading 'split')", seen first-hand as a 500 on every request in
// the dev server log). Fetching the bytes ourselves and inlining them as
// data: URIs sidesteps Satori's fetch path entirely; on any failure we just
// return null and the layout below renders without that image instead of
// crashing the whole route.
async function toDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    let binary = ''
    const chunkSize = 0x8000
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
    }
    const contentType = res.headers.get('content-type') || 'image/png'
    return `data:${contentType};base64,${btoa(binary)}`
  } catch {
    return null
  }
}

export default async function OpengraphImage() {
  const [lanyard, dstn] = await Promise.all([
    fetchLanyard(ZERX.discordId),
    fetchDstnProfile(ZERX.discordId),
  ])

  const name = lanyard ? displayName(lanyard.discord_user) : 'zerx'
  const nameplateSrc = dstn?.nameplate ? nameplateUrl(dstn.nameplate) : null

  const [nameplateBg, displayBold] = await Promise.all([
    nameplateSrc ? toDataUri(nameplateSrc) : Promise.resolve(null),
    loadFontOrNull('Space+Grotesk', 700, name),
  ])

  const fonts: { name: string; data: ArrayBuffer; weight: 700; style: 'normal' }[] = []
  if (displayBold) fonts.push({ name: 'Space Grotesk', data: displayBold, weight: 700, style: 'normal' })

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          backgroundColor: '#000000',
        }}
      >
        {nameplateBg && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={nameplateBg}
            alt=""
            width={1200}
            height={630}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              opacity: 0.5,
            }}
          />
        )}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0.94) 100%)',
          }}
        />
        <div
          style={{
            position: 'relative',
            display: 'flex',
            width: '100%',
            height: '100%',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              display: 'flex',
              fontSize: 64,
              fontWeight: 700,
              color: '#F5F5F5',
              fontFamily: displayBold ? 'Space Grotesk' : undefined,
              letterSpacing: -1,
            }}
          >
            {name}
          </div>
        </div>
      </div>
    ),
    { ...size, fonts }
  )
}

import type { Metadata, Viewport } from 'next'
import { spaceGrotesk, inter, jetbrainsMono } from '@/lib/fonts'
import MotionProvider from '@/components/MotionProvider'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL('https://zerx.dev'),
  title: {
    default: 'zerx',
    template: '%s · zerx',
  },
  description: 'Moving in silence. Active in the right rooms.',
  keywords: ['zerx', 'crypto', 'telegram', 'escrow', 'deal flow', 'defi'],
  authors: [{ name: 'zerx' }],
  creator: 'zerx',
  // Note: to enable rich social share cards, drop an `opengraph-image.png`
  // (1200×630) into `app/` — Next's file convention picks it up automatically
  // for both openGraph and Twitter meta with no config required.
  openGraph: {
    title: 'zerx',
    description: 'Crypto. Telegram. The underground deal flow.',
    url: 'https://zerx.dev',
    siteName: 'zerx',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'zerx',
    description: 'Moving in silence. Active in the right rooms.',
    creator: '@zerx',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
  // Favicon is served automatically from `app/icon.svg` (Next file convention).
}

export const viewport: Viewport = {
  // Matches Tailwind `bg.DEFAULT` (#0a0a0a). Sets the mobile browser chrome
  // color on Chrome Android / Safari iOS so the URL bar blends into the page
  // instead of showing a bright bar above dark content. (The old value was
  // #080A08 — a slight green tint from the pre-white palette.)
  themeColor: '#0a0a0a',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        {/* Preload the only same-origin image on first paint. Starts the
            35 KB fetch during HTML parse instead of waiting for React to
            hydrate + discover the <img>. Paired with fetchPriority=high on
            the <img> itself so the browser both schedules it early AND
            treats it as high-priority. */}
        <link
          rel="preload"
          as="image"
          href="/pengi.webp"
          fetchPriority="high"
          type="image/webp"
        />
        {/* Preconnect to third-party origins used in the modals — saves the
            DNS + TCP + TLS round trip on the first request per origin. */}
        <link rel="preconnect" href="https://api.lanyard.rest" />
        <link rel="preconnect" href="https://cdn.discordapp.com" crossOrigin="" />
        <link rel="preconnect" href="https://media.discordapp.net" crossOrigin="" />
        <link rel="preconnect" href="https://i.scdn.co" crossOrigin="" />
        <link rel="preconnect" href="https://avatars.githubusercontent.com" crossOrigin="" />
        {/* Roblox thumbnail CDNs. Avatars, group icons, and generated
            asset thumbs live on the t0..t7 sharded hosts; the classic
            profile badges (Veteran, Bricksmith, etc.) live on the flat
            images.rbxcdn.com host. Preconnecting the two most common
            shards + the badges host lets everything in the modal hero
            land in a single round trip after the API JSON returns. The
            crossOrigin attr is required for the browser to actually
            reuse the warmed connection for anonymous CORS requests. */}
        <link rel="preconnect" href="https://t0.rbxcdn.com" crossOrigin="" />
        <link rel="preconnect" href="https://t1.rbxcdn.com" crossOrigin="" />
        <link rel="preconnect" href="https://images.rbxcdn.com" crossOrigin="" />
        {/* Outbound biolink destinations — warms the connection so the click
            through jump lands ~100-300ms faster than a cold DNS + TLS hop. */}
        <link rel="preconnect" href="https://t.me" />
        <link rel="preconnect" href="https://github.com" />
        <link rel="preconnect" href="https://www.tiktok.com" />
        <link rel="preconnect" href="https://www.roblox.com" />
      </head>
      <body className="bg-bg text-fg font-body antialiased">
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  )
}

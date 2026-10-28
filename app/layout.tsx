import type { Metadata, Viewport } from 'next'
import { spaceGrotesk, inter, jetbrainsMono } from '@/lib/fonts'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL('https://zerx.dev'),
  title: {
    default: 'zerx',
    template: '%s · zerx',
  },
  description: 'zerx — socials and live Discord status.',
  keywords: ['zerx', 'biolink', 'discord'],
  authors: [{ name: 'zerx' }],
  creator: 'zerx',
  openGraph: {
    title: 'zerx',
    description: 'zerx — socials and live Discord status.',
    url: 'https://zerx.dev',
    siteName: 'zerx',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'zerx',
    description: 'zerx — socials and live Discord status.',
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
  // Matches Tailwind `bg.DEFAULT` (#000000). Sets the mobile browser chrome
  // color on Chrome Android / Safari iOS so the URL bar blends into the page
  // instead of showing a bright bar above dark content.
  themeColor: '#000000',
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
        {/* Preconnect to third-party origins used by the live status widget
            and outbound social links — saves the DNS + TCP + TLS round trip
            on the first request per origin. */}
        <link rel="preconnect" href="https://api.lanyard.rest" />
        <link rel="preconnect" href="https://cdn.discordapp.com" crossOrigin="" />
        <link rel="preconnect" href="https://t.me" />
        <link rel="preconnect" href="https://www.tiktok.com" />
      </head>
      <body className="bg-bg text-fg font-body antialiased">{children}</body>
    </html>
  )
}

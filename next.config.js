/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // Vercel serves zerx.dev over HTTPS-only. Tell browsers to skip the plain
  // http:// hop on future visits for a full year, including subdomains.
  // `preload` opts into the HSTS preload list — safe to keep since we have no
  // intention of ever going back to HTTP.
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains; preload',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // 'unsafe-eval' is only needed for Next's dev-mode HMR/webpack runtime —
      // dropping it in production tightens the policy against injected eval.
      process.env.NODE_ENV === 'production'
        ? "script-src 'self' 'unsafe-inline'"
        : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      // cdn.discordapp.com = profile avatar / badge art; i.scdn.co = Spotify
      // album art; *.rbxcdn.com = Roblox headshot/badge/group thumbnails;
      // tiktokcdn(-us/-eu) = TikTok avatar images in the TikTok modal.
      "img-src 'self' data: blob: https://cdn.discordapp.com https://i.scdn.co https://*.rbxcdn.com https://*.tiktokcdn.com https://*.tiktokcdn-us.com https://*.tiktokcdn-eu.com",
      "media-src 'self' https://cdn.discordapp.com",
      // api.lanyard.rest = client-side Discord presence polling.
      // dcdn.dstn.to = avatar decoration / nameplate / badge data that
      // Lanyard doesn't expose (mirrors Discord's private profile endpoint).
      "connect-src 'self' https://api.lanyard.rest https://dcdn.dstn.to",
      "frame-ancestors 'none'",
      "base-uri 'self'",
    ].join('; '),
  },
]

const nextConfig = {
  // Framer Motion's mount-animation effect doesn't survive React 18 Strict
  // Mode's dev-only double-invoke (mount → cleanup → mount): the panel's
  // opacity animation gets cancelled mid-flight and never restarts, leaving
  // modals permanently stuck at opacity:0. This has zero effect on the
  // production build (React only double-invokes effects in development,
  // regardless of this flag), so disabling it only trades away a dev-only
  // safety net to fix a dev-only rendering bug.
  reactStrictMode: false,
  poweredByHeader: false,
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error'] } : false,
  },
  experimental: {
    // Auto-generates per-icon barrel imports for these packages so
    // `import { User } from 'lucide-react'` only pulls the User icon
    // instead of the whole 1k+ icon set. Same idea for framer-motion —
    // trims dead exports from the client bundle. Real gain: 5-15 KB
    // gzip off First Load JS.
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}

module.exports = nextConfig

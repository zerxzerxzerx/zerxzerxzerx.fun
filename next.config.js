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
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      // TikTok serves avatars from a bunch of regional subdomains
      // (p16-common-sign, p16-sign-va, p19-sign-*, etc.) under both
      // tiktokcdn.com and tiktokcdn-us.com, so we wildcard both.
      // media.discordapp.net serves proxied activity/game images; i.scdn.co is
      // Spotify's album-art CDN (used by Lanyard presence).
      // Roblox thumbnails/badges/group icons are served from tN.rbxcdn.com
      // (N = 0..7); the *.rbxcdn.com wildcard covers all of them plus the
      // 3D avatar manifest + OBJ/MTL/texture assets loaded by the WebGL
      // viewer.
      "img-src 'self' data: blob: https://cdn.discordapp.com https://media.discordapp.net https://i.scdn.co https://avatars.githubusercontent.com https://*.tiktokcdn.com https://*.tiktokcdn-us.com https://*.rbxcdn.com",
      "media-src 'self' https://cdn.discordapp.com",
      // api.lanyard.rest = client-side Discord presence polling. The Roblox
      // modal used to hit *.rbxcdn.com directly for 3D OBJ/MTL/texture
      // fetches, but the endpoint feeding that pipeline (avatar-3d) became
      // auth-gated in late 2024, so all Roblox data now round-trips
      // through /api/roblox on our own origin — no third-party connect
      // permission needed.
      "connect-src 'self' https://api.lanyard.rest",
      "frame-ancestors 'none'",
      "base-uri 'self'",
    ].join('; '),
  },
]

const nextConfig = {
  reactStrictMode: true,
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
    // Long-cache the stable static assets in /public. Vercel's default for
    // /public serves them with `Cache-Control: public, max-age=0,
    // must-revalidate` — that forces a revalidation round-trip on every
    // navigation, even for identical bytes. Overriding to a week of freshness
    // + a week of stale-while-revalidate cuts every repeat visit's asset
    // cost to zero without going full `immutable` (so if I ever swap the
    // file, browsers eventually pick up the new copy).
    const longCache = [
      {
        key: 'Cache-Control',
        value: 'public, max-age=604800, stale-while-revalidate=604800',
      },
    ]
    return [
      { source: '/(.*)', headers: securityHeaders },
      { source: '/pengi.webp', headers: longCache },
      { source: '/coins/:path*', headers: longCache },
    ]
  },
}

module.exports = nextConfig

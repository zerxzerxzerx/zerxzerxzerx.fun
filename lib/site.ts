// This codebase is deployed twice, independently, from the same source:
// Vercel (zerx.dev, via vercel.json) and a self-hosted VPS behind a
// Cloudflare Tunnel (zerx.fun). Metadata/robots/sitemap need a canonical
// domain, but hardcoding either one breaks the *other* deployment's SEO
// files. `NEXT_PUBLIC_SITE_URL` lets each deployment set its own domain at
// build time; omitting it (the Vercel side today) keeps the original
// zerx.dev default so that deployment's behavior doesn't change.
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://zerx.dev'

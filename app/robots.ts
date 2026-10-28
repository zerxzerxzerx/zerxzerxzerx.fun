import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site'

// File-convention route — Next.js serves this at /robots.txt automatically.
// The `metadata.robots` export in layout.tsx already tells crawlers that
// *render* the page to index it, but crawlers (and some SEO tooling) also
// request /robots.txt directly without ever executing JS/meta tags, so a
// physical file avoids an unnecessary 404 on that request.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}

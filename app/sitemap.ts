import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site'

// File-convention route — Next.js serves this at /sitemap.xml automatically.
// Just the one page: this is a single-page bio-link site, not a multi-route
// content site, so there's nothing else to list.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
  ]
}

'use client'

import { LazyMotion, domAnimation } from 'framer-motion'

// Framer Motion ships two ways: the full `motion` component (~40 KB gzipped)
// or the lazy `m` component paired with a feature bundle loaded at runtime.
// `domAnimation` covers everything this site uses (animate, exit, gestures,
// layout, variants), and cuts the initial JS payload by ~30 KB — a
// noticeable LCP win on mobile-3G.
//
// `strict` throws at runtime if any consumer imports `motion.*` instead of
// `m.*`, so we don't silently regress the bundle later.
export default function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      {children}
    </LazyMotion>
  )
}

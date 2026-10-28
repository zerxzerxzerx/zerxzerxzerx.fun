import BioLink from '@/components/BioLink'

export default function Home() {
  return (
    <>
      {/* min-h-svh (small viewport height) is stable across iOS URL-bar
          transitions. min-h-screen resolves to 100vh, which iOS defines as the
          LARGE viewport (URL bar hidden) — so on initial load with the URL bar
          visible, the page is taller than the visible area, and when the bar
          hides/shows the container height jumps. svh always reflects the
          currently-visible viewport, so no jump. */}
      <main className="relative flex min-h-svh items-center justify-center py-20">
        <BioLink />
      </main>
    </>
  )
}

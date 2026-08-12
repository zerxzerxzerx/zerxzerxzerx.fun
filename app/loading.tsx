// Route-level loading skeleton. Shown while the segment is streaming or
// suspending, so the page never flashes blank. Mirrors the collapsed BioLink
// layout (heading + primary link + 3 social tiles + 2 info tiles + roblox
// button + pengi button) so the switch to real content doesn't jump.

export default function Loading() {
  return (
    <>
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-grid" />
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-vignette" />
      <main className="relative flex min-h-screen items-center justify-center py-20">
        <div
          aria-hidden
          className="mx-auto flex w-full max-w-sm flex-col items-center gap-7 px-6"
        >
          {/* Heading + tagline */}
          <div className="flex flex-col items-center gap-2">
            <div className="h-7 w-16 animate-pulse rounded-md bg-white/10" />
            <div className="h-3 w-56 animate-pulse rounded bg-white/5" />
            <div className="h-3 w-40 animate-pulse rounded bg-white/5" />
          </div>

          {/* Primary link (Telegram) */}
          <div className="h-14 w-full animate-pulse rounded-2xl bg-bg-raised" />

          {/* Social tiles row */}
          <div className="grid w-full grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-bg-raised" />
            ))}
          </div>

          {/* Info tiles row */}
          <div className="grid w-full grid-cols-2 gap-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-bg-raised" />
            ))}
          </div>

          {/* Roblox button */}
          <div className="h-16 w-full animate-pulse rounded-2xl bg-bg-raised" />

          {/* Pengi button */}
          <div className="h-16 w-full animate-pulse rounded-2xl bg-bg-raised" />
        </div>
        <span className="sr-only">Loading…</span>
      </main>
    </>
  )
}

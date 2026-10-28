// Route-level loading skeleton. Shown while the segment is streaming or
// suspending, so the page never flashes blank. Mirrors the collapsed BioLink
// layout (avatar + name/status + social icon row) so the switch to real
// content doesn't jump.

export default function Loading() {
  return (
    <>
      <main className="relative flex min-h-screen items-center justify-center py-20">
        <div
          aria-hidden
          className="mx-auto flex w-full max-w-sm flex-col items-center gap-6 px-6"
        >
          {/* Avatar */}
          <div className="h-24 w-24 animate-pulse rounded-full bg-bg-raised" />

          {/* Name + status line */}
          <div className="flex flex-col items-center gap-2">
            <div className="h-7 w-20 animate-pulse rounded-md bg-white/10" />
            <div className="h-3 w-44 animate-pulse rounded bg-white/5" />
          </div>

          {/* Social icon row */}
          <div className="flex w-full items-center justify-center gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-12 w-12 animate-pulse rounded-full bg-bg-raised" />
            ))}
          </div>
        </div>
        <span className="sr-only">Loading…</span>
      </main>
    </>
  )
}

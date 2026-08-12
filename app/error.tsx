'use client'

// Root-segment error boundary. Any uncaught throw from a server or client
// component under this segment lands here instead of showing a raw stack or
// blank page. Keep it visually consistent with the rest of the site.
import { useEffect } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Surface the error to whatever telemetry the site eventually adds.
    // console.error keeps it visible in dev without a Sentry hookup yet.
    console.error('[app/error]', error)
  }, [error])

  return (
    <>
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-grid" />
      <main className="relative flex min-h-screen items-center justify-center px-6 py-20">
        <div className="w-full max-w-sm space-y-5 rounded-2xl border border-line bg-bg-card p-6 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20">
            <AlertTriangle size={18} />
          </div>
          <div className="space-y-1.5">
            <h1 className="font-display text-lg font-semibold text-fg">Something went wrong</h1>
            <p className="text-sm leading-relaxed text-fg-muted">
              An unexpected error interrupted this page. You can try again — if it keeps
              happening, refresh or come back in a minute.
            </p>
          </div>
          {error.digest && (
            <div className="rounded-md bg-bg-raised px-3 py-2 font-mono text-[10px] text-fg-muted">
              ref: {error.digest}
            </div>
          )}
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-xl bg-bg-raised px-4 py-2.5 text-sm font-medium text-fg transition-colors duration-200 hover:bg-bg-subtle"
          >
            <RotateCcw size={14} />
            Try again
          </button>
        </div>
      </main>
    </>
  )
}

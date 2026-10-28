// Shared Lanyard presence poller. BioLink.tsx (always-on, for the bio-page
// status badge/Spotify row) and DiscordProfile.tsx (modal-level, started
// only once the profile card is expanded) each independently polled
// `https://api.lanyard.rest/v1/users/{id}` every 15s for the same user with
// no coordination — up to two concurrent pollers hitting the same endpoint
// for the same data whenever the Discord modal's card was expanded. This
// module replaces both call sites with one ref-counted subscription per
// userId: a single shared `setInterval`, a single shared `visibilitychange`
// listener (so polling pauses while the tab is hidden, for every consumer at
// once), and "replay the last known envelope synchronously to a new
// subscriber" semantics — so when the Discord modal's card expands partway
// through BioLink's already-warm poll, it renders real presence data
// immediately instead of flashing its own loading state.
//
// Consumers get the raw Lanyard response envelope and derive whatever
// narrower shape/status they need from it (BioLink just wants a sticky
// `LanyardData | null`; DiscordProfile wants a full
// idle/loading/ok/not-monitored/error state machine) — this module only
// owns the fetch/poll/visibility mechanics, not either consumer's state
// shape.

export type LanyardEnvelope = {
  ok: boolean
  status: number
  data: Record<string, unknown> | null
  errorMessage: string | null
  errorCode: string | null
}

type Subscriber = (envelope: LanyardEnvelope) => void

type Entry = {
  subscribers: Set<Subscriber>
  intervalId: ReturnType<typeof setInterval> | null
  lastEnvelope: LanyardEnvelope | null
  visHandler: (() => void) | null
}

const entries = new Map<string, Entry>()

async function fetchOnce(userId: string): Promise<LanyardEnvelope> {
  try {
    const r = await fetch(`https://api.lanyard.rest/v1/users/${userId}`, { cache: 'no-store' })
    const j = (await r.json().catch(() => null)) as {
      success?: boolean
      data?: Record<string, unknown>
      error?: { message?: string; code?: string }
    } | null
    if (r.ok && j?.success && j.data) {
      return { ok: true, status: r.status, data: j.data, errorMessage: null, errorCode: null }
    }
    const errorMessage = j?.error?.message || `Lanyard returned ${r.status}`
    if (r.status !== 404 && j?.error?.code !== 'user_not_monitored') {
      console.warn('[lanyard] non-ok response:', errorMessage)
    }
    return {
      ok: false,
      status: r.status,
      data: null,
      errorMessage,
      errorCode: j?.error?.code ?? (r.status === 404 ? 'user_not_monitored' : null),
    }
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : 'Network error'
    console.warn('[lanyard] fetch failed:', errorMessage)
    return { ok: false, status: 0, data: null, errorMessage, errorCode: null }
  }
}

function getEntry(userId: string): Entry {
  let entry = entries.get(userId)
  if (!entry) {
    entry = { subscribers: new Set(), intervalId: null, lastEnvelope: null, visHandler: null }
    entries.set(userId, entry)
  }
  return entry
}

function broadcast(userId: string, envelope: LanyardEnvelope) {
  const entry = entries.get(userId)
  if (!entry) return
  entry.lastEnvelope = envelope
  entry.subscribers.forEach((cb) => cb(envelope))
}

function startPolling(userId: string) {
  const entry = getEntry(userId)
  if (entry.intervalId != null) return
  const load = async () => {
    broadcast(userId, await fetchOnce(userId))
  }
  void load()
  entry.intervalId = setInterval(() => void load(), 15_000)
}

function stopPolling(userId: string) {
  const entry = entries.get(userId)
  if (!entry || entry.intervalId == null) return
  clearInterval(entry.intervalId)
  entry.intervalId = null
}

/** Subscribe to a userId's shared Lanyard poll. Returns an unsubscribe
 *  function. Safe to call with an empty userId (no-op subscription). */
export function subscribeLanyard(userId: string, callback: Subscriber): () => void {
  if (!userId) return () => {}

  const entry = getEntry(userId)
  entry.subscribers.add(callback)
  if (entry.lastEnvelope) callback(entry.lastEnvelope)

  if (entry.subscribers.size === 1) {
    const onVis = () => {
      if (document.hidden) stopPolling(userId)
      else startPolling(userId)
    }
    entry.visHandler = onVis
    document.addEventListener('visibilitychange', onVis)
    if (!document.hidden) startPolling(userId)
  }

  return () => {
    entry.subscribers.delete(callback)
    if (entry.subscribers.size === 0) {
      stopPolling(userId)
      if (entry.visHandler) {
        document.removeEventListener('visibilitychange', entry.visHandler)
        entry.visHandler = null
      }
      entries.delete(userId)
    }
  }
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

type Props = {
  title: string
  onClose: () => void
  children: React.ReactNode
  // Suppresses the visible <h2> below while keeping `title` as the dialog's
  // aria-label — for modals (LimitedDetailModal) whose body already repeats
  // the name prominently (icon+name block), so showing it twice was
  // redundant. Opt-in per Modal instance: the top-level Roblox profile modal
  // still needs its visible title, so this must never become the default.
  hideTitle?: boolean
}

// Module-level stack of currently-mounted Modal instances. Needed now that
// a Modal can open another Modal on top of itself (the Roblox profile
// modal's Limiteds tab opens a per-item detail modal) — every mounted
// instance attaches its own `keydown` listener below, so without this an
// Escape press would close *all* of them at once instead of just the
// topmost one. Backdrop clicks don't need the same fix: the topmost
// modal's backdrop is a full-viewport fixed div painted last, so it
// physically intercepts the click before it can reach anything underneath.
let modalStack: number[] = []
let nextModalId = 0

export default function Modal({ title, onClose, children, hideTitle }: Props) {
  // Drives the exit animation: clicking close/backdrop/Escape doesn't
  // unmount immediately, it flips this flag to play `.modal-panel-exit`,
  // then `onClose` (the actual unmount) fires from `onAnimationEnd` below
  // once that animation finishes — so the unmount timing can never drift
  // from how long the animation actually played, including under
  // prefers-reduced-motion which collapses it to near-zero.
  const [closing, setClosing] = useState(false)
  const requestClose = () => setClosing(true)
  const idRef = useRef<number | null>(null)
  if (idRef.current === null) idRef.current = nextModalId++

  useEffect(() => {
    const id = idRef.current!
    modalStack.push(id)
    const onKey = (e: KeyboardEvent) => {
      // Only the topmost modal in the stack responds to Escape.
      if (e.key === 'Escape' && modalStack[modalStack.length - 1] === id) requestClose()
    }
    document.addEventListener('keydown', onKey)
    // Only lock scroll if the page is actually scrollable. On this biolink
    // the content fits in the viewport, so the lock is unnecessary — and on
    // iOS Safari, toggling body.overflow triggers the URL bar to snap to
    // its fully-collapsed state, which changes the viewport height mid-
    // animation and causes the underlying tiles to visibly reflow while the
    // modal opens. Guarding the lock behind scrollHeight > innerHeight
    // preserves the intended behavior on longer pages while eliminating the
    // mobile URL-bar snap on the (typically single-viewport) biolink.
    const needsLock = document.documentElement.scrollHeight > window.innerHeight
    const prevOverflow = document.body.style.overflow
    if (needsLock) document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      modalStack = modalStack.filter((x) => x !== id)
      if (needsLock) document.body.style.overflow = prevOverflow
    }
  }, [])

  // Portaled to document.body instead of rendering in place: the modal was
  // previously a direct child of BioLink's `.bio-enter` root, which applies
  // a CSS keyframe entrance animation (opacity/translateY) to every one of
  // its direct children via `:nth-child`. That CSS animation fought with
  // the panel's own opacity transition on this same element every time a
  // modal opened/closed, producing a visible flicker / flash-then-vanish.
  // Rendering at `document.body` takes the modal out of that subtree
  // entirely.
  return createPortal(
    // No opacity animation on the backdrop itself: fading an opaque black
    // layer from 0 to 1 means it's genuinely semi-transparent for the whole
    // transition, so whatever's behind it (the page's avatar/pfp) shows
    // through and dims over time instead of just... not being there. That
    // read as the pfp "flickering on top" when opening. The backdrop
    // renders at full opacity on the very first frame — only the inner
    // dialog panel (below) animates in, on top of an already-solid
    // background.
    <div
      onClick={requestClose}
      // backdrop-blur-md (12px) is extremely expensive on mobile GPUs — during
      // an opacity fade the browser would re-blur the entire backdrop area
      // every frame, which drops framerate to ~15-20fps on mid-range phones.
      // The perceptible symptom is the underlying page (biolink tiles) visibly
      // flickering / repainting through the semi-transparent backdrop while
      // the modal opens: exactly the "buttons appear disappear reappear" the
      // user reported on mobile-only. The fix is a two-tier blur: mobile gets
      // no blur, tablets+ keep a light 4px blur, desktop keeps the original
      // 12px softness. The `md:` breakpoint (768px) is the standard tablet
      // cutoff in Tailwind.
      //
      // Mobile's no-blur tier is fully opaque (bg-bg, no slash modifier) —
      // any partial transparency over a bright image (the avatar/wing
      // decoration) leaves a visible ghost no matter how high the percentage
      // is tuned; 85% and 95% were both tried and both still showed a trace.
      // Opacity and blur are two different occlusion mechanisms: blur works
      // at <100% opacity because it destroys the high-frequency detail
      // underneath, but opacity alone can only ever *dim* what's behind it,
      // never fully hide it, until it hits 100%. Since mobile has no blur
      // (GPU cost — see above), it needs full opacity instead.
      className="fixed inset-0 z-[60] flex items-center justify-center bg-bg p-6 md:bg-bg/70 md:backdrop-blur-md"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        // See the `modal-panel-in` keyframes in globals.css for why this is
        // a plain CSS animation instead of framer-motion: framer's mount
        // effect doesn't reliably survive React 18 Strict Mode's dev-only
        // double-invoke (confirmed — it can leave the panel stuck at
        // opacity:0 permanently), and its `exit` prop silently no-ops
        // without an AnimatePresence ancestor. `closing` here switches which
        // keyframe animation plays; `onAnimationEnd` below fires the real
        // unmount only once that animation has actually finished playing.
        className={`w-full max-w-md rounded-2xl border border-line bg-bg-card p-6 shadow-2xl ${
          closing ? 'modal-panel-exit' : 'modal-panel-enter'
        }`}
        onAnimationEnd={(e) => {
          if (closing && e.target === e.currentTarget) onClose()
        }}
      >
        <div className="mb-5 flex items-center justify-between">
          {!hideTitle && <h2 className="font-display text-lg font-semibold text-fg">{title}</h2>}
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            className={`rounded-md p-1 text-fg-muted transition-colors hover:bg-bg-raised hover:text-fg ${
              hideTitle ? 'ml-auto' : ''
            }`}
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  )
}

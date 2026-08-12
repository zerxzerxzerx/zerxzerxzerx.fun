'use client'

import { useEffect } from 'react'
import { m, useReducedMotion } from 'framer-motion'
import { X } from 'lucide-react'

type Props = {
  title: string
  onClose: () => void
  children: React.ReactNode
}

export default function Modal({ title, onClose, children }: Props) {
  const shouldReduce = useReducedMotion()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  // Reduced-motion users get pure opacity fades — no scale pop.
  const panelInitial = shouldReduce ? { opacity: 0 } : { opacity: 0, scale: 0.97 }
  const panelAnimate = shouldReduce ? { opacity: 1 } : { opacity: 1, scale: 1 }
  const panelExit = shouldReduce ? { opacity: 0 } : { opacity: 0, scale: 0.97 }

  return (
    <m.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-bg/70 p-6 backdrop-blur-md"
    >
      <m.div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        initial={panelInitial}
        animate={panelAnimate}
        exit={panelExit}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        style={{ willChange: 'transform, opacity', transformOrigin: 'center' }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-line bg-bg-card p-6 shadow-2xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-fg">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-fg-muted transition-colors hover:bg-bg-raised hover:text-fg"
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </m.div>
    </m.div>
  )
}

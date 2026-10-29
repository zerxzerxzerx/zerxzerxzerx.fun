import type { Config } from 'tailwindcss'
import plugin from 'tailwindcss/plugin'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#000000',
          card: '#0e0e0e',
          raised: '#131313',
          subtle: '#1a1a1a',
        },
        accent: {
          DEFAULT: '#F5F5F5',
          dim: '#A1A1A1',
        },
        line: {
          subtle: 'rgba(255, 255, 255, 0.06)',
          DEFAULT: 'rgba(255, 255, 255, 0.10)',
          strong: 'rgba(255, 255, 255, 0.16)',
        },
        fg: {
          DEFAULT: '#F5F5F5',
          muted: '#A1A1A1',
          faint: '#666666',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'Space Grotesk', 'sans-serif'],
        body: ['var(--font-body)', 'Inter', 'sans-serif'],
        mono: ['var(--font-mono)', 'JetBrains Mono', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 8px 24px rgba(0, 0, 0, 0.4)',
        glow: '0 0 40px rgba(255, 255, 255, 0.08)',
      },
    },
  },
  plugins: [
    // Tailwind's default `hover:` variant compiles to a plain `&:hover`
    // selector, which iOS/iPadOS Safari (and Android Chrome, to a lesser
    // extent) latches on tap — the element stays visually "hovered" until
    // the user taps something else, which reads as random flicker/stuck
    // highlights on touch. Re-scoping every `hover:` utility site-wide to
    // `@media (hover: hover)` means it only ever applies on devices with a
    // true hovering pointer (mouse/trackpad); touch-only devices get no
    // hover state at all, which is the correct behavior and matches the
    // intent of the (previously inverted) rule this replaces in globals.css.
    // On desktop/PC this is a no-op — `(hover: hover)` is already true
    // there, so the compiled output is unchanged.
    plugin(({ addVariant }) => {
      addVariant('hover', '@media (hover: hover) { &:hover }')
    }),
  ],
}

export default config

import { Wallet, type LucideProps } from 'lucide-react'
import {
  SiTelegram,
  SiTiktok,
  SiDiscord,
  SiRoblox,
} from '@icons-pack/react-simple-icons'
import type { ComponentType, SVGProps } from 'react'

export type IconProps = LucideProps & SVGProps<SVGSVGElement>

export type IconKey = 'telegram' | 'tiktok' | 'discord' | 'roblox' | 'wallet'

const ICONS: Record<IconKey, ComponentType<IconProps>> = {
  telegram: SiTelegram as ComponentType<IconProps>,
  tiktok: SiTiktok as ComponentType<IconProps>,
  discord: SiDiscord as ComponentType<IconProps>,
  roblox: SiRoblox as ComponentType<IconProps>,
  // Plain lucide glyph, not a brand mark — this button opens the wallet
  // modal rather than linking out to a specific chain/app's own page.
  wallet: Wallet as ComponentType<IconProps>,
}

type IconComponentProps = IconProps & { name: IconKey }

export function Icon({ name, ...rest }: IconComponentProps) {
  const Component = ICONS[name]
  return <Component aria-hidden="true" focusable="false" {...rest} />
}

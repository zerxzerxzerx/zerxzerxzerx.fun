import {
  ArrowRightLeft,
  BarChart2,
  Globe,
  HardDrive,
  Layers,
  Lock,
  ScanLine,
  ShieldCheck,
  Shirt,
  ShoppingCart,
  TrendingUp,
  Utensils,
  Zap,
  type LucideProps,
} from 'lucide-react'
import {
  SiLitecoin,
  SiEthereum,
  SiSolana,
  SiTelegram,
  SiTiktok,
  SiDiscord,
  SiGithub,
} from '@icons-pack/react-simple-icons'
import type { ComponentType, SVGProps } from 'react'

export type IconProps = LucideProps & SVGProps<SVGSVGElement>

export type IconKey =
  | 'trending-up'
  | 'zap'
  | 'shield-check'
  | 'globe'
  | 'lock'
  | 'bar-chart'
  | 'hard-drive'
  | 'arrow-right-left'
  | 'layers'
  | 'scan-line'
  | 'utensils'
  | 'shopping-cart'
  | 'shirt'
  | 'litecoin'
  | 'ethereum'
  | 'solana'
  | 'telegram'
  | 'tiktok'
  | 'discord'
  | 'github'

const ICONS: Record<IconKey, ComponentType<IconProps>> = {
  'trending-up': TrendingUp,
  zap: Zap,
  'shield-check': ShieldCheck,
  globe: Globe,
  lock: Lock,
  'bar-chart': BarChart2,
  'hard-drive': HardDrive,
  'arrow-right-left': ArrowRightLeft,
  layers: Layers,
  'scan-line': ScanLine,
  utensils: Utensils,
  'shopping-cart': ShoppingCart,
  shirt: Shirt,
  litecoin: SiLitecoin as ComponentType<IconProps>,
  ethereum: SiEthereum as ComponentType<IconProps>,
  solana: SiSolana as ComponentType<IconProps>,
  telegram: SiTelegram as ComponentType<IconProps>,
  tiktok: SiTiktok as ComponentType<IconProps>,
  discord: SiDiscord as ComponentType<IconProps>,
  github: SiGithub as ComponentType<IconProps>,
}

type IconComponentProps = IconProps & { name: IconKey }

export function Icon({ name, ...rest }: IconComponentProps) {
  const Component = ICONS[name]
  return <Component aria-hidden="true" focusable="false" {...rest} />
}

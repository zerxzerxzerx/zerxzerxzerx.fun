export const ZERX = {
  handle: 'zerx',
  headline: 'Rigged in my favor.',
  sub: 'Delivery orders placed at up to 70% off retail. Members only, through discord.gg/feast. Running since 2021.',
  since: '2021',
  timezone: 'GMT',
  discordId: '1464080203868541016',
  githubUsername: 'zerxzerxzerx',
  // Manually maintained — GitHub's public /users API doesn't expose private
  // repo counts, so this is the number to display alongside public stats.
  githubPrivateRepos: 22,
  tiktokUsername: 'zerxful',
  // Public Roblox handle — the API route resolves this to a userId, then
  // fans out to profile / presence / friend counts / badges / groups / avatar
  // thumbnails in parallel. If the username ever changes, only this string
  // needs to update.
  robloxUsername: 'vitorharu',
  feastInvite: 'https://discord.gg/feast',
  socials: {
    telegram: 'https://t.me/zerxlol',
    tiktok: 'https://www.tiktok.com/@zerxful',
    github: 'https://github.com/zerxzerxzerx',
    discord: 'https://discord.com/users/zerx',
  },
  bio: ["Hi, I'm zerx. I love gambling."],
} as const

export const HERO_STATS: { value: string; label: string }[] = [
  { value: 'Since 2021', label: 'operating' },
  { value: '<15min', label: 'avg. reply' },
  { value: '0', label: 'disputes' },
  { value: 'GMT', label: 'timezone' },
]

export type AssetChip = { iconKey: 'litecoin' | 'ethereum' | 'solana'; label: string }
export const ASSETS: AssetChip[] = [
  { iconKey: 'litecoin', label: 'LTC' },
  { iconKey: 'ethereum', label: 'ETH' },
  { iconKey: 'solana', label: 'SOL' },
]

export type Capability = {
  iconKey: 'shield-check' | 'arrow-right-left' | 'lock' | 'zap' | 'utensils' | 'shopping-cart' | 'shirt'
  title: string
  body: string
}

export const CAPABILITIES: Capability[] = [
  {
    iconKey: 'utensils',
    title: 'Wholesale Rates',
    body: 'Delivery orders placed at up to 70% off retail across the major food sites. Rates hold across breakfast, lunch, and late night windows.',
  },
  {
    iconKey: 'shopping-cart',
    title: 'Groceries',
    body: 'Full grocery runs from the major chains at the same 70% off. Weekly staples, bulk carts, no per-item markup.',
  },
  {
    iconKey: 'shirt',
    title: 'Apparel & Fragrance',
    body: 'Sneakers, clothing, and cologne from mainstream retailers, also 70% off. Larger orders take a slightly higher fee. Discount holds either way.',
  },
]

export type PresenceItem = {
  iconKey: 'telegram' | 'tiktok' | 'discord' | 'github'
  platform: string
  status: 'Active' | 'Selective' | 'Public'
  description: string
  url?: string
}

export const PRESENCE_ITEMS: PresenceItem[] = [
  {
    iconKey: 'telegram',
    platform: 'Telegram',
    status: 'Active',
    description: 'Primary channel. Deals and inquiries.',
    url: 'https://t.me/zerxlol',
  },
  {
    iconKey: 'tiktok',
    platform: 'TikTok',
    status: 'Active',
    description: 'Clips and market notes.',
    url: 'https://www.tiktok.com/@zerxful',
  },
  {
    iconKey: 'discord',
    platform: 'Discord',
    status: 'Selective',
    description: 'Invite only.',
  },
  {
    iconKey: 'github',
    platform: 'GitHub',
    status: 'Public',
    description: 'Side builds and tooling.',
    url: 'https://github.com/zerxzerxzerx',
  },
]


// Public wallet addresses — safe to ship to the browser via /api/networth.
// Matches the ZerxHub bot's config/wallets.json.
export const WALLETS = {
  LTC: 'LTyNCUY2K9PXjRKb2KWVMBAEA7kqkLFkWC',
  ETH: '0xe82aB4f8B49ab4EFe4C72CF0346E8F1e58D0a356',
  SOL: 'FfuzV1GzM6fbXtsUUTdmtaXUFKZvVvtqQJUB5h912scR',
} as const

export type Chain = keyof typeof WALLETS
export const CHAINS: Chain[] = ['LTC', 'ETH', 'SOL']

export type CoinMeta = {
  id: string
  name: string
  symbol: string
  icon: string
  color: string
  explorerAddr: (addr: string) => string
}

export const COIN_META: Record<Chain, CoinMeta> = {
  LTC: {
    id: 'litecoin',
    name: 'Litecoin',
    symbol: 'LTC',
    icon: '/coins/ltc.png',
    color: '#345D9D',
    explorerAddr: (a) => `https://litecoinspace.org/address/${a}`,
  },
  ETH: {
    id: 'ethereum',
    name: 'Ethereum',
    symbol: 'ETH',
    icon: '/coins/eth.png',
    color: '#627EEA',
    explorerAddr: (a) => `https://etherscan.io/address/${a}`,
  },
  SOL: {
    id: 'solana',
    name: 'Solana',
    symbol: 'SOL',
    icon: '/coins/sol.png',
    color: '#14F195',
    explorerAddr: (a) => `https://solscan.io/account/${a}`,
  },
}

// Server-side cache window. Wallet balance + CoinGecko markets get revalidated
// at this cadence so a hot API instance serves cached data instantly and only
// hits upstream once per window.
export const REFRESH_SECONDS = 600

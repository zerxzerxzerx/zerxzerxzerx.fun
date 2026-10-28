// Server-only wallet config. Never import this file from a 'use client'
// component — the address below is intentionally kept out of anything that
// ships to the browser (see app/api/wallet/portfolio/route.ts, which reads
// this module and returns only a scrubbed summary). There's no public
// constant for it anywhere in lib/constants.ts on purpose.
//
// WALLET_ADDRESS is read from an env var with the known-good address as a
// literal fallback so the feature keeps working in dev without requiring a
// .env.local edit — it's a public Ethereum address (not a secret, anyone
// who finds it could already look it up on Etherscan directly), the thing
// actually worth protecting is *this site* not casually handing it out.
export const WALLET_ADDRESS = (
  process.env.WALLET_ADDRESS || '0xfa300AAAA93e3bC8DC05791911EB72232a105929'
).toLowerCase()

export type TokenConfig = {
  symbol: string
  name: string
  address: string
  decimals: number
  coingeckoId: string
  color: string
}

// Both USDT and USDC use 6 decimals on Ethereum mainnet (verified against
// Etherscan's own `tokenDecimal` field for this wallet's real transfers).
export const TOKENS: TokenConfig[] = [
  {
    symbol: 'USDT',
    name: 'Tether USD',
    address: '0xdAC17F958D2ee523a2206206994597C13D831ec7'.toLowerCase(),
    decimals: 6,
    coingeckoId: 'tether',
    color: '#26A17B',
  },
  {
    symbol: 'USDC',
    name: 'USD Coin',
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'.toLowerCase(),
    decimals: 6,
    coingeckoId: 'usd-coin',
    color: '#2775CA',
  },
]

export const ETHERSCAN_KEY = process.env.ETHERSCAN_KEY || ''

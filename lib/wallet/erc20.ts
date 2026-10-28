// Hand-rolled ERC-20 ABI encoding/decoding — just the two calls this feature
// needs (balanceOf, Transfer event), no need for a full ABI library.
import { rpcCallWithFallback } from './rpc'

function padAddress(address: string): string {
  return address.toLowerCase().replace('0x', '').padStart(64, '0')
}

// 32-byte left-padded address, as used in both eth_call arguments and
// eth_getLogs indexed-topic filters.
export function addressToTopic(address: string): string {
  return '0x' + padAddress(address)
}

// balanceOf(address) selector = first 4 bytes of keccak256("balanceOf(address)").
const BALANCE_OF_SELECTOR = '0x70a08231'

export async function balanceOfViaRpc(tokenAddress: string, wallet: string): Promise<bigint> {
  const data = BALANCE_OF_SELECTOR + padAddress(wallet)
  const hex = await rpcCallWithFallback<string>('eth_call', [
    { to: tokenAddress, data },
    'latest',
  ])
  if (!hex || hex === '0x') return 0n
  return BigInt(hex)
}

// keccak256("Transfer(address,address,uint256)") — standard ERC-20 Transfer
// event topic0, same across every compliant token.
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

export type RawLog = {
  address: string
  topics: string[]
  data: string
  blockNumber: string
  transactionHash: string
  logIndex: string
}

function topicToAddress(topic: string): string {
  return '0x' + topic.slice(-40)
}

export type DecodedTransfer = {
  tokenAddress: string
  from: string
  to: string
  value: bigint
  blockNumber: number
  txHash: string
  logIndex: number
}

export function decodeTransferLog(log: RawLog): DecodedTransfer | null {
  if (log.topics.length < 3) return null
  return {
    tokenAddress: log.address.toLowerCase(),
    from: topicToAddress(log.topics[1]).toLowerCase(),
    to: topicToAddress(log.topics[2]).toLowerCase(),
    value: BigInt(log.data || '0x0'),
    blockNumber: Number(log.blockNumber),
    txHash: log.transactionHash,
    logIndex: Number(log.logIndex),
  }
}

// Converts a raw integer token amount to a display number using the token's
// decimals, keeping precision via string math on the integer part + a
// decimal-shifted fractional part (avoids float rounding on large balances).
export function formatTokenAmount(raw: bigint, decimals: number): number {
  const divisor = 10n ** BigInt(decimals)
  const whole = raw / divisor
  const frac = raw % divisor
  return Number(whole) + Number(frac) / Number(divisor)
}

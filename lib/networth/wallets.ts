// Port of ZerxHub's lib/wallets.js — TypeScript + Next.js-cache-aware.
// Each fetcher returns a normalized WalletData: current balance in native units,
// plus a tx history array (used later by the backfill reconstructor to draw
// historical portfolio value).
//
// Every exported dispatcher wraps itself with `swr()` — a fresh hit is a
// no-op, a stale hit serves cached + refreshes in the background. That way
// the /api/networth route rarely actually hits upstream, and when it does
// it's spread out enough to stay under rate limits.
import { getJSON, postJSON } from './http'
import { REFRESH_SECONDS } from './config'
import { swr, throttleEtherscan } from './cache'

// Wallet balance / small-tx-list cache: 60s fresh, 10min stale. Live modal
// wants recent numbers, but upstream 429s / timeouts must never blank us.
const WALLET_LIVE = { freshMs: 60_000, staleMs: 10 * 60_000 }
// Long tx histories used by the backfill reconstructor rarely change (500
// txs is deep enough that only a new tx invalidates it). 15min fresh, 1h
// stale keeps the chart drawing during transient upstream issues.
const WALLET_BACKFILL = { freshMs: 15 * 60_000, staleMs: 60 * 60_000 }

// Backfill callers ask for a much bigger tx window than live callers, so we
// key on limit and pick the appropriate TTL bucket.
function walletOpts(limit: number) {
  return limit >= 100 ? WALLET_BACKFILL : WALLET_LIVE
}

export type WalletTx = {
  hash: string
  time: number | null // unix seconds
  amount: number | null // signed native units, positive = inbound
}

export type WalletData = {
  balance: number
  received: number | null
  sent: number | null
  txs: WalletTx[]
}

// ---------- LTC ----------
// Blockchair is the primary source, litecoinspace fallback covers the odd
// blockchair outage or per-address rate cap.
async function loadLtc(addr: string, txLimit: number): Promise<WalletData> {
  try {
    return await fetchLtcBlockchair(addr, txLimit)
  } catch {
    return await fetchLtcMempool(addr, txLimit)
  }
}

export function fetchLtc(addr: string, txLimit = 3): Promise<WalletData> {
  return swr(`ltc:${addr}:${txLimit}`, walletOpts(txLimit), () => loadLtc(addr, txLimit))
}

type BlockchairLtc = {
  data?: Record<
    string,
    {
      address?: { balance?: number; received?: number; spent?: number }
      transactions?: string[]
    }
  >
}

async function fetchLtcBlockchair(addr: string, txLimit: number): Promise<WalletData> {
  const url = `https://api.blockchair.com/litecoin/dashboards/address/${addr}?limit=${txLimit}`
  const data = await getJSON<BlockchairLtc>(url, { timeoutMs: 6000, revalidate: REFRESH_SECONDS })
  const entry = data?.data?.[addr]
  if (!entry?.address) throw new Error('No data for address')
  const a = entry.address
  const balance = (a.balance ?? 0) / 1e8
  const received = (a.received ?? 0) / 1e8
  const sent = (a.spent ?? 0) / 1e8
  const txHashes = entry.transactions?.slice(0, txLimit) ?? []
  const txs: WalletTx[] = txHashes.map((hash) => ({ hash, time: null, amount: null }))
  return { balance, received, sent, txs }
}

type MempoolLtcInfo = {
  chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number }
}
type MempoolLtcTx = {
  txid: string
  status?: { block_time?: number }
  vin?: { prevout?: { scriptpubkey_address?: string; value?: number } }[]
  vout?: { scriptpubkey_address?: string; value?: number }[]
}

export function fetchLtcMempool(addr: string, txLimit: number): Promise<WalletData> {
  return swr(`ltc-mempool:${addr}:${txLimit}`, walletOpts(txLimit), () =>
    loadLtcMempool(addr, txLimit),
  )
}

// litecoinspace's /txs endpoint caps at ~50 (25 confirmed + up to 25 mempool)
// and ignores higher limits. That's fine for the live modal (txLimit=3) but
// truncates the backfill window — an active wallet's 50th tx might only be
// two weeks back, capping the 30d chart. When the caller wants more we walk
// the /chain/{txid} pagination (25 confirmed txs per page) until we have
// enough or hit an upper bound.
const LTC_CHAIN_PAGE_SIZE = 25
const LTC_MAX_PAGES = 20 // 20 * 25 + 50 first-page ≈ 550 txs, plenty for 30d

async function loadLtcMempool(addr: string, txLimit: number): Promise<WalletData> {
  const base = 'https://litecoinspace.org/api'
  const [info, firstPage] = await Promise.all([
    getJSON<MempoolLtcInfo>(`${base}/address/${addr}`, { revalidate: REFRESH_SECONDS }),
    getJSON<MempoolLtcTx[]>(`${base}/address/${addr}/txs`, { revalidate: REFRESH_SECONDS }),
  ])
  const funded = info?.chain_stats?.funded_txo_sum ?? 0
  const spent = info?.chain_stats?.spent_txo_sum ?? 0
  const balance = (funded - spent) / 1e8
  const received = funded / 1e8
  const sent = spent / 1e8

  const collected: MempoolLtcTx[] = Array.isArray(firstPage) ? [...firstPage] : []
  let pages = 0
  while (collected.length < txLimit && pages < LTC_MAX_PAGES) {
    // Anchor pagination on the oldest CONFIRMED tx we've seen — /chain/{txid}
    // only walks confirmed history, so a trailing mempool tx would 404.
    let anchor: string | undefined
    for (let i = collected.length - 1; i >= 0; i--) {
      if (collected[i].status?.block_time) {
        anchor = collected[i].txid
        break
      }
    }
    if (!anchor) break
    let next: MempoolLtcTx[]
    try {
      next = await getJSON<MempoolLtcTx[]>(
        `${base}/address/${addr}/txs/chain/${anchor}`,
        { revalidate: REFRESH_SECONDS },
      )
    } catch {
      break
    }
    if (!Array.isArray(next) || next.length === 0) break
    collected.push(...next)
    pages++
    // Short-circuit if the page came back partial — we've reached genesis.
    if (next.length < LTC_CHAIN_PAGE_SIZE) break
  }

  const lower = addr.toLowerCase()
  const list = collected.slice(0, txLimit).map<WalletTx>((t) => {
    let delta = 0
    for (const v of t.vout ?? []) {
      if (v.scriptpubkey_address?.toLowerCase() === lower) delta += v.value ?? 0
    }
    for (const v of t.vin ?? []) {
      if (v.prevout?.scriptpubkey_address?.toLowerCase() === lower)
        delta -= v.prevout.value ?? 0
    }
    return {
      hash: t.txid,
      time: t.status?.block_time ?? null,
      amount: delta / 1e8,
    }
  })
  return { balance, received, sent, txs: list }
}

// ---------- ETH ----------
type EtherscanResp<T> = { status?: string; message?: string; result?: T }
type EtherscanTx = { hash: string; timeStamp: string; value: string; from: string; to: string }

export function fetchEth(addr: string, txLimit = 3): Promise<WalletData> {
  return swr(`eth:${addr}:${txLimit}`, walletOpts(txLimit), () => loadEth(addr, txLimit))
}

async function loadEth(addr: string, txLimit: number): Promise<WalletData> {
  const key = process.env.ETHERSCAN_KEY
  if (!key) throw new Error('ETHERSCAN_KEY not set')
  const base = 'https://api.etherscan.io/v2/api?chainid=1'
  const balanceUrl = `${base}&module=account&action=balance&address=${addr}&tag=latest&apikey=${key}`
  const txUrl = `${base}&module=account&action=txlist&address=${addr}&startblock=0&endblock=99999999&page=1&offset=${txLimit}&sort=desc&apikey=${key}`
  // Serialize Etherscan calls through the shared queue — free tier is 3-5/s
  // and cold starts fire balance + txlist for both the live (limit=3) and
  // backfill (limit=500) variants together, which is enough to trip it.
  const balRes = await throttleEtherscan(() =>
    getJSON<EtherscanResp<string>>(balanceUrl, { revalidate: REFRESH_SECONDS }),
  )
  const txRes = await throttleEtherscan(() =>
    getJSON<EtherscanResp<EtherscanTx[]>>(txUrl, { revalidate: REFRESH_SECONDS }),
  )
  if (balRes?.status === '0' && balRes?.message !== 'No transactions found') {
    throw new Error(String(balRes.result || balRes.message || 'Etherscan error'))
  }
  const balance = Number(balRes?.result ?? 0) / 1e18
  const rawTxs = Array.isArray(txRes?.result) ? txRes.result : []
  const lower = addr.toLowerCase()
  const txs: WalletTx[] = rawTxs.slice(0, txLimit).map((t) => {
    const sign = t.from?.toLowerCase() === lower ? -1 : 1
    return {
      hash: t.hash,
      time: Number(t.timeStamp) || null,
      amount: sign * (Number(t.value) / 1e18),
    }
  })
  return { balance, received: null, sent: null, txs }
}

// ---------- SOL ----------
type HeliusTx = {
  signature: string
  timestamp?: number
  nativeTransfers?: { fromUserAccount?: string; toUserAccount?: string; amount?: number }[]
}
type SolBalResp = { result?: { value?: number } }
type SolSigResp = { result?: { signature: string; blockTime?: number }[] }

const SOL_RPC = 'https://api.mainnet-beta.solana.com'

export function fetchSol(addr: string, txLimit = 3): Promise<WalletData> {
  return swr(`sol:${addr}:${txLimit}`, walletOpts(txLimit), () => loadSol(addr, txLimit))
}

async function loadSol(addr: string, txLimit: number): Promise<WalletData> {
  if (process.env.HELIUS_KEY) {
    try {
      return await fetchSolHelius(addr, txLimit)
    } catch {
      // fall through to public RPC
    }
  }
  return fetchSolPublic(addr, txLimit)
}

// Helius's /v0/.../balances endpoint was deprecated (returns 404 "Method not
// found"), so pull balance from the public RPC and use Helius only for the tx
// history — that's where the value is anyway, since it returns real signed
// amounts per tx (public RPC's getSignaturesForAddress only returns hashes).
// The /transactions endpoint caps limit at 100 (400s above that), which is
// fine for our use — 100 txs is deep enough for the 30-day backfill window.
const HELIUS_TX_MAX = 100
async function fetchSolHelius(addr: string, txLimit: number): Promise<WalletData> {
  const key = process.env.HELIUS_KEY
  const limit = Math.min(txLimit, HELIUS_TX_MAX)
  const txUrl = `https://api.helius.xyz/v0/addresses/${addr}/transactions?limit=${limit}&api-key=${key}`
  const [balRes, txRes] = await Promise.all([
    postJSON<SolBalResp>(
      SOL_RPC,
      { jsonrpc: '2.0', id: 1, method: 'getBalance', params: [addr] },
      { revalidate: REFRESH_SECONDS },
    ),
    getJSON<HeliusTx[]>(txUrl, { revalidate: REFRESH_SECONDS }),
  ])
  const balance = (balRes?.result?.value ?? 0) / 1e9
  const txs: WalletTx[] = (Array.isArray(txRes) ? txRes : []).map((t) => {
    const transfer = t.nativeTransfers?.find(
      (n) => n.fromUserAccount === addr || n.toUserAccount === addr,
    )
    let amount: number | null = null
    if (transfer?.amount != null) {
      const sign = transfer.fromUserAccount === addr ? -1 : 1
      amount = (sign * transfer.amount) / 1e9
    }
    return { hash: t.signature, time: t.timestamp ?? null, amount }
  })
  return { balance, received: null, sent: null, txs }
}

async function fetchSolPublic(addr: string, txLimit: number): Promise<WalletData> {
  const [balRes, sigRes] = await Promise.all([
    postJSON<SolBalResp>(
      SOL_RPC,
      { jsonrpc: '2.0', id: 1, method: 'getBalance', params: [addr] },
      { revalidate: REFRESH_SECONDS },
    ),
    postJSON<SolSigResp>(
      SOL_RPC,
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'getSignaturesForAddress',
        params: [addr, { limit: txLimit }],
      },
      { revalidate: REFRESH_SECONDS },
    ),
  ])
  const balance = (balRes?.result?.value ?? 0) / 1e9
  const txs: WalletTx[] = (sigRes?.result ?? []).map((s) => ({
    hash: s.signature,
    time: s.blockTime ?? null,
    amount: null,
  }))
  return { balance, received: null, sent: null, txs }
}

// ---------- Dispatch ----------
export const FETCHERS = { LTC: fetchLtc, ETH: fetchEth, SOL: fetchSol } as const

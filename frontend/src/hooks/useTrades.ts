import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { parseAbiItem, type Address } from 'viem'

const curveBuy = parseAbiItem(
  'event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)',
)
const curveSell = parseAbiItem(
  'event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)',
)
const transfer = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')

export interface Trade {
  side: 'buy' | 'sell'
  account: Address
  quote: bigint
  tokens: bigint
  block: bigint
  timestamp: number
  tx: `0x${string}`
}

export function useTrades(curve: Address | undefined, fromBlock: bigint | undefined) {
  const client = usePublicClient()
  return useQuery({
    queryKey: ['trades', curve],
    enabled: !!client && !!curve && fromBlock !== undefined,
    refetchInterval: 3_000,
    queryFn: async (): Promise<Trade[]> => {
      if (!client || !curve || fromBlock === undefined) return []
      const [buys, sells] = await Promise.all([
        client.getLogs({ address: curve, event: curveBuy, fromBlock, toBlock: 'latest' }),
        client.getLogs({ address: curve, event: curveSell, fromBlock, toBlock: 'latest' }),
      ])
      const blocks = [...new Set([...buys, ...sells].map((l) => l.blockNumber))]
      const ts = new Map(
        await Promise.all(
          blocks.map(async (b) => [b, Number((await client.getBlock({ blockNumber: b })).timestamp)] as const),
        ),
      )
      const trades: Trade[] = [
        ...buys.map((l) => ({
          side: 'buy' as const,
          account: l.args.recipient!,
          quote: l.args.quoteIn!,
          tokens: l.args.tokensOut!,
          block: l.blockNumber,
          timestamp: ts.get(l.blockNumber) ?? 0,
          tx: l.transactionHash,
        })),
        ...sells.map((l) => ({
          side: 'sell' as const,
          account: l.args.recipient!,
          quote: l.args.quoteOut!,
          tokens: l.args.tokensIn!,
          block: l.blockNumber,
          timestamp: ts.get(l.blockNumber) ?? 0,
          tx: l.transactionHash,
        })),
      ]
      return trades.sort((a, b) => (a.block === b.block ? 0 : a.block > b.block ? -1 : 1))
    },
  })
}

export interface CurveActivity {
  /** unix seconds of the most recent buy */
  lastBuy: number
  /** every trade on the curve as (timestamp, quote amount in base units) */
  trades: { ts: number; quote: bigint }[]
}

/** All curve trades on the deployment, grouped by curve — feeds the Explore sort/time filters. */
export function useActivity(fromBlock: bigint | undefined) {
  const client = usePublicClient()
  return useQuery({
    queryKey: ['activity', fromBlock?.toString()],
    enabled: !!client && fromBlock !== undefined,
    refetchInterval: 5_000,
    queryFn: async (): Promise<Map<string, CurveActivity>> => {
      const out = new Map<string, CurveActivity>()
      if (!client || fromBlock === undefined) return out
      const [buys, sells] = await Promise.all([
        client.getLogs({ event: curveBuy, fromBlock, toBlock: 'latest' }),
        client.getLogs({ event: curveSell, fromBlock, toBlock: 'latest' }),
      ])
      const blocks = [...new Set([...buys, ...sells].map((l) => l.blockNumber))]
      const ts = new Map(
        await Promise.all(
          blocks.map(async (b) => [b, Number((await client.getBlock({ blockNumber: b })).timestamp)] as const),
        ),
      )
      const bump = (curve: Address) => {
        const k = curve.toLowerCase()
        let a = out.get(k)
        if (!a) out.set(k, (a = { lastBuy: 0, trades: [] }))
        return a
      }
      for (const l of buys) {
        const a = bump(l.address)
        const t = ts.get(l.blockNumber) ?? 0
        a.lastBuy = Math.max(a.lastBuy, t)
        a.trades.push({ ts: t, quote: l.args.quoteIn! })
      }
      for (const l of sells) bump(l.address).trades.push({ ts: ts.get(l.blockNumber) ?? 0, quote: l.args.quoteOut! })
      return out
    },
  })
}

export interface Holder {
  account: Address
  balance: bigint
}

/** Holder balances rebuilt from Transfer logs (fine for a dev deployment; an indexer would replace this). */
export function useHolders(token: Address | undefined, fromBlock: bigint | undefined) {
  const client = usePublicClient()
  return useQuery({
    queryKey: ['holders', token],
    enabled: !!client && !!token && fromBlock !== undefined,
    refetchInterval: 5_000,
    queryFn: async (): Promise<Holder[]> => {
      if (!client || !token || fromBlock === undefined) return []
      const logs = await client.getLogs({ address: token, event: transfer, fromBlock, toBlock: 'latest' })
      const bal = new Map<string, bigint>()
      for (const l of logs) {
        const from = l.args.from!.toLowerCase()
        const to = l.args.to!.toLowerCase()
        const v = l.args.value!
        bal.set(from, (bal.get(from) ?? 0n) - v)
        bal.set(to, (bal.get(to) ?? 0n) + v)
      }
      return [...bal.entries()]
        .filter(([a, b]) => b > 0n && a !== '0x0000000000000000000000000000000000000000')
        .map(([account, balance]) => ({ account: account as Address, balance }))
        .sort((a, b) => (a.balance === b.balance ? 0 : a.balance > b.balance ? -1 : 1))
    },
  })
}

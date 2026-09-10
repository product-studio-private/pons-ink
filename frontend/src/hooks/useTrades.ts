import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { parseAbiItem, type Address } from 'viem'

const curveBuy = parseAbiItem(
  'event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)',
)
const curveSell = parseAbiItem(
  'event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)',
)

export interface Trade {
  side: 'buy' | 'sell'
  account: Address
  quote: bigint
  tokens: bigint
  block: bigint
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
      const trades: Trade[] = [
        ...buys.map((l) => ({
          side: 'buy' as const,
          account: l.args.recipient!,
          quote: l.args.quoteIn!,
          tokens: l.args.tokensOut!,
          block: l.blockNumber,
          tx: l.transactionHash,
        })),
        ...sells.map((l) => ({
          side: 'sell' as const,
          account: l.args.recipient!,
          quote: l.args.quoteOut!,
          tokens: l.args.tokensIn!,
          block: l.blockNumber,
          tx: l.transactionHash,
        })),
      ]
      return trades.sort((a, b) => (a.block === b.block ? 0 : a.block > b.block ? -1 : 1))
    },
  })
}

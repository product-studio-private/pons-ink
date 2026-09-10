import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { parseAbiItem, type Address } from 'viem'
import { deployment } from '../lib/deployment'
import { BondingCurveAbi, LaunchFactoryAbi, LauncherTokenAbi } from '../generated/abis'

export const tokenLaunchedEvent = parseAbiItem(
  'event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)',
)

export interface Launch {
  token: Address
  curve: Address
  deployer: Address
  creatorFeeRecipient: Address
  name: string
  symbol: string
  logo: string
  description: string
  phase: number
  quoteReserve: bigint
  tokenReserve: bigint
  realQuote: bigint
  sellable: bigint
  threshold: bigint
  feeBps: bigint
  creatorTaxBps: bigint
  launchedAt: bigint
  launchBlock: bigint
  supply: bigint
  poolFee: number
  tickSpacing: number
  buybackEnabled: boolean
  sweptQuote: bigint
  sweptTokens: bigint
}

export function useLaunches() {
  const client = usePublicClient()
  return useQuery({
    queryKey: ['launches', deployment?.factory],
    enabled: !!client && !!deployment,
    refetchInterval: 3_000,
    queryFn: async (): Promise<Launch[]> => {
      if (!client || !deployment) return []
      const logs = await client.getLogs({
        address: deployment.factory,
        event: tokenLaunchedEvent,
        fromBlock: BigInt(deployment.startBlock),
        toBlock: 'latest',
      })
      if (logs.length === 0) return []

      const factory = deployment.factory
      const reads = logs.flatMap((l) => {
        const token = l.args.token!
        const curve = l.args.curve!
        return [
          { address: token, abi: LauncherTokenAbi, functionName: 'name' },
          { address: token, abi: LauncherTokenAbi, functionName: 'symbol' },
          { address: token, abi: LauncherTokenAbi, functionName: 'logo' },
          { address: token, abi: LauncherTokenAbi, functionName: 'description' },
          { address: token, abi: LauncherTokenAbi, functionName: 'totalSupply' },
          { address: curve, abi: BondingCurveAbi, functionName: 'getReserves' },
          { address: curve, abi: BondingCurveAbi, functionName: 'realQuoteReserve' },
          { address: curve, abi: BondingCurveAbi, functionName: 'sellableTokens' },
          { address: curve, abi: BondingCurveAbi, functionName: 'feeBps' },
          { address: curve, abi: BondingCurveAbi, functionName: 'launchedAt' },
          { address: factory, abi: LaunchFactoryAbi, functionName: 'getLaunchedToken', args: [token] },
        ] as const
      })
      const res = await client.multicall({ contracts: reads, allowFailure: false })

      const N = 11
      return logs
        .map((l, i) => {
          const r = res.slice(i * N, (i + 1) * N)
          const [quoteReserve, tokenReserve] = r[5] as readonly [bigint, bigint]
          const lt = r[10] as {
            deployer: Address
            creatorFeeRecipient: Address
            graduationThreshold: bigint
            poolFee: number
            tickSpacing: number
            creatorTaxBps: number
            buybackEnabled: boolean
            phase: number
            sweptQuote: bigint
            sweptTokens: bigint
          }
          return {
            token: l.args.token!,
            curve: l.args.curve!,
            deployer: lt.deployer,
            creatorFeeRecipient: lt.creatorFeeRecipient,
            name: r[0] as string,
            symbol: r[1] as string,
            logo: r[2] as string,
            description: r[3] as string,
            supply: r[4] as bigint,
            quoteReserve,
            tokenReserve,
            realQuote: r[6] as bigint,
            sellable: r[7] as bigint,
            feeBps: r[8] as bigint,
            launchedAt: r[9] as bigint,
            creatorTaxBps: BigInt(lt.creatorTaxBps),
            threshold: lt.graduationThreshold,
            poolFee: lt.poolFee,
            tickSpacing: lt.tickSpacing,
            buybackEnabled: lt.buybackEnabled,
            phase: lt.phase,
            sweptQuote: lt.sweptQuote,
            sweptTokens: lt.sweptTokens,
            launchBlock: l.blockNumber,
          } satisfies Launch
        })
        .reverse()
    },
  })
}

export function useLaunch(token: Address | undefined) {
  const q = useLaunches()
  return { ...q, launch: q.data?.find((l) => l.token.toLowerCase() === token?.toLowerCase()) }
}

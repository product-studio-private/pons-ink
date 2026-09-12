import { zeroAddress, type Address } from 'viem'

export interface PairToken {
  address: Address
  symbol: string
  decimals: number
  phantomQuote: string
  graduationThreshold: string
}

export interface Deployment {
  chainId: number
  startBlock: number
  factory: Address
  memeHook: Address
  feeEscrow: Address
  locker: Address
  buybackVault: Address
  graduationGuard: Address
  graduationExecutor: Address
  launchDeployer: Address
  deployer: Address
  owner: Address
  pairTokens?: PairToken[]
}

// contractsV2/deployments/*.json, written by `./dev.sh up` (local.json) or DeployInk.
// Globbed so a missing local.json is a runtime message instead of a build error.
const files = import.meta.glob<Deployment>('@deployments/*.json', {
  eager: true,
  import: 'default',
})

const name = import.meta.env.VITE_DEPLOYMENT ?? 'local'

export const deployment: Deployment | undefined = Object.entries(files).find(([path]) =>
  path.endsWith(`/${name}.json`),
)?.[1]

export const deploymentName = name

/** Native ETH, the default quote asset. */
export const NATIVE: PairToken = {
  address: zeroAddress,
  symbol: 'ETH',
  decimals: 18,
  phantomQuote: '',
  graduationThreshold: '',
}

/** xStocks (TSLAx, NVDAx, …) are tokenised equities; they get a warning + a "Stocks" filter. */
export function isStock(p: PairToken): boolean {
  return /^[A-Z]{2,5}x$/.test(p.symbol)
}

/** ETH first, then every ERC-20 the factory approved at deploy time. */
export const pairTokens: PairToken[] = [NATIVE, ...(deployment?.pairTokens ?? [])]

export function pairFor(address: Address | undefined): PairToken {
  if (!address || address === zeroAddress) return NATIVE
  return (
    pairTokens.find((p) => p.address.toLowerCase() === address.toLowerCase()) ?? {
      address,
      symbol: `${address.slice(0, 6)}…`,
      decimals: 18,
      phantomQuote: '',
      graduationThreshold: '',
    }
  )
}

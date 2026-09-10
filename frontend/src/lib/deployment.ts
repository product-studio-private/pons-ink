import type { Address } from 'viem'

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

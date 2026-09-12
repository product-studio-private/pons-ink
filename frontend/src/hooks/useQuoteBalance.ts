import { erc20Abi, zeroAddress, type Address } from 'viem'
import { useBalance, useReadContract } from 'wagmi'
import type { PairToken } from '../lib/deployment'

/** Balance of a quote asset (native ETH or an ERC-20 pair token). */
export function useQuoteBalance(pair: PairToken, address: Address | undefined): bigint | undefined {
  const native = pair.address === zeroAddress
  const eth = useBalance({ address, query: { enabled: !!address && native, refetchInterval: 3_000 } })
  const erc = useReadContract({
    address: pair.address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !native, refetchInterval: 3_000 },
  })
  return native ? eth.data?.value : erc.data
}

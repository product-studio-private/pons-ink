import { http, createConfig } from 'wagmi'
import { defineChain } from 'viem'
import { injected } from 'wagmi/connectors'
import { anvilAccount } from './anvilConnector'

export const RPC_URL = import.meta.env.VITE_RPC_URL ?? 'http://127.0.0.1:8545'

// Anvil's default accounts (mnemonic "test test ... junk"). Unlocked on the local
// node, so txs for them can be sent via eth_sendTransaction without a browser wallet.
export const DEV_ACCOUNTS = [
  '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
] as const

export const inkLocal = defineChain({
  id: 57073,
  name: 'Ink (local fork)',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: 'Ink Explorer', url: 'https://explorer.inkonchain.com' } },
  contracts: {
    multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' },
  },
})

export const config = createConfig({
  chains: [inkLocal],
  connectors: [injected(), ...DEV_ACCOUNTS.map((a, i) => anvilAccount(a, i))],
  transports: { [inkLocal.id]: http(RPC_URL) },
  pollingInterval: 2_000,
})

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}

import { createConnector } from 'wagmi'
import { custom, getAddress, numberToHex, type Address, type EIP1193RequestFn } from 'viem'
import { rpc } from 'viem/utils'

/**
 * Connector for one of Anvil's unlocked dev accounts. Signing happens on the
 * node (eth_sendTransaction / eth_sign are forwarded straight to the RPC), so
 * no key ever lives in the browser. Local development only.
 */
export function anvilAccount(address: Address, index: number) {
  const id = `anvil-${index}`
  const key = `${id}.connected`
  return createConnector<EIP1193RequestFn>((config) => ({
    id,
    name: `Anvil #${index}`,
    type: 'anvil',
    async setup() {},
    async connect({ withCapabilities } = {}) {
      localStorage.setItem(key, '1')
      const a = getAddress(address)
      return {
        accounts: (withCapabilities ? [{ address: a, capabilities: {} }] : [a]) as never,
        chainId: config.chains[0].id,
      }
    },
    async disconnect() {
      localStorage.removeItem(key)
    },
    async getAccounts() {
      return [getAddress(address)]
    },
    async getChainId() {
      return config.chains[0].id
    },
    async isAuthorized() {
      return localStorage.getItem(key) === '1'
    },
    async switchChain({ chainId }) {
      const chain = config.chains.find((c) => c.id === chainId)
      if (!chain) throw new Error(`chain ${chainId} not configured`)
      return chain
    },
    onAccountsChanged() {},
    onChainChanged() {},
    onDisconnect() {
      config.emitter.emit('disconnect')
    },
    async getProvider() {
      const url = config.chains[0].rpcUrls.default.http[0]
      const request: EIP1193RequestFn = async ({ method, params }) => {
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [address]
        if (method === 'eth_chainId') return numberToHex(config.chains[0].id)
        if (method === 'wallet_switchEthereumChain') return null
        if (method === 'personal_sign') {
          method = 'eth_sign'
          params = [(params as [string, string])[1], (params as [string, string])[0]]
        }
        const body = { method, params: params as unknown[] }
        const { error, result } = await rpc.http(url, { body })
        if (error) throw new Error(error.message)
        return result
      }
      return custom({ request })({ retryCount: 0 }).request
    },
  }))
}

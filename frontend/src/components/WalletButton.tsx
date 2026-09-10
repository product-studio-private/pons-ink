import { useState } from 'react'
import { useAccount, useBalance, useConnect, useDisconnect } from 'wagmi'
import { DEV_ACCOUNTS } from '../lib/wagmi'
import { fmtEth, short } from '../lib/format'

export function WalletButton() {
  const { address, isConnected, connector } = useAccount()
  const { connectors, connect, isPending } = useConnect()
  const { disconnect } = useDisconnect()
  const { data: bal } = useBalance({ address, query: { refetchInterval: 3_000 } })
  const [open, setOpen] = useState(false)

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2">
        <div className="hidden rounded-xl border border-ink-700 bg-ink-900/70 px-3 py-1.5 text-sm sm:block">
          <span className="font-mono text-white">{bal ? fmtEth(bal.value, 3) : '…'}</span>
          <span className="ml-1 text-ink-300">ETH</span>
        </div>
        <button
          className="btn btn-ghost font-mono"
          title={`${address} via ${connector?.name ?? ''}`}
          onClick={() => disconnect()}
        >
          <span className="h-2 w-2 rounded-full bg-mint" />
          {connector?.type === 'anvil' && <span className="text-ink-300">{connector.name}</span>}
          {short(address)}
        </button>
      </div>
    )
  }

  const injected = connectors.filter((c) => c.type === 'injected')
  const anvil = connectors.filter((c) => c.type === 'anvil')

  return (
    <div className="relative">
      <button className="btn btn-primary" onClick={() => setOpen((o) => !o)} disabled={isPending}>
        {isPending ? 'Connecting…' : 'Connect'}
      </button>
      {open && (
        <div className="card absolute right-0 z-20 mt-2 w-64 bg-ink-900 p-2 shadow-2xl">
          {injected.map((c) => (
            <button
              key={c.uid}
              className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-ink-800"
              onClick={() => {
                connect({ connector: c })
                setOpen(false)
              }}
            >
              <div className="font-semibold text-white">Browser wallet</div>
              <div className="text-xs text-ink-300">MetaMask / Rabby pointed at the local RPC</div>
            </button>
          ))}
          <div className="mt-1 px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-300">
            Anvil dev accounts (10k ETH)
          </div>
          {anvil.map((c, i) => (
            <button
              key={c.uid}
              className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-xs hover:bg-ink-800"
              onClick={() => {
                connect({ connector: c })
                setOpen(false)
              }}
            >
              <span className="text-ink-300">{c.name}</span>
              <span className="font-mono text-white">{short(DEV_ACCOUNTS[i] ?? '', 6)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

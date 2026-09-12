import { useState } from 'react'
import { useAccount, useBalance, useConnect, useDisconnect } from 'wagmi'
import { DEV_ACCOUNTS } from '../lib/wagmi'
import { fmtEth, short } from '../lib/format'

export function WalletButton({ variant = 'pill' }: { variant?: 'pill' | 'cta' }) {
  const { address, isConnected, connector } = useAccount()
  const { connectors, connect, isPending } = useConnect()
  const { disconnect } = useDisconnect()
  const { data: bal } = useBalance({ address, query: { refetchInterval: 3_000 } })
  const [open, setOpen] = useState(false)

  if (isConnected && address) {
    if (variant === 'cta') return null
    return (
      <div className="flex items-center gap-2">
        <div className="hidden rounded-full border border-white/[0.1] bg-white/[0.04] px-3.5 py-2 text-[13px] sm:block">
          <span className="font-medium text-white">{bal ? fmtEth(bal.value, 3) : '…'}</span>
          <span className="ml-1 text-ink-300">ETH</span>
        </div>
        <button className="chip" title={`${address} via ${connector?.name ?? ''}`} onClick={() => disconnect()}>
          <span className="h-2 w-2 rounded-full bg-mint" />
          {connector?.type === 'anvil' && <span className="text-ink-300">{connector.name}</span>}
          <span className="font-medium text-white">{short(address)}</span>
        </button>
      </div>
    )
  }

  const injected = connectors.filter((c) => c.type === 'injected')
  const anvil = connectors.filter((c) => c.type === 'anvil')

  return (
    <div className="relative">
      <button
        className={variant === 'cta' ? 'cta' : 'btn btn-primary px-4 py-2.5 text-[15px]'}
        onClick={() => setOpen((o) => !o)}
        disabled={isPending}
      >
        {isPending ? 'Connecting…' : variant === 'cta' ? 'Connect wallet' : 'Connect'}
      </button>
      {open && (
        <div
          className={`panel absolute z-20 mt-2 p-2 ${variant === 'cta' ? 'left-0 right-0' : 'right-0 w-72'}`}
        >
          {injected.map((c) => (
            <button
              key={c.uid}
              className="w-full rounded-[14px] px-3 py-2.5 text-left text-sm hover:bg-white/[0.06]"
              onClick={() => {
                connect({ connector: c })
                setOpen(false)
              }}
            >
              <div className="font-medium text-white">Browser wallet</div>
              <div className="text-[12px] text-ink-300">MetaMask / Rabby pointed at the local RPC</div>
            </button>
          ))}
          <div className="mt-1 px-3 pt-2 pb-1 text-[11px] font-medium text-ink-300">Anvil dev accounts</div>
          {anvil.map((c, i) => (
            <button
              key={c.uid}
              className="flex w-full items-center justify-between rounded-[12px] px-3 py-2 text-left text-[13px] hover:bg-white/[0.06]"
              onClick={() => {
                connect({ connector: c })
                setOpen(false)
              }}
            >
              <span className="text-ink-300">{c.name}</span>
              <span className="text-white">{short(DEV_ACCOUNTS[i] ?? '', 6)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

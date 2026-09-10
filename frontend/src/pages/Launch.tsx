import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { decodeEventLog, keccak256, toHex, zeroAddress, type BaseError } from 'viem'
import { useAccount, usePublicClient, useReadContract, useReadContracts, useWriteContract } from 'wagmi'
import { deployment } from '../lib/deployment'
import { fmtEth, fmtTokens } from '../lib/format'
import { LaunchFactoryAbi } from '../generated/abis'
import { tokenLaunchedEvent } from '../hooks/useLaunches'

const factory = { address: deployment?.factory ?? zeroAddress, abi: LaunchFactoryAbi } as const

export function Launch() {
  const { address, isConnected } = useAccount()
  const client = usePublicClient()
  const nav = useNavigate()
  const qc = useQueryClient()
  const { writeContractAsync, isPending } = useWriteContract()

  const [f, setF] = useState({
    name: '',
    symbol: '',
    logo: '',
    description: '',
    twitter: '',
    telegram: '',
    discord: '',
    website: '',
    farcaster: '',
    creatorTaxBps: 100,
    buybackEnabled: true,
  })
  const [status, setStatus] = useState<{ kind: 'ok' | 'err' | 'pending'; text: string } | null>(null)

  const { data: cfg } = useReadContracts({
    contracts: [
      { ...factory, functionName: 'launchFee' },
      { ...factory, functionName: 'maxCreatorTaxBps' },
      { ...factory, functionName: 'launchEnabled' },
      { ...factory, functionName: 'getLaunchConfig', args: [0n] },
    ],
    allowFailure: false,
  })
  const { data: canLaunch } = useReadContract({
    ...factory,
    functionName: 'canLaunch',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  })
  const [launchFee, maxTax, enabled, config] = cfg ?? []

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }))

  const valid = f.name.trim().length > 0 && f.symbol.trim().length > 0 && launchFee !== undefined

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!client || !address || launchFee === undefined) return
    setStatus({ kind: 'pending', text: 'Confirm launch in wallet…' })
    try {
      const hash = await writeContractAsync({
        ...factory,
        functionName: 'launchToken',
        args: [
          {
            name: f.name.trim(),
            symbol: f.symbol.trim().toUpperCase(),
            logo: f.logo.trim(),
            description: f.description.trim(),
            socials: {
              twitter: f.twitter.trim(),
              telegram: f.telegram.trim(),
              discord: f.discord.trim(),
              website: f.website.trim(),
              farcaster: f.farcaster.trim(),
            },
            creatorFeeRecipient: address,
            creatorTaxBps: Number(f.creatorTaxBps),
            buybackEnabled: f.buybackEnabled,
            expectedEconomics: '0x0000000000000000000000000000000000000000000000000000000000000000',
            // unique per launch so identical name/symbol never collide on CREATE2
            salt: keccak256(toHex(`${address}:${f.symbol}:${Date.now()}:${Math.random()}`)),
          },
          0n,
          zeroAddress,
        ],
        value: launchFee,
      })
      setStatus({ kind: 'pending', text: 'Deploying token + curve…' })
      const r = await client.waitForTransactionReceipt({ hash })
      if (r.status !== 'success') throw new Error('launch reverted')
      const log = r.logs
        .map((l) => {
          try {
            return decodeEventLog({ abi: [tokenLaunchedEvent], data: l.data, topics: l.topics })
          } catch {
            return null
          }
        })
        .find((x) => x !== null)
      await qc.invalidateQueries({ queryKey: ['launches'] })
      if (log?.args.token) nav(`/token/${log.args.token}`)
      else setStatus({ kind: 'ok', text: `Launched in tx ${hash}` })
    } catch (err) {
      setStatus({ kind: 'err', text: (err as BaseError)?.shortMessage ?? String(err) })
    }
  }

  return (
    <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-[1fr_320px]">
      <form onSubmit={submit} className="card space-y-5 p-6">
        <div>
          <h1 className="text-2xl font-black text-white">Launch a token</h1>
          <p className="mt-1 text-sm text-ink-300">
            Deploys an ERC-20 plus a bonding curve. Trading starts immediately; once the curve fills it graduates to
            Uniswap v4.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
          <div>
            <label className="label">Name</label>
            <input className="input" required maxLength={64} placeholder="Kraken Coin" value={f.name} onChange={set('name')} />
          </div>
          <div>
            <label className="label">Symbol</label>
            <input
              className="input font-mono uppercase"
              required
              maxLength={12}
              placeholder="KRKN"
              value={f.symbol}
              onChange={set('symbol')}
            />
          </div>
        </div>

        <div>
          <label className="label">Logo URL</label>
          <input className="input" placeholder="https://… or ipfs://…" value={f.logo} onChange={set('logo')} />
        </div>

        <div>
          <label className="label">Description</label>
          <textarea
            className="input min-h-24"
            maxLength={500}
            placeholder="What is this thing?"
            value={f.description}
            onChange={set('description')}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {(['twitter', 'telegram', 'discord', 'website', 'farcaster'] as const).map((k) => (
            <div key={k}>
              <label className="label">{k}</label>
              <input className="input" placeholder="optional" value={f[k]} onChange={set(k)} />
            </div>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">
              Creator tax <span className="text-white">{(Number(f.creatorTaxBps) / 100).toFixed(2)}%</span>
            </label>
            <input
              type="range"
              min={0}
              max={Number(maxTax ?? 1000n)}
              step={10}
              value={f.creatorTaxBps}
              onChange={set('creatorTaxBps')}
              className="w-full accent-kraken"
            />
            <p className="mt-1 text-xs text-ink-300">
              Extra fee on every curve trade, paid 100% to you. Max {(Number(maxTax ?? 0n) / 100).toFixed(0)}%.
            </p>
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-ink-700 p-3">
            <input type="checkbox" checked={f.buybackEnabled} onChange={set('buybackEnabled')} className="mt-0.5 accent-kraken" />
            <span>
              <span className="block text-sm font-semibold text-white">Buyback &amp; lock</span>
              <span className="block text-xs text-ink-300">
                Route the buyback share of fees into buying your token and locking it forever.
              </span>
            </span>
          </label>
        </div>

        <button
          type="submit"
          className="btn btn-primary w-full py-3 text-base"
          disabled={!isConnected || isPending || !valid || enabled === false || canLaunch === false}
        >
          {!isConnected
            ? 'Connect a wallet'
            : enabled === false
              ? 'Launches are paused'
              : canLaunch === false
                ? 'Wallet not whitelisted'
                : isPending
                  ? 'Confirm…'
                  : `Launch for ${launchFee !== undefined ? fmtEth(launchFee, 4) : '…'} ETH`}
        </button>

        {status && (
          <div
            className={`rounded-lg px-3 py-2 text-xs break-all ${
              status.kind === 'ok' ? 'bg-mint/10 text-mint' : status.kind === 'err' ? 'bg-coral/10 text-coral' : 'bg-ink-800 text-ink-200'
            }`}
          >
            {status.text}
          </div>
        )}
      </form>

      <aside className="space-y-4">
        <div className="card p-5">
          <h3 className="text-sm font-bold text-white">Launch economics</h3>
          {config ? (
            <dl className="mt-3 space-y-2 text-xs text-ink-300">
              <Row k="Supply" v={`${fmtTokens(config.supply)} tokens`} />
              <Row k="Curve fee" v={`${Number(config.curveFeeBps) / 100}%`} />
              <Row k="Virtual reserve" v={`${fmtEth(config.phantomQuote, 2)} ETH`} />
              <Row k="Graduates at" v={`${fmtEth(config.graduationThreshold, 2)} ETH raised`} />
              <Row k="v4 pool fee" v={`${config.poolFee / 10_000}% · spacing ${config.tickSpacing}`} />
              <Row k="Launch fee" v={`${launchFee !== undefined ? fmtEth(launchFee, 4) : '…'} ETH`} />
            </dl>
          ) : (
            <div className="mt-3 text-xs text-ink-300">Loading…</div>
          )}
        </div>
        <div className="card p-5 text-xs text-ink-300">
          <h3 className="text-sm font-bold text-white">How it works</h3>
          <ol className="mt-3 list-decimal space-y-2 pl-4">
            <li>Full supply is minted to a constant-product curve seeded with a virtual ETH reserve.</li>
            <li>Buys and sells trade against the curve; fees split protocol / creator / buyback.</li>
            <li>When the sellable allocation is gone, the curve sweeps and seeds a Uniswap v4 pool.</li>
            <li>The LP position is locked forever; swap fees keep flowing via the Pons hook.</li>
          </ol>
        </div>
      </aside>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{k}</dt>
      <dd className="font-mono text-white">{v}</dd>
    </div>
  )
}

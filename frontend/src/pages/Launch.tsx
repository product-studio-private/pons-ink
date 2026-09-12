import { useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { decodeEventLog, erc20Abi, formatUnits, isAddress, keccak256, toHex, zeroAddress, type Address } from 'viem'
import { useAccount, usePublicClient, useReadContract, useReadContracts, useWriteContract } from 'wagmi'
import { deployment, isStock, NATIVE, pairTokens, type PairToken } from '../lib/deployment'
import { errMsg, fmtQuote, parseSafe } from '../lib/format'
import { BondingCurveAbi, LaunchFactoryAbi } from '../generated/abis'
import { tokenLaunchedEvent } from '../hooks/useLaunches'
import { useQuoteBalance } from '../hooks/useQuoteBalance'
import { WalletButton } from '../components/WalletButton'
import { AssetIcon } from '../components/AssetIcon'

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
    devBuy: '',
    creatorTaxBps: 100,
    buybackEnabled: true,
    creatorWallet: '',
    exemptWallet: '',
  })
  const [pair, setPair] = useState<PairToken>(NATIVE)
  const [pairOpen, setPairOpen] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'err' | 'pending'; text: string } | null>(null)

  const { data: cfg } = useReadContracts({
    contracts: [
      { ...factory, functionName: 'launchFee' },
      { ...factory, functionName: 'maxCreatorTaxBps' },
      { ...factory, functionName: 'launchEnabled' },
      { ...factory, functionName: 'getLaunchConfig', args: [0n] },
      { ...factory, functionName: 'snipeTaxStartBps' },
      { ...factory, functionName: 'snipeTaxSeconds' },
    ],
    allowFailure: false,
  })
  const { data: canLaunch } = useReadContract({
    ...factory,
    functionName: 'canLaunch',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  })
  const [launchFee, maxTax, enabled, config, snipeBps, snipeSecs] = cfg ?? []

  const native = pair.address === zeroAddress
  const pairBal = useQuoteBalance(pair, address)

  const threshold = native ? config?.graduationThreshold : BigInt(pair.graduationThreshold || '0')
  const tradeFee = config ? Number(config.curveFeeBps) / 100 : undefined
  const devBuy = parseSafe(f.devBuy, pair.decimals)

  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }))

  const creatorWallet = f.creatorWallet.trim()
  const exemptWallet = f.exemptWallet.trim()
  const walletsOk = (!creatorWallet || isAddress(creatorWallet)) && (!exemptWallet || isAddress(exemptWallet))
  const valid = f.name.trim().length > 0 && f.symbol.trim().length > 0 && launchFee !== undefined && walletsOk

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!client || !address || launchFee === undefined) return
    setStatus({ kind: 'pending', text: 'Confirm launch in wallet…' })
    try {
      const params = {
        name: f.name.trim(),
        symbol: f.symbol.trim().toUpperCase(),
        logo: f.logo.trim(),
        description: f.description.trim(),
        socials: {
          twitter: f.twitter.trim() ? `x.com/${f.twitter.trim().replace(/^@/, '')}` : '',
          telegram: f.telegram.trim() ? `t.me/${f.telegram.trim().replace(/^@/, '')}` : '',
          discord: '',
          website: '',
          farcaster: '',
        },
        creatorFeeRecipient: (creatorWallet || address) as Address,
        creatorTaxBps: Number(f.creatorTaxBps),
        buybackEnabled: f.buybackEnabled,
        expectedEconomics: '0x0000000000000000000000000000000000000000000000000000000000000000',
        // unique per launch so identical name/symbol never collide on CREATE2
        salt: keccak256(toHex(`${address}:${f.symbol}:${crypto.randomUUID()}`)),
      } as const
      const hash = exemptWallet
        ? await writeContractAsync({
            ...factory,
            functionName: 'launchToken',
            args: [params, 0n, pair.address, [exemptWallet as Address]],
            value: launchFee,
          })
        : await writeContractAsync({
            ...factory,
            functionName: 'launchToken',
            args: [params, 0n, pair.address],
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

      if (devBuy > 0n && log?.args.curve) {
        const curve = log.args.curve
        if (!native) {
          setStatus({ kind: 'pending', text: `Approve ${pair.symbol} for the developer buy…` })
          const a = await writeContractAsync({
            address: pair.address,
            abi: erc20Abi,
            functionName: 'approve',
            args: [curve, devBuy],
          })
          await client.waitForTransactionReceipt({ hash: a })
        }
        setStatus({ kind: 'pending', text: 'Confirm developer buy…' })
        const b = await writeContractAsync({
          address: curve,
          abi: BondingCurveAbi,
          functionName: 'buy',
          args: [devBuy, 0n, address],
          value: native ? devBuy : 0n,
        })
        await client.waitForTransactionReceipt({ hash: b })
      }

      await qc.invalidateQueries({ queryKey: ['launches'] })
      if (log?.args.token) nav(`/token/${log.args.token}`)
      else setStatus({ kind: 'ok', text: `Launched in tx ${hash}` })
    } catch (err) {
      setStatus({ kind: 'err', text: errMsg(err) })
    }
  }

  const symbol = f.symbol.trim().toUpperCase()
  const cta = !isConnected
    ? null
    : enabled === false
      ? 'Launches are paused'
      : canLaunch === false
        ? 'Wallet not whitelisted'
        : isPending
          ? 'Confirm in wallet…'
          : 'Create token'

  return (
    <div className="mx-auto max-w-[960px]">
      <div className="flex items-center justify-between">
        <Link to="/tokens" className="chip py-2.5 pr-4 pl-3">
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m12 5-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back
        </Link>
        <div className="seg">
          <span className="seg-item is-active">v2</span>
        </div>
      </div>

      <div className="panel mt-4 grid overflow-hidden md:grid-cols-[1fr_400px]">
        <form onSubmit={submit} className="p-9">
          <h1 className="text-[30px] font-medium tracking-tight text-white">Launch token</h1>

          <div className="mt-7 grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <input className="field" required maxLength={64} placeholder="Token name" value={f.name} onChange={set('name')} />
            </Field>
            <Field label="Ticker">
              <input className="field uppercase" required maxLength={12} placeholder="symbol" value={f.symbol} onChange={set('symbol')} />
            </Field>
          </div>

          <Field label="Description" className="mt-4">
            <textarea
              className="field min-h-[84px] resize-y"
              maxLength={500}
              placeholder="A short description of the token"
              value={f.description}
              onChange={set('description')}
            />
          </Field>

          <Field label="Token image" className="mt-4">
            <label className="flex cursor-text items-center gap-3 rounded-[14px] border border-dashed border-white/[0.14] bg-white/[0.02] p-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-[12px] bg-white/[0.06] text-ink-300">
                {f.logo ? (
                  <img src={f.logo} alt="" className="h-full w-full object-cover" />
                ) : (
                  <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <rect x="3" y="3" width="14" height="14" rx="3" />
                    <circle cx="8" cy="8" r="1.5" />
                    <path d="m17 13-4-4-7 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <input
                className="min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-ink-200"
                placeholder="Paste an image URL (https:// or ipfs://)"
                value={f.logo}
                onChange={set('logo')}
              />
            </label>
          </Field>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="X profile">
              <Prefixed prefix="x.com/">
                <input className="min-w-0 flex-1 bg-transparent outline-none" placeholder="handle" value={f.twitter} onChange={set('twitter')} />
              </Prefixed>
            </Field>
            <Field label="Telegram">
              <Prefixed prefix="t.me/">
                <input className="min-w-0 flex-1 bg-transparent outline-none" placeholder="community" value={f.telegram} onChange={set('telegram')} />
              </Prefixed>
            </Field>
          </div>

          <Field label="Paired asset" className="mt-4">
            <div className="relative">
              <button
                type="button"
                className="field flex items-center justify-between"
                onClick={() => setPairOpen((o) => !o)}
              >
                <span className="flex items-center gap-2.5">
                  <AssetIcon symbol={pair.symbol} className="h-5 w-5 text-[10px]" />
                  <span className="font-medium">{pair.symbol}</span>
                  {isStock(pair) && <span className="badge bg-gold/20 text-gold">Stock</span>}
                </span>
                <svg viewBox="0 0 20 20" className="h-4 w-4 text-ink-300" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m6 8 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {pairOpen && (
                <div className="panel absolute right-0 left-0 z-20 mt-2 max-h-72 overflow-y-auto p-1.5">
                  {pairTokens.map((p) => (
                    <button
                      type="button"
                      key={p.address}
                      className={`flex w-full items-center justify-between rounded-[12px] px-3 py-2.5 text-left text-[14px] hover:bg-white/[0.06] ${
                        p.address === pair.address ? 'bg-white/[0.06]' : ''
                      }`}
                      onClick={() => {
                        setPair(p)
                        setPairOpen(false)
                        setF((s) => ({ ...s, devBuy: '' }))
                      }}
                    >
                      <span className="flex items-center gap-2.5 text-white">
                        <AssetIcon symbol={p.symbol} className="h-5 w-5 text-[10px]" />
                        {p.symbol}
                        {isStock(p) && <span className="badge bg-gold/20 text-gold">Stock</span>}
                      </span>
                      <span className="text-[12px] text-ink-300">
                        {p.address === zeroAddress
                          ? 'native'
                          : `graduates at ${fmtQuote(BigInt(p.graduationThreshold), p.decimals, 2)}`}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p className="hint">
              {threshold !== undefined
                ? `Graduates once the curve raises ${fmtQuote(threshold, pair.decimals, 4)} ${pair.symbol}.`
                : 'Loading curve economics…'}
            </p>
          </Field>

          <Field label="Developer buy" className="mt-4">
            <div className="field flex items-center justify-between py-3.5">
              <div className="min-w-0">
                <input
                  className="w-full bg-transparent text-[22px] font-medium outline-none placeholder:text-ink-300/60"
                  placeholder="0.00"
                  inputMode="decimal"
                  value={f.devBuy}
                  onChange={set('devBuy')}
                />
                <div className="mt-1 text-[12px] text-ink-300">
                  {!isConnected
                    ? 'Balance unavailable'
                    : pairBal === undefined
                      ? 'Loading balance…'
                      : `Balance ${fmtQuote(pairBal, pair.decimals, 4)} ${pair.symbol}`}
                </div>
              </div>
              <span className="convert-asset">
                <AssetIcon symbol={pair.symbol} />
                {pair.symbol}
              </span>
            </div>
            <p className="hint">Optional first buy right after launch, from the same wallet. You are exempt from the snipe tax.</p>
          </Field>

          {/* advanced */}
          <div className="mt-6 border-t border-white/[0.08] pt-4">
            <button
              type="button"
              className="flex w-full items-center justify-between py-2 text-[15px] text-white"
              onClick={() => setAdvanced((a) => !a)}
            >
              Advanced
              <svg
                viewBox="0 0 20 20"
                className={`h-4 w-4 text-ink-300 transition ${advanced ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="m6 8 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {advanced && (
              <div className="mt-3 space-y-4">
                <label className="subpanel flex cursor-pointer items-center justify-between gap-4 p-4">
                  <span>
                    <span className="block text-[14px] font-medium text-white">Buyback &amp; lock</span>
                    <span className="mt-0.5 block text-[12px] leading-5 text-ink-300">
                      Route the buyback share of trading fees into buying {symbol || 'your token'} and locking it forever.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={f.buybackEnabled}
                    onChange={(e) => setF((s) => ({ ...s, buybackEnabled: e.target.checked }))}
                  />
                  <span className={`switch ${f.buybackEnabled ? 'is-on' : ''}`} />
                </label>

                <Field label="Creator wallet">
                  <input
                    className="field"
                    placeholder={address ?? '0x…'}
                    value={f.creatorWallet}
                    onChange={set('creatorWallet')}
                  />
                  <p className="hint">Receives the creator tax. Defaults to the launching wallet.</p>
                </Field>

                <Field label={`Creator tax · ${(Number(f.creatorTaxBps) / 100).toFixed(2)}%`}>
                  <input
                    type="range"
                    min={0}
                    max={Number(maxTax ?? 1000n)}
                    step={10}
                    value={f.creatorTaxBps}
                    onChange={set('creatorTaxBps')}
                    className="w-full"
                  />
                  <p className="hint">
                    Extra fee on every curve trade, paid to the creator wallet. Max{' '}
                    {(Number(maxTax ?? 0n) / 100).toFixed(0)}%.
                  </p>
                </Field>

                <Field label="Snipe tax exemption wallet">
                  <input className="field" placeholder="0x… (optional)" value={f.exemptWallet} onChange={set('exemptWallet')} />
                  <p className="hint">
                    One extra wallet allowed to buy at the untaxed price during the launch window. Your own wallet is
                    always exempt.
                  </p>
                </Field>
              </div>
            )}
          </div>

          <div className="mt-6 flex items-center justify-between border-t border-white/[0.08] pt-4 text-[13px] text-ink-300">
            <span>
              {pair.symbol} pair, {launchFee !== undefined ? fmtQuote(launchFee, 18, 4) : '…'} ETH due
              {devBuy > 0n ? ` + ${fmtQuote(devBuy, pair.decimals, 4)} ${pair.symbol} dev buy` : ''}
            </span>
            <span>{tradeFee !== undefined ? `${tradeFee.toFixed(2)}% trade fee` : ''}</span>
          </div>

          <div className="mt-4">
            {!isConnected ? (
              <WalletButton variant="cta" />
            ) : (
              <button
                type="submit"
                className="cta"
                disabled={isPending || !valid || enabled === false || canLaunch === false}
              >
                {cta}
              </button>
            )}
          </div>

          {status && (
            <div
              className={`mt-3 rounded-[12px] px-3 py-2 text-[12px] break-all ${
                status.kind === 'ok'
                  ? 'bg-mint/10 text-mint'
                  : status.kind === 'err'
                    ? 'bg-coral/10 text-coral'
                    : 'bg-white/[0.06] text-ink-200'
              }`}
            >
              {status.text}
            </div>
          )}
        </form>

        {/* live preview */}
        <aside className="grid place-items-center border-t border-white/[0.08] bg-black/40 p-9 md:border-t-0 md:border-l">
          <div className="w-full max-w-[320px] rounded-glass border border-white/[0.1] bg-ink-900 p-6 shadow-preview">
            <div className="grid h-16 w-16 place-items-center overflow-hidden rounded-[16px] bg-white/[0.06] text-ink-300">
              {f.logo ? (
                <img src={f.logo} alt="" className="h-full w-full object-cover" />
              ) : (
                <svg viewBox="0 0 20 20" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <rect x="3" y="3" width="14" height="14" rx="3" />
                  <circle cx="8" cy="8" r="1.5" />
                  <path d="m17 13-4-4-7 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
            <div className="mt-5 truncate text-[24px] font-medium tracking-tight text-white">{f.name.trim() || 'Your token'}</div>
            <div className="mt-1 truncate text-[13px] text-ink-300">{symbol || 'ticker'}</div>

            <dl className="mt-5 divide-y divide-white/[0.08] text-[13px]">
              <Row k="Launch fee">
                {launchFee !== undefined ? fmtQuote(launchFee, 18, 4) : '…'} <AssetIcon symbol="ETH" className="ml-1 inline-grid h-4 w-4 text-[8px]" />
              </Row>
              <Row k="Paired with">{pair.symbol}</Row>
              <Row k="Trade fee">{tradeFee !== undefined ? `${tradeFee.toFixed(2)}%` : '…'}</Row>
              <Row k="Launch window">
                {snipeBps !== undefined && snipeSecs !== undefined
                  ? `${Number(snipeBps) / 100}% snipe tax, ${snipeSecs.toString()}s`
                  : '…'}
              </Row>
              <Row k="Graduation">
                {threshold !== undefined ? `${fmtQuote(threshold, pair.decimals, 4)} ${pair.symbol}` : '…'}
              </Row>
              <Row k="Liquidity">Locked</Row>
              {config && <Row k="Supply">{Number(formatUnits(config.supply, 18)).toLocaleString()}</Row>}
            </dl>
          </div>
        </aside>
      </div>
    </div>
  )
}

function Field({ label, className = '', children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <span className="field-label">{label}</span>
      {children}
    </div>
  )
}

function Prefixed({ prefix, children }: { prefix: string; children: ReactNode }) {
  return (
    <label className="field flex items-center gap-1 text-[15px]">
      <span className="text-ink-300">{prefix}</span>
      {children}
    </label>
  )
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="text-ink-300">{k}</dt>
      <dd className="text-right text-white">{children}</dd>
    </div>
  )
}

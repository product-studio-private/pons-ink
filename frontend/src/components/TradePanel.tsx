import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { erc20Abi, formatUnits, parseUnits, zeroAddress } from 'viem'
import { useAccount, usePublicClient, useReadContract, useWriteContract } from 'wagmi'
import type { Launch } from '../hooks/useLaunches'
import { useQuoteBalance } from '../hooks/useQuoteBalance'
import { deployment } from '../lib/deployment'
import { PRICE_DECIMALS, previewBuy, previewSell, spotPrice, valueAt, withSlippage } from '../lib/curve'
import { errMsg, fmtPrice, fmtQuote, fmtTokens, parseSafe } from '../lib/format'
import { BondingCurveAbi, LaunchFactoryAbi, LauncherTokenAbi } from '../generated/abis'
import { AssetIcon } from './AssetIcon'
import { WalletButton } from './WalletButton'

type Side = 'buy' | 'sell'
type Tab = 'Market' | 'Limit' | 'Orders'

export function TradePanel({ launch }: { launch: Launch }) {
  const { address, isConnected } = useAccount()
  const client = usePublicClient()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('Market')
  const [side, setSide] = useState<Side>('buy')
  const [amount, setAmount] = useState('')
  const [slippage, setSlippage] = useState(1)
  const [slipOpen, setSlipOpen] = useState(false)
  const [quick, setQuick] = useState<number | null>(null)
  const [status, setStatus] = useState<{ kind: 'ok' | 'err' | 'pending'; text: string } | null>(null)

  const pair = launch.pair
  const native = pair.address === zeroAddress
  const quoteBal = useQuoteBalance(pair, address)
  const { data: tokBal } = useReadContract({
    address: launch.token,
    abi: LauncherTokenAbi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 3_000 },
  })
  const { writeContractAsync, isPending } = useWriteContract()

  const bonding = launch.phase === 0
  const soldOut = bonding && launch.sellable === 0n
  const tradable = bonding && !soldOut

  const inDecimals = side === 'buy' ? pair.decimals : 18
  const amt = parseSafe(amount, inDecimals)
  const buyPrev = side === 'buy' && amt > 0n ? previewBuy(launch, amt) : null
  const sellPrev = side === 'sell' && amt > 0n ? previewSell(launch, amt) : 0n
  const out = side === 'buy' ? (buyPrev?.tokensOut ?? 0n) : sellPrev
  const price = spotPrice(launch)

  // value of the launcher-token leg expressed in the quote asset
  const tokenLegValue = (tokens: bigint) => valueAt(price, tokens)

  const flip = () => {
    setSide((s) => (s === 'buy' ? 'sell' : 'buy'))
    setAmount('')
    setQuick(null)
  }

  const setPct = (p: number) => {
    setQuick(p)
    const bal = side === 'buy' ? quoteBal : tokBal
    if (bal === undefined) return
    let v = (bal * BigInt(p)) / 100n
    if (side === 'buy' && native && p === 100) {
      const gas = parseUnits('0.01', 18)
      v = v > gas ? v - gas : 0n
    }
    setAmount(formatUnits(v, inDecimals))
  }

  async function refresh() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['launches'] }),
      qc.invalidateQueries({ queryKey: ['trades'] }),
      qc.invalidateQueries({ queryKey: ['holders'] }),
      qc.invalidateQueries({ queryKey: ['activity'] }),
    ])
  }

  async function run(label: string, fn: () => Promise<`0x${string}`>) {
    if (!client) return
    setStatus({ kind: 'pending', text: `${label}: confirm in wallet…` })
    try {
      const hash = await fn()
      setStatus({ kind: 'pending', text: `${label}: waiting for block…` })
      const r = await client.waitForTransactionReceipt({ hash })
      if (r.status !== 'success') throw new Error('transaction reverted')
      setStatus({ kind: 'ok', text: `${label} confirmed in block ${r.blockNumber}` })
      setAmount('')
      setQuick(null)
      await refresh()
    } catch (e) {
      setStatus({ kind: 'err', text: errMsg(e) })
    }
  }

  async function ensureAllowance(token: `0x${string}`, needed: bigint, label: string) {
    const allowance = await client!.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [address!, launch.curve],
    })
    if (allowance >= needed) return
    setStatus({ kind: 'pending', text: `${label}: confirm in wallet…` })
    const h = await writeContractAsync({ address: token, abi: erc20Abi, functionName: 'approve', args: [launch.curve, needed] })
    await client!.waitForTransactionReceipt({ hash: h })
  }

  const buy = () =>
    run('Buy', async () => {
      if (!native) await ensureAllowance(pair.address, amt, `Approve ${pair.symbol}`)
      return writeContractAsync({
        address: launch.curve,
        abi: BondingCurveAbi,
        functionName: 'buy',
        args: [amt, buyPrev ? withSlippage(buyPrev.tokensOut, slippage * 100) : 0n, address!],
        value: native ? amt : 0n,
      })
    })

  const sell = () =>
    run('Sell', async () => {
      await ensureAllowance(launch.token, amt, `Approve ${launch.symbol}`)
      return writeContractAsync({
        address: launch.curve,
        abi: BondingCurveAbi,
        functionName: 'sell',
        args: [amt, withSlippage(sellPrev, slippage * 100), address!],
      })
    })

  const graduate = () =>
    run(launch.phase === 0 ? 'Graduate' : 'Create v4 pool', () =>
      writeContractAsync({
        address: deployment!.factory,
        abi: LaunchFactoryAbi,
        functionName: launch.phase === 0 ? 'graduate' : 'createGraduatedPool',
        args: [launch.token],
      }),
    )

  const sellAsset = side === 'buy' ? pair.symbol : launch.symbol
  const buyAsset = side === 'buy' ? launch.symbol : pair.symbol
  const sellBal = side === 'buy' ? quoteBal : tokBal
  const buyBal = side === 'buy' ? tokBal : quoteBal
  const fmtBal = (v: bigint | undefined, sym: string) =>
    v === undefined ? '–' : sym === launch.symbol ? fmtTokens(v) : fmtQuote(v, pair.decimals, 4)

  const graduatedNote =
    launch.phase === 2
      ? 'This token graduated. Liquidity lives in a Uniswap v4 pool on Ink; curve trading is closed.'
      : launch.phase === 3
        ? 'This launch was rescued by the protocol owner.'
        : null

  return (
    <div className="mt-4">
      <div className="tabs">
        {(['Market', 'Limit', 'Orders'] as Tab[]).map((t) => (
          <button
            key={t}
            className={`tabs-tab ${tab === t ? 'is-active' : ''} ${t !== 'Market' ? 'cursor-not-allowed opacity-50' : ''}`}
            disabled={t !== 'Market'}
            onClick={() => setTab(t)}
            title={t !== 'Market' ? 'Coming soon' : undefined}
          >
            {t}
          </button>
        ))}
      </div>

      {(soldOut || launch.phase === 1) && (
        <div className="subpanel mt-4 border-gold/30 bg-gold/[0.08] p-4 text-[13px]">
          <div className="font-semibold text-gold">
            {launch.phase === 1 ? 'Reserves swept — pool not yet created' : 'Curve filled — ready to graduate'}
          </div>
          <p className="mt-1 leading-5 text-ink-200">
            Graduation is permissionless. Sweep the curve, then seed the Uniswap v4 pool.
          </p>
          <button className="cta mt-3 py-3 text-[15px]" disabled={!isConnected || isPending} onClick={graduate}>
            {launch.phase === 1 ? 'Create Uniswap v4 pool' : 'Graduate'}
          </button>
        </div>
      )}

      {graduatedNote && <p className="subpanel mt-4 p-4 text-[13px] leading-5 text-ink-200">{graduatedNote}</p>}

      {/* sell leg */}
      <div className="relative mt-4">
        <div className="convert-panel">
          <div className="text-[13px] text-ink-300">Sell</div>
          <input
            className="convert-amount mt-2"
            placeholder="0"
            inputMode="decimal"
            disabled={!tradable}
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value)
              setQuick(null)
            }}
          />
          <div className="mt-1 text-[13px] text-ink-300">
            {side === 'buy'
              ? `${amount ? fmtTokens(out) : '0'} ${launch.symbol}`
              : `${amount ? fmtQuote(tokenLegValue(amt), pair.decimals, 6) : '0'} ${pair.symbol}`}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <button className="convert-asset" onClick={flip} title="Switch direction">
              <AssetIcon symbol={sellAsset} logo={sellAsset === launch.symbol ? launch.logo : undefined} />
              {sellAsset}
              <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 text-ink-300" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m6 8 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <span className="text-[13px] text-ink-300">
              {sellAsset} {fmtBal(sellBal, sellAsset)}
            </span>
          </div>
        </div>

        <button
          className="convert-swap absolute left-1/2 -bottom-5 z-10 -translate-x-1/2"
          onClick={flip}
          aria-label="Switch buy and sell"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M6 3v11M6 14l-2.5-2.5M6 14l2.5-2.5M14 17V6M14 6l-2.5 2.5M14 6l2.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* buy leg */}
      <div className="convert-panel mt-2">
        <div className="text-[13px] text-ink-300">Buy</div>
        <div className="convert-amount mt-2 truncate text-white/90">
          {amount && out > 0n ? (side === 'buy' ? fmtTokens(out) : fmtQuote(out, pair.decimals, 6)) : '0'}
        </div>
        <div className="mt-1 text-[13px] text-ink-300">
          {side === 'buy'
            ? `${amount ? fmtQuote(amt, pair.decimals, 6) : '0'} ${pair.symbol}`
            : `${amount ? fmtTokens(amt) : '0'} ${launch.symbol}`}
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="convert-asset">
            <AssetIcon symbol={buyAsset} logo={buyAsset === launch.symbol ? launch.logo : undefined} />
            {buyAsset}
          </span>
          <span className="text-[13px] text-ink-300">{fmtBal(buyBal, buyAsset)} available</span>
        </div>
      </div>

      {buyPrev?.clamped && (
        <p className="mt-2 text-[12px] text-gold">
          Fills the rest of the curve — excess {pair.symbol} is refunded and the token graduates.
        </p>
      )}

      <div className="mt-4 grid grid-cols-4 gap-2">
        {[25, 50, 75, 100].map((p) => (
          <button
            key={p}
            className={`convert-quick ${quick === p ? 'is-active' : ''}`}
            disabled={!tradable || !isConnected}
            onClick={() => setPct(p)}
          >
            {p}%
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-[13px] text-ink-300">Slippage</span>
        <div className="relative">
          <button className="chip py-1.5" onClick={() => setSlipOpen((o) => !o)}>
            <span className="text-white">{slippage}%</span>
            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
              <circle cx="10" cy="10" r="2.5" />
              <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" strokeLinecap="round" />
            </svg>
            Adjust
          </button>
          {slipOpen && (
            <div className="panel absolute right-0 z-20 mt-2 flex gap-1 p-1.5">
              {[0.5, 1, 3, 5].map((s) => (
                <button
                  key={s}
                  className={`seg-item ${slippage === s ? 'is-active' : ''}`}
                  onClick={() => {
                    setSlippage(s)
                    setSlipOpen(false)
                  }}
                >
                  {s}%
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4">
        {!isConnected ? (
          <WalletButton variant="cta" />
        ) : (
          <button
            className={`cta ${side === 'sell' ? 'cta-sell' : ''}`}
            disabled={!tradable || isPending || amt === 0n || out === 0n}
            onClick={side === 'buy' ? buy : sell}
          >
            {isPending
              ? 'Confirm in wallet…'
              : !tradable
                ? 'Curve closed'
                : side === 'buy'
                  ? `Buy ${launch.symbol}`
                  : `Sell ${launch.symbol}`}
          </button>
        )}
      </div>

      <p className="mt-3 text-center text-[12px] text-ink-300">
        {((Number(launch.feeBps) + Number(launch.creatorTaxBps)) / 100).toFixed(2)}% fee · 1 {launch.symbol} ={' '}
        {fmtPrice(price, pair.decimals + PRICE_DECIMALS)} {pair.symbol}
      </p>

      {status && (
        <div
          className={`mt-3 rounded-[12px] px-3 py-2 text-[12px] break-words ${
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
    </div>
  )
}

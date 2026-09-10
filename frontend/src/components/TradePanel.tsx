import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { formatEther, formatUnits, parseEther, parseUnits, type BaseError } from 'viem'
import { useAccount, useBalance, usePublicClient, useReadContract, useWriteContract } from 'wagmi'
import type { Launch } from '../hooks/useLaunches'
import { deployment } from '../lib/deployment'
import { previewBuy, previewSell, withSlippage } from '../lib/curve'
import { fmtEth, fmtTokens, phaseName } from '../lib/format'
import { BondingCurveAbi, LaunchFactoryAbi, LauncherTokenAbi } from '../generated/abis'

type Side = 'buy' | 'sell'

function parseSafe(v: string, decimals: number): bigint {
  try {
    return v ? parseUnits(v.replace(/,/g, ''), decimals) : 0n
  } catch {
    return 0n
  }
}

function errMsg(e: unknown): string {
  const be = e as BaseError
  return be?.shortMessage ?? (e instanceof Error ? e.message : String(e))
}

export function TradePanel({ launch }: { launch: Launch }) {
  const { address, isConnected } = useAccount()
  const client = usePublicClient()
  const qc = useQueryClient()
  const [side, setSide] = useState<Side>('buy')
  const [amount, setAmount] = useState('')
  const [slippage, setSlippage] = useState(1)
  const [status, setStatus] = useState<{ kind: 'ok' | 'err' | 'pending'; text: string } | null>(null)

  const { data: ethBal } = useBalance({ address, query: { refetchInterval: 3_000 } })
  const { data: tokBal } = useReadContract({
    address: launch.token,
    abi: LauncherTokenAbi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 3_000 },
  })
  const { writeContractAsync, isPending } = useWriteContract()

  const switchSide = (s: Side) => {
    setSide(s)
    setAmount('')
  }

  const bonding = launch.phase === 0
  const ready = bonding && launch.sellable === 0n
  const state = { ...launch, sellable: launch.sellable }

  const amt = parseSafe(amount, 18)
  const buyPrev = side === 'buy' && amt > 0n ? previewBuy(state, amt) : null
  const sellPrev = side === 'sell' && amt > 0n ? previewSell(state, amt) : 0n

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ['launches'] })
    await qc.invalidateQueries({ queryKey: ['trades'] })
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
      await refresh()
    } catch (e) {
      setStatus({ kind: 'err', text: errMsg(e) })
    }
  }

  const buy = () =>
    run('Buy', () =>
      writeContractAsync({
        address: launch.curve,
        abi: BondingCurveAbi,
        functionName: 'buy',
        args: [amt, buyPrev ? withSlippage(buyPrev.tokensOut, slippage * 100) : 0n, address!],
        value: amt,
      }),
    )

  const sell = () =>
    run('Sell', async () => {
      const allowance = await client!.readContract({
        address: launch.token,
        abi: LauncherTokenAbi,
        functionName: 'allowance',
        args: [address!, launch.curve],
      })
      if (allowance < amt) {
        setStatus({ kind: 'pending', text: 'Approve: confirm in wallet…' })
        const h = await writeContractAsync({
          address: launch.token,
          abi: LauncherTokenAbi,
          functionName: 'approve',
          args: [launch.curve, amt],
        })
        await client!.waitForTransactionReceipt({ hash: h })
      }
      return writeContractAsync({
        address: launch.curve,
        abi: BondingCurveAbi,
        functionName: 'sell',
        args: [amt, withSlippage(sellPrev, slippage * 100), address!],
      })
    })

  const graduate = () =>
    run(launch.phase === 0 ? 'Graduate (sweep)' : 'Create v4 pool', () =>
      writeContractAsync({
        address: deployment!.factory,
        abi: LaunchFactoryAbi,
        functionName: launch.phase === 0 ? 'graduate' : 'createGraduatedPool',
        args: [launch.token],
      }),
    )

  const setMax = () => {
    const gasReserve = parseEther('0.01')
    if (side === 'buy' && ethBal) setAmount(formatEther(ethBal.value > gasReserve ? ethBal.value - gasReserve : 0n))
    if (side === 'sell' && tokBal !== undefined) setAmount(formatUnits(tokBal, 18))
  }

  if (!bonding && launch.phase !== 1) {
    return (
      <div className="card p-5">
        <h3 className="font-bold text-white">{phaseName(launch.phase)}</h3>
        <p className="mt-2 text-sm text-ink-300">
          {launch.phase === 2
            ? 'This token has graduated to a Uniswap v4 pool on Ink. Curve trading is closed; swaps go through the PonsV2MemeHook.'
            : 'This launch was rescued by the protocol owner.'}
        </p>
      </div>
    )
  }

  return (
    <div className="card p-5">
      {ready || launch.phase === 1 ? (
        <div className="mb-4 rounded-xl border border-gold/40 bg-gold/10 p-3 text-sm">
          <div className="font-semibold text-gold">
            {launch.phase === 1 ? 'Reserves swept — pool not yet created' : 'Curve sold out — ready to graduate'}
          </div>
          <p className="mt-1 text-xs text-ink-200">
            Graduation is permissionless: anyone can trigger it. Two steps: sweep the curve, then seed the v4 pool.
          </p>
          <button className="btn btn-primary mt-3 w-full" disabled={!isConnected || isPending} onClick={graduate}>
            {launch.phase === 1 ? 'Create Uniswap v4 pool' : 'Graduate'}
          </button>
        </div>
      ) : null}

      {launch.phase === 0 && !ready && (
        <>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-ink-950/70 p-1">
            {(['buy', 'sell'] as Side[]).map((s) => (
              <button
                key={s}
                onClick={() => switchSide(s)}
                className={`rounded-lg py-2 text-sm font-semibold capitalize transition ${
                  side === s ? (s === 'buy' ? 'bg-kraken text-white' : 'bg-coral text-white') : 'text-ink-300 hover:text-white'
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between">
              <label className="label">{side === 'buy' ? 'Spend (ETH)' : `Sell (${launch.symbol})`}</label>
              <button className="text-xs text-kraken-glow hover:underline" onClick={setMax}>
                max{' '}
                <span className="font-mono">
                  {side === 'buy'
                    ? ethBal
                      ? fmtEth(ethBal.value, 3)
                      : '–'
                    : tokBal !== undefined
                      ? fmtTokens(tokBal)
                      : '–'}
                </span>
              </button>
            </div>
            <input
              className="input font-mono text-lg"
              placeholder="0.0"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {side === 'buy' && (
              <div className="mt-2 flex gap-2">
                {['0.01', '0.1', '0.5', '1'].map((v) => (
                  <button key={v} className="btn btn-ghost flex-1 py-1 text-xs" onClick={() => setAmount(v)}>
                    {v} ETH
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 space-y-1 rounded-xl bg-ink-950/50 p-3 text-xs text-ink-300">
            <div className="flex justify-between">
              <span>You receive</span>
              <span className="font-mono text-white">
                {side === 'buy'
                  ? buyPrev
                    ? `${fmtTokens(buyPrev.tokensOut)} ${launch.symbol}`
                    : '–'
                  : amt > 0n
                    ? `${fmtEth(sellPrev, 6)} ETH`
                    : '–'}
              </span>
            </div>
            {buyPrev?.clamped && (
              <div className="text-gold">Buys out the curve — excess ETH is refunded and the token graduates.</div>
            )}
            <div className="flex justify-between">
              <span>Fee + creator tax</span>
              <span className="font-mono">{((Number(launch.feeBps) + Number(launch.creatorTaxBps)) / 100).toFixed(2)}%</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Slippage</span>
              <span className="flex gap-1">
                {[0.5, 1, 3].map((s) => (
                  <button
                    key={s}
                    onClick={() => setSlippage(s)}
                    className={`rounded px-1.5 py-0.5 font-mono ${slippage === s ? 'bg-kraken text-white' : 'hover:text-white'}`}
                  >
                    {s}%
                  </button>
                ))}
              </span>
            </div>
          </div>

          <button
            className={`btn mt-4 w-full py-3 text-base ${side === 'buy' ? 'btn-primary' : 'btn-sell'}`}
            disabled={!isConnected || isPending || amt === 0n}
            onClick={side === 'buy' ? buy : sell}
          >
            {!isConnected ? 'Connect a wallet' : isPending ? 'Confirm…' : side === 'buy' ? `Buy ${launch.symbol}` : `Sell ${launch.symbol}`}
          </button>
        </>
      )}

      {status && (
        <div
          className={`mt-3 rounded-lg px-3 py-2 text-xs break-words ${
            status.kind === 'ok' ? 'bg-mint/10 text-mint' : status.kind === 'err' ? 'bg-coral/10 text-coral' : 'bg-ink-800 text-ink-200'
          }`}
        >
          {status.text}
        </div>
      )}
    </div>
  )
}

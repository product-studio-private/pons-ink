import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { formatUnits, isAddress, type Address } from 'viem'
import { useReadContract } from 'wagmi'
import { useLaunch, type Launch } from '../hooks/useLaunches'
import { useHolders, useTrades, type Trade } from '../hooks/useTrades'
import { PairBadge, TokenAvatar } from '../components/TokenCard'
import { TradePanel } from '../components/TradePanel'
import { AssetIcon } from '../components/AssetIcon'
import { PriceChart } from '../components/PriceChart'
import { RANGES, windowPoints, type Point, type Range } from '../lib/chart'
import { useNow } from '../hooks/useNow'
import { ago, fmtPrice, fmtQuote, fmtTokens, pct, short } from '../lib/format'
import { launchPrice, marketCap } from '../lib/curve'
import { isStock } from '../lib/deployment'
import { LauncherTokenAbi } from '../generated/abis'

const EXPLORER = 'https://explorer.inkonchain.com'
const ROWS = 25

export function Token() {
  const { address } = useParams()
  const token = address && isAddress(address) ? (address as Address) : undefined
  const { launch, isLoading } = useLaunch(token)

  if (!token) return <NotFound msg="That is not a valid address." />
  if (isLoading && !launch) return <div className="text-sm text-ink-300">Loading…</div>
  if (!launch) return <NotFound msg="No launch found for this token on the current deployment." />
  return <TokenView launch={launch} />
}

function TokenView({ launch }: { launch: Launch }) {
  const { data: trades } = useTrades(launch.curve, launch.launchBlock)
  const { data: holders } = useHolders(launch.token, launch.launchBlock)
  const { data: socials } = useReadContract({ address: launch.token, abi: LauncherTokenAbi, functionName: 'socials' })
  const [range, setRange] = useState<Range>('1H')
  const [copied, setCopied] = useState(false)
  const now = useNow()

  const pair = launch.pair
  const dec = pair.decimals
  const price = launchPrice(launch)
  const mcap = marketCap(launch)
  const progress = launch.phase > 0 ? 100 : pct(launch.realQuote, launch.threshold)
  const raised = launch.phase > 0 ? launch.threshold : launch.realQuote
  const market = launch.phase === 0 ? 'Bonding curve' : launch.phase === 2 ? 'Uniswap v4' : launch.phase === 1 ? 'Graduating' : 'Rescued'

  const links = socials
    ? (['twitter', 'telegram', 'discord', 'website', 'farcaster'] as const)
        .map((k, i) => [k, socials[i]] as const)
        .filter(([, v]) => v)
    : []

  // market cap after every trade (execution price × supply); starts at the curve's phantom quote
  const points = useMemo<Point[]>(() => {
    const pts: Point[] = []
    if (launch.phase === 0 && launch.supply > 0n) {
      const phantom = (launch.quoteReserve * launch.tokenReserve) / launch.supply
      pts.push({ t: Number(launch.launchedAt), v: Number(formatUnits(phantom, dec)) })
    }
    for (const t of [...(trades ?? [])].reverse()) {
      if (t.tokens === 0n) continue
      const p = (t.quote * 10n ** 18n) / t.tokens
      pts.push({ t: t.timestamp, v: Number(formatUnits((p * launch.supply) / 10n ** 18n, dec)) })
    }
    if (launch.phase === 0) pts.push({ t: now, v: Number(formatUnits(mcap, dec)) })
    return pts.sort((a, b) => a.t - b.t)
  }, [trades, launch, dec, mcap, now])

  const win = windowPoints(points, range, now)
  const change = win.length >= 2 && win[0].v > 0 ? ((win[win.length - 1].v - win[0].v) / win[0].v) * 100 : 0

  const copy = () => {
    void navigator.clipboard.writeText(launch.token)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="space-y-4">
      <Link to="/tokens" className="chip py-2.5 pr-4 pl-3">
        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m12 5-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back
      </Link>

      {/* About */}
      <section className="panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0 max-w-xl">
            <h2 className="text-[18px] font-medium text-white">About</h2>
            <p className="mt-2 text-[14px] leading-6 text-ink-200">
              {launch.description || `${launch.name} launched on the bonding curve with no presale or team allocation.`}
            </p>
            <div className="mt-4 flex flex-wrap gap-6 text-[13px]">
              <div>
                <div className="text-ink-300">Creator</div>
                <div className="mt-0.5 text-white">
                  {short(launch.deployer)}{' '}
                  <span className="text-ink-300">· {Number(launch.creatorTaxBps) / 100}% tax</span>
                </div>
              </div>
              <div>
                <div className="text-ink-300">Supply</div>
                <div className="mt-0.5 text-white">
                  {fmtTokens(launch.supply)} {launch.symbol}{' '}
                  <span className="text-ink-300">· fixed at launch</span>
                </div>
              </div>
              <div>
                <div className="text-ink-300">Trade fee</div>
                <div className="mt-0.5 text-white">{Number(launch.feeBps) / 100}%</div>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="chip" onClick={copy}>
              <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="7" y="7" width="10" height="10" rx="2" />
                <path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
              </svg>
              {copied ? 'Copied' : 'Contract'}
            </button>
            <a className="chip" href={`${EXPLORER}/address/${launch.token}`} target="_blank" rel="noreferrer">
              Explorer
            </a>
            {launch.phase === 2 && (
              <a className="chip" href={`${EXPLORER}/address/${launch.curve}`} target="_blank" rel="noreferrer">
                Pool
              </a>
            )}
            {links.map(([k, v]) => (
              <a
                key={k}
                className="chip capitalize"
                href={v.startsWith('http') ? v : `https://${v}`}
                target="_blank"
                rel="noreferrer"
              >
                {k === 'twitter' ? 'X' : k}
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* summary + market */}
      <div className="grid gap-4 lg:grid-cols-[350px_1fr]">
        <section className="panel p-6">
          <div className="flex items-center gap-3.5">
            <TokenAvatar launch={launch} className="h-12 w-12 rounded-[14px] text-base" />
            <div className="min-w-0">
              <h1 className="truncate text-[18px] font-medium text-white">{launch.name}</h1>
              <div className="mt-0.5 flex items-center gap-2 text-[13px] text-ink-300">
                <span className="truncate">{launch.symbol}</span>
                <PairBadge launch={launch} />
              </div>
            </div>
          </div>

          <div className="subpanel mt-5 p-4">
            <div className="flex items-center justify-between text-[13px]">
              <span className="font-medium text-white">{launch.phase === 0 ? 'Bonding curve' : 'Graduated'}</span>
              <span className="text-ink-300">
                {launch.phase === 0 ? `${progress.toFixed(0)}% to graduation` : 'Uniswap v4 pool'}
              </span>
            </div>
            <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/[0.1]">
              <div className="h-full rounded-full bg-kraken" style={{ width: `${Math.max(progress, 1)}%` }} />
            </div>
            <p className="mt-3 text-[13px] leading-5 text-ink-300">
              {fmtQuote(raised, dec, 6)} of {fmtQuote(launch.threshold, dec, 4)} {pair.symbol} raised.{' '}
              {launch.phase === 0
                ? 'At the threshold the curve closes and liquidity moves to a Uniswap v4 pool.'
                : 'The curve closed and liquidity is locked in a Uniswap v4 pool.'}
            </p>
          </div>

          {isStock(pair) && (
            <div className="subpanel mt-3 flex gap-3 p-4 text-[13px] leading-5 text-ink-300">
              <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M10 3 2.5 16h15L10 3z" strokeLinejoin="round" />
                <path d="M10 8v4M10 14v.5" strokeLinecap="round" />
              </svg>
              This market is priced in a tokenized equity ({pair.symbol}), which is not offered to traders in the
              United States. You can still view the market.
            </div>
          )}

          <TradePanel launch={launch} />
        </section>

        <section className="panel p-6">
          <div className="stat-row">
            <div>
              <div className="stat-k">Price</div>
              <div className="stat-v">
                {fmtPrice(price, dec)} {pair.symbol}
              </div>
            </div>
            <div>
              <div className="stat-k">Market cap</div>
              <div className="stat-v">
                {fmtQuote(mcap, dec, 2)} {pair.symbol}
              </div>
            </div>
            <div>
              <div className="stat-k">Raised</div>
              <div className="stat-v">
                {fmtQuote(raised, dec, 4)} {pair.symbol}
              </div>
            </div>
            <div>
              <div className="stat-k">Market</div>
              <div className="stat-v">{market}</div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-[32px] leading-none font-medium tracking-tight text-white">
                {fmtQuote(mcap, dec, 2)} <span className="text-[20px] text-ink-300">{pair.symbol}</span>
              </div>
              <div className="mt-2 text-[13px]">
                <span className={change >= 0 ? 'text-mint' : 'text-coral'}>
                  {change >= 0 ? '+' : ''}
                  {change.toFixed(2)}%
                </span>
                <span className="ml-1.5 text-ink-300">{range}</span>
              </div>
            </div>
            <div className="seg seg-xs">
              {RANGES.map(([r]) => (
                <button key={r} className={`seg-item ${range === r ? 'is-active' : ''}`} onClick={() => setRange(r)}>
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <PriceChart points={points} range={range} unit={pair.symbol} now={now} />
          </div>
        </section>
      </div>

      <Activity launch={launch} trades={trades ?? []} holders={holders ?? []} now={now} />
    </div>
  )
}

function Activity({
  launch,
  trades,
  holders,
  now,
}: {
  launch: Launch
  trades: Trade[]
  holders: { account: Address; balance: bigint }[]
  now: number
}) {
  const [tab, setTab] = useState<'trades' | 'holders'>('trades')
  const [page, setPage] = useState(1)
  const list = tab === 'trades' ? trades : holders
  const pages = Math.max(1, Math.ceil(list.length / ROWS))
  const cur = Math.min(page, pages)
  const from = (cur - 1) * ROWS
  const market = launch.phase === 0 ? 'Bonding curve' : 'Uniswap v4'

  return (
    <section className="panel p-6">
      <div className="flex items-center justify-between">
        <div className="seg">
          {(
            [
              ['trades', 'Recent trades'],
              ['holders', 'Holders'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              className={`seg-item ${tab === k ? 'is-active' : ''}`}
              onClick={() => {
                setTab(k)
                setPage(1)
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[12px] text-ink-300">{list.length}</span>
      </div>

      {list.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-300">
          {tab === 'trades' ? 'No trades yet.' : 'No holders yet.'}
        </p>
      ) : tab === 'trades' ? (
        <ul className="mt-4 divide-y divide-white/[0.06]">
          {trades.slice(from, from + ROWS).map((t) => (
            <li key={t.tx + t.account + t.side} className="flex items-center gap-4 py-3.5">
              <span className={`grid h-6 w-6 place-items-center ${t.side === 'buy' ? 'text-mint' : 'text-coral'}`}>
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  {t.side === 'buy' ? (
                    <path d="M5 15 15 5M8 5h7v7" strokeLinecap="round" strokeLinejoin="round" />
                  ) : (
                    <path d="M15 5 5 15M12 15H5V8" strokeLinecap="round" strokeLinejoin="round" />
                  )}
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] text-white">
                  {fmtTokens(t.tokens)} {launch.symbol}
                </div>
                <div className="text-[12px] text-ink-300">{short(t.account)}</div>
              </div>
              <div className="text-right">
                <div className="flex items-center justify-end gap-1.5 text-[14px] text-white">
                  {fmtQuote(t.quote, launch.pair.decimals, 6)}
                  <AssetIcon symbol={launch.pair.symbol} />
                </div>
                <div className="text-[12px] text-ink-300">{market}</div>
              </div>
              <div className="w-14 text-right text-[12px] text-ink-300">
                {now - t.timestamp < 60 ? 'now' : `${ago(t.timestamp, now)} ago`}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="mt-4 divide-y divide-white/[0.06]">
          {holders.slice(from, from + ROWS).map((h, i) => {
            const share = launch.supply > 0n ? Number((h.balance * 10_000n) / launch.supply) / 100 : 0
            const tag =
              h.account.toLowerCase() === launch.curve.toLowerCase()
                ? 'Bonding curve'
                : h.account.toLowerCase() === launch.deployer.toLowerCase()
                  ? 'Creator'
                  : null
            return (
              <li key={h.account} className="flex items-center gap-4 py-3.5">
                <span className="w-6 text-[12px] text-ink-300">{from + i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[14px] text-white">
                    {short(h.account, 6)}
                    {tag && <span className="badge badge-outline">{tag}</span>}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[14px] text-white">
                    {fmtTokens(h.balance)} {launch.symbol}
                  </div>
                  <div className="text-[12px] text-ink-300">{share.toFixed(2)}%</div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-[12px] text-ink-300">
          <button className="chip py-1" disabled={cur === 1} onClick={() => setPage(cur - 1)}>
            ‹
          </button>
          {cur} / {pages}
          <button className="chip py-1" disabled={cur === pages} onClick={() => setPage(cur + 1)}>
            ›
          </button>
        </div>
      )}
    </section>
  )
}

function NotFound({ msg }: { msg: string }) {
  return (
    <div className="panel mx-auto max-w-md p-8 text-center">
      <div className="text-lg font-medium text-white">Not found</div>
      <p className="mt-1 text-sm text-ink-300">{msg}</p>
      <Link to="/tokens" className="chip mt-4">
        Back to explore
      </Link>
    </div>
  )
}

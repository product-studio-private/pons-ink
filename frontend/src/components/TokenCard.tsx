import { Link } from 'react-router-dom'
import type { Launch } from '../hooks/useLaunches'
import { useNow } from '../hooks/useNow'
import { ago, fmtQuote, pct, phaseName, short } from '../lib/format'
import { marketCap } from '../lib/curve'
import { isStock } from '../lib/deployment'

export function TokenAvatar({
  launch,
  className = 'h-12 w-12 rounded-[14px] text-base',
}: {
  launch: Launch
  className?: string
}) {
  if (launch.logo) {
    return <img src={launch.logo} alt="" className={`${className} shrink-0 object-cover`} />
  }
  return (
    <div className={`${className} grid shrink-0 place-items-center bg-kraken/20 font-semibold text-kraken-glow`}>
      {launch.symbol.slice(0, 3).toUpperCase()}
    </div>
  )
}

export function PhaseBadge({ phase }: { phase: number }) {
  const name = phaseName(phase)
  const cls =
    name === 'Graduated'
      ? 'badge-dark'
      : name === 'Swept'
        ? 'bg-gold/20 text-gold'
        : name === 'Rescued'
          ? 'bg-coral/20 text-coral'
          : 'badge-accent'
  return <span className={`badge ${cls}`}>{name}</span>
}

export function PairBadge({ launch }: { launch: Launch }) {
  return <span className="badge badge-outline">Paired {launch.pair.symbol}</span>
}

/** thin 4px progress rail + percent, as on the Pons explore cards */
export function ProgressRail({ launch }: { launch: Launch }) {
  const p = launch.phase > 0 ? 100 : pct(launch.realQuote, launch.threshold)
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.1]">
        <div className="h-full rounded-full bg-kraken" style={{ width: `${Math.max(p, 1)}%` }} />
      </div>
      <span className="text-[11px] tabular-nums text-ink-300">{p.toFixed(2)}%</span>
    </div>
  )
}

export function TokenCard({ launch }: { launch: Launch }) {
  const mcap = marketCap(launch)
  const graduated = launch.phase > 0
  const now = useNow()
  const recent = now - Number(launch.launchedAt) < 120

  return (
    <Link
      to={`/token/${launch.token}`}
      className="group grid gap-2.5 rounded-card border border-white/[0.06] bg-white/[0.04] p-2.5 transition
        hover:border-white/[0.14] hover:bg-white/[0.07]"
    >
      <div className="relative aspect-square overflow-hidden rounded-[14px] bg-black">
        <TokenAvatar launch={launch} className="h-full w-full text-4xl" />
        <div className="absolute top-2 left-2 flex gap-1">
          {graduated ? <PhaseBadge phase={launch.phase} /> : <span className="badge badge-accent">Ink</span>}
          {launch.pair.symbol !== 'ETH' && (
            <span className={`badge ${isStock(launch.pair) ? 'bg-gold/90 text-black' : 'badge-dark'}`}>
              {launch.pair.symbol}
            </span>
          )}
        </div>
      </div>

      <div className="px-0.5 pb-0.5">
        <div className="truncate text-[15px] font-medium text-white">{launch.name}</div>
        <div className="truncate text-[13px] text-ink-300">${launch.symbol}</div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="text-[15px] font-semibold text-white">
            {fmtQuote(mcap, launch.pair.decimals, 2)} {launch.pair.symbol}
          </span>
          <span className="text-[11px] text-ink-300">MC</span>
        </div>
        {!graduated && (
          <div className="mt-2.5">
            <ProgressRail launch={launch} />
          </div>
        )}
        <div className="mt-2.5 flex items-center justify-between text-[11px]">
          <span className="text-ink-300">{short(launch.deployer)}</span>
          <span className={recent ? 'font-medium text-kraken-glow' : 'text-ink-300'}>
            {recent ? 'now' : `${ago(launch.launchedAt, now)} ago`}
          </span>
        </div>
      </div>
    </Link>
  )
}

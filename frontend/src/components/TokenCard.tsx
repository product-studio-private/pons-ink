import { Link } from 'react-router-dom'
import type { Launch } from '../hooks/useLaunches'
import { fmtEth, pct, phaseName, short } from '../lib/format'
import { spotPrice } from '../lib/curve'

export function TokenAvatar({ launch, size = 'md' }: { launch: Launch; size?: 'md' | 'lg' }) {
  const cls = size === 'lg' ? 'h-20 w-20 text-2xl' : 'h-12 w-12'
  if (launch.logo) {
    return <img src={launch.logo} alt="" className={`${cls} shrink-0 rounded-xl object-cover`} />
  }
  return (
    <div
      className={`${cls} grid shrink-0 place-items-center rounded-xl bg-gradient-to-br from-ink-700 to-kraken font-black text-white`}
    >
      {launch.symbol.slice(0, 3).toUpperCase()}
    </div>
  )
}

export function PhaseBadge({ phase }: { phase: number }) {
  const name = phaseName(phase)
  const cls =
    name === 'Graduated'
      ? 'bg-mint/15 text-mint'
      : name === 'Swept'
        ? 'bg-gold/15 text-gold'
        : name === 'Rescued'
          ? 'bg-coral/15 text-coral'
          : 'bg-kraken/20 text-kraken-glow'
  return <span className={`badge ${cls}`}>{name}</span>
}

export function Progress({ launch }: { launch: Launch }) {
  const p = launch.phase > 0 ? 100 : pct(launch.realQuote, launch.threshold)
  return (
    <div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-ink-800">
        <div
          className="h-full rounded-full bg-gradient-to-r from-kraken to-mint transition-all"
          style={{ width: `${Math.max(p, 1)}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-ink-300">
        <span>{p.toFixed(1)}% to graduation</span>
        <span className="font-mono">
          {fmtEth(launch.phase > 0 ? launch.threshold : launch.realQuote, 3)} / {fmtEth(launch.threshold, 2)} ETH
        </span>
      </div>
    </div>
  )
}

export function TokenCard({ launch }: { launch: Launch }) {
  const price = spotPrice(launch)
  const mcap = (price * launch.supply) / 10n ** 18n
  return (
    <Link to={`/token/${launch.token}`} className="card group block p-4 transition hover:border-kraken-glow/60">
      <div className="flex items-start gap-3">
        <TokenAvatar launch={launch} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="truncate font-bold text-white group-hover:text-kraken-glow">{launch.name}</h3>
            <PhaseBadge phase={launch.phase} />
          </div>
          <div className="text-xs text-ink-300">
            <span className="font-mono">${launch.symbol}</span>
            <span className="mx-1.5">·</span>by <span className="font-mono">{short(launch.deployer)}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-ink-300/80">{launch.description || 'No description'}</p>
        </div>
      </div>
      <div className="mt-4">
        <Progress launch={launch} />
      </div>
      <div className="mt-3 flex justify-between text-xs">
        <span className="text-ink-300">
          MCap <span className="font-mono text-white">{fmtEth(mcap, 2)} ETH</span>
        </span>
        <span className="text-ink-300">
          Price <span className="font-mono text-white">{fmtEth(price, 9)}</span>
        </span>
      </div>
    </Link>
  )
}

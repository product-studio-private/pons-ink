import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { useLaunches, type Launch } from '../hooks/useLaunches'
import { useActivity, type CurveActivity } from '../hooks/useTrades'
import { useNow } from '../hooks/useNow'
import { TokenCard } from '../components/TokenCard'
import { marketCap } from '../lib/curve'
import { deployment, isStock } from '../lib/deployment'

const SORTS = ['Recent buys', 'Newest', 'Oldest', 'Market cap', 'Volume'] as const
type Sort = (typeof SORTS)[number]
const WINDOWS = [
  ['All', 0],
  ['24h', 86_400],
  ['7d', 7 * 86_400],
] as const
type Window = (typeof WINDOWS)[number][1]
const PAGE = 10

function cmpBig(a: bigint, b: bigint) {
  return a === b ? 0 : a > b ? -1 : 1
}

function sortLaunches(list: Launch[], sort: Sort, since: number, activity: Map<string, CurveActivity>) {
  const act = (l: Launch) => activity.get(l.curve.toLowerCase())
  const volume = (l: Launch) =>
    (act(l)?.trades ?? []).filter((t) => t.ts >= since).reduce((s, t) => s + t.quote, 0n)
  const out = [...list]
  switch (sort) {
    case 'Recent buys':
      return out.sort((a, b) => (act(b)?.lastBuy ?? 0) - (act(a)?.lastBuy ?? 0) || cmpBig(a.launchedAt, b.launchedAt))
    case 'Newest':
      return out.sort((a, b) => cmpBig(a.launchedAt, b.launchedAt))
    case 'Oldest':
      return out.sort((a, b) => cmpBig(b.launchedAt, a.launchedAt))
    case 'Market cap':
      return out.sort((a, b) => cmpBig(marketCap(a), marketCap(b)))
    case 'Volume':
      return out.sort((a, b) => cmpBig(volume(a), volume(b)))
  }
}

export function Home() {
  const { isConnected } = useAccount()
  const { data, isLoading, error } = useLaunches()
  const { data: activity } = useActivity(deployment ? BigInt(deployment.startBlock) : undefined)
  const [q, setQ] = useState('')
  const [stocks, setStocks] = useState(false)
  const [sort, setSort] = useState<Sort>('Recent buys')
  const [win, setWin] = useState<Window>(0)
  const [gradPage, setGradPage] = useState(1)
  const [livePage, setLivePage] = useState(1)
  const now = useNow(60_000)

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (data ?? []).filter((l) => {
      if (stocks && !isStock(l.pair)) return false
      return (
        !s || l.name.toLowerCase().includes(s) || l.symbol.toLowerCase().includes(s) || l.token.toLowerCase() === s
      )
    })
  }, [data, q, stocks])

  const since = win ? now - win : 0
  const graduated = useMemo(
    () => sortLaunches(filtered.filter((l) => l.phase > 0), 'Newest', since, activity ?? new Map()),
    [filtered, since, activity],
  )
  const live = useMemo(
    () => sortLaunches(filtered.filter((l) => l.phase === 0), sort, since, activity ?? new Map()),
    [filtered, sort, since, activity],
  )

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="flex min-w-0 flex-1 items-center gap-2.5 rounded-full border border-white/[0.1] bg-white/[0.04] px-4 py-2.5 text-[14px] focus-within:border-kraken/60">
          <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-ink-300" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="9" cy="9" r="6" />
            <path d="m14 14 3.5 3.5" strokeLinecap="round" />
          </svg>
          <input
            className="min-w-0 flex-1 bg-transparent text-white outline-none placeholder:text-ink-300/70"
            placeholder="Search tokens"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setGradPage(1)
              setLivePage(1)
            }}
          />
          <kbd className="hidden rounded-md border border-white/[0.12] px-1.5 py-0.5 text-[10px] text-ink-300 sm:block">
            /
          </kbd>
        </label>
        <button className={`chip ${stocks ? 'is-active' : ''}`} onClick={() => setStocks((s) => !s)}>
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M3 14l4-5 3 3 4-6 3 3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Stocks
        </button>
        {isConnected && (
          <Link to="/launch" className="chip border-kraken/60 bg-kraken text-white hover:bg-kraken-light">
            <span className="text-base leading-none">+</span> Create
          </Link>
        )}
      </div>

      {error && <div className="panel border-coral/40 p-4 text-sm text-coral">{error.message}</div>}

      {/* graduated */}
      <Collection
        title="Graduated"
        count={graduated.length}
        subtitle="Curves that filled and now trade in a locked Uniswap v4 pool on Ink."
        items={graduated}
        page={gradPage}
        setPage={setGradPage}
        glow
        empty={isLoading ? 'Loading…' : 'Nothing has graduated yet.'}
      />

      {/* still bonding */}
      <Collection
        title="Explore"
        count={live.length}
        subtitle="Tokens still climbing toward graduation on Ink."
        items={live}
        page={livePage}
        setPage={setLivePage}
        empty={
          isLoading
            ? 'Loading…'
            : isConnected
              ? 'Nothing is bonding right now — launch the first one.'
              : 'Nothing is bonding right now. Connect a wallet to launch one.'
        }
        controls={
          <div className="flex flex-wrap items-center gap-2">
            <div className="seg">
              {SORTS.map((s) => (
                <button
                  key={s}
                  className={`seg-item ${sort === s ? 'is-active' : ''}`}
                  onClick={() => {
                    setSort(s)
                    setLivePage(1)
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
            <div className="seg">
              {WINDOWS.map(([label, secs]) => (
                <button
                  key={label}
                  className={`seg-item ${win === secs ? 'is-active' : ''}`}
                  onClick={() => setWin(secs)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        }
      />
    </div>
  )
}

function Collection({
  title,
  count,
  subtitle,
  items,
  page,
  setPage,
  controls,
  glow,
  empty,
}: {
  title: string
  count: number
  subtitle: string
  items: Launch[]
  page: number
  setPage: (p: number) => void
  controls?: ReactNode
  glow?: boolean
  empty: string
}) {
  const pages = Math.max(1, Math.ceil(items.length / PAGE))
  const cur = Math.min(page, pages)
  const slice = items.slice((cur - 1) * PAGE, cur * PAGE)

  return (
    <section className={`panel p-6 ${glow ? 'glow-ring' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-[22px] font-medium tracking-tight text-white">{title}</h2>
            <span className="rounded-full border border-white/[0.1] bg-white/[0.04] px-2.5 py-1 text-[12px] text-ink-300">
              {count.toLocaleString()} {count === 1 ? 'token' : 'tokens'}
            </span>
          </div>
          <p className="mt-2 max-w-xs text-[13px] leading-5 text-ink-300">{subtitle}</p>
        </div>
        {controls}
      </div>

      {slice.length === 0 ? (
        <div className="mt-6 rounded-card border border-dashed border-white/[0.1] py-12 text-center text-sm text-ink-300">
          {empty}
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {slice.map((l) => (
            <TokenCard key={l.token} launch={l} />
          ))}
        </div>
      )}

      {pages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-4">
          <button className="text-ink-300 disabled:opacity-30" disabled={cur === 1} onClick={() => setPage(cur - 1)}>
            ‹
          </button>
          <div className="seg">
            {pageList(cur, pages).map((p, i) =>
              p === 0 ? (
                <span key={`e${i}`} className="seg-item">
                  …
                </span>
              ) : (
                <button key={p} className={`seg-item ${p === cur ? 'is-active' : ''}`} onClick={() => setPage(p)}>
                  {p}
                </button>
              ),
            )}
          </div>
          <button className="text-ink-300 disabled:opacity-30" disabled={cur === pages} onClick={() => setPage(cur + 1)}>
            ›
          </button>
        </div>
      )}
    </section>
  )
}

/** 1 2 … 87 style page list; 0 marks an ellipsis */
function pageList(cur: number, total: number): number[] {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1)
  const s = new Set([1, 2, cur - 1, cur, cur + 1, total - 1, total].filter((p) => p >= 1 && p <= total))
  const sorted = [...s].sort((a, b) => a - b)
  const out: number[] = []
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push(0)
    out.push(p)
  })
  return out
}

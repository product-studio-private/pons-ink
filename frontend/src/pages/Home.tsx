import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLaunches } from '../hooks/useLaunches'
import { TokenCard } from '../components/TokenCard'

type Filter = 'all' | 'bonding' | 'graduated'

export function Home() {
  const { data, isLoading, error } = useLaunches()
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')

  const list = (data ?? []).filter((l) => {
    if (filter === 'bonding' && l.phase !== 0) return false
    if (filter === 'graduated' && l.phase === 0) return false
    const s = q.trim().toLowerCase()
    return !s || l.name.toLowerCase().includes(s) || l.symbol.toLowerCase().includes(s) || l.token.toLowerCase() === s
  })

  return (
    <div>
      <section className="mb-8 flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
        <div>
          <h1 className="text-4xl font-black tracking-tight text-white">
            Launch on <span className="bg-gradient-to-r from-kraken-glow to-mint bg-clip-text text-transparent">Ink</span>.
          </h1>
          <p className="mt-2 max-w-xl text-ink-300">
            Fair-launch bonding curves that graduate into Uniswap v4 pools with permanently locked liquidity. Fees flow
            back to creators and buybacks through the Pons hook.
          </p>
        </div>
        <Link to="/launch" className="btn btn-primary px-6 py-3 text-base">
          Launch a token
        </Link>
      </section>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-xl bg-ink-900/70 p-1">
          {(['all', 'bonding', 'graduated'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-1.5 text-sm capitalize ${filter === f ? 'bg-ink-700 text-white' : 'text-ink-300 hover:text-white'}`}
            >
              {f}
            </button>
          ))}
        </div>
        <input
          className="input max-w-xs"
          placeholder="Search name, symbol or address"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="ml-auto text-xs text-ink-300">{data?.length ?? 0} launches</span>
      </div>

      {error && <div className="card border-coral/40 p-4 text-sm text-coral">{error.message}</div>}
      {isLoading && <div className="text-sm text-ink-300">Loading launches…</div>}

      {data && data.length === 0 && (
        <div className="card p-10 text-center">
          <div className="text-lg font-bold text-white">Nothing launched yet</div>
          <p className="mt-1 text-sm text-ink-300">Be the first — it costs the launch fee plus gas on the local fork.</p>
          <Link to="/launch" className="btn btn-primary mt-4">
            Launch a token
          </Link>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((l) => (
          <TokenCard key={l.token} launch={l} />
        ))}
      </div>
    </div>
  )
}

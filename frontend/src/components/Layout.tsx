import { Link, NavLink, Outlet } from 'react-router-dom'
import { useBlockNumber } from 'wagmi'
import { WalletButton } from './WalletButton'
import { deployment, deploymentName } from '../lib/deployment'
import { RPC_URL } from '../lib/wagmi'
import { short } from '../lib/format'

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-kraken to-kraken-light text-white shadow-[0_0_20px_rgba(113,50,245,0.6)]">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M12 3c4 0 7 2.8 7 6.5 0 2-1 3.5-2.5 4.5l1.5 6-3-2-3 2-3-2-3 2 1.5-6C6 13 5 11.5 5 9.5 5 5.8 8 3 12 3z" />
          <circle cx="9.5" cy="9" r="1" fill="currentColor" />
          <circle cx="14.5" cy="9" r="1" fill="currentColor" />
        </svg>
      </span>
      <span className="text-lg font-black tracking-tight text-white">
        INK<span className="text-kraken-glow">PAD</span>
      </span>
      <span className="hidden rounded-md border border-ink-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-ink-300 sm:inline">
        Pons V2 · Ink
      </span>
    </Link>
  )
}

export function Layout() {
  const { data: block } = useBlockNumber({ watch: true })
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-ink-800/80 bg-ink-950/70 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-6">
            <Logo />
            <nav className="hidden items-center gap-1 text-sm sm:flex">
              {[
                ['/', 'Tokens'],
                ['/launch', 'Launch'],
              ].map(([to, label]) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) =>
                    `rounded-lg px-3 py-1.5 transition ${isActive ? 'bg-ink-800 text-white' : 'text-ink-300 hover:text-white'}`
                  }
                >
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/launch" className="btn btn-ghost hidden sm:inline-flex">
              + Launch
            </Link>
            <WalletButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        {deployment ? (
          <Outlet />
        ) : (
          <div className="card mx-auto max-w-xl p-8 text-center">
            <h2 className="text-xl font-bold text-white">No deployment found</h2>
            <p className="mt-2 text-sm text-ink-300">
              Expected <code className="font-mono">contractsV2/deployments/{deploymentName}.json</code>. Start the
              local stack first:
            </p>
            <pre className="mt-4 rounded-xl bg-ink-950 p-4 text-left font-mono text-xs text-mint">
              cd contractsV2 && ./dev.sh up
            </pre>
          </div>
        )}
      </main>

      <footer className="border-t border-ink-800/80 py-4 text-center text-xs text-ink-300">
        <span className="font-mono">{RPC_URL}</span>
        {deployment && (
          <>
            <span className="mx-2">·</span>chain {deployment.chainId}
            <span className="mx-2">·</span>factory <span className="font-mono">{short(deployment.factory)}</span>
          </>
        )}
        {block !== undefined && (
          <>
            <span className="mx-2">·</span>
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-mint align-middle" /> block{' '}
            {block.toString()}
          </>
        )}
      </footer>
    </div>
  )
}

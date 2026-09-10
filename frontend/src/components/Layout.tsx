import { Link, NavLink, Outlet } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { WalletButton } from './WalletButton'
import { deployment, deploymentName } from '../lib/deployment'

export function Logo({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <span className={`${className} grid place-items-center rounded-[11px] bg-kraken text-white shadow-panel`}>
      <svg viewBox="0 0 24 24" className="h-[58%] w-[58%]" fill="none" stroke="currentColor" strokeWidth="2.2">
        <path d="M12 3c4 0 7 2.8 7 6.5 0 2-1 3.5-2.5 4.5l1.5 6-3-2-3 2-3-2-3 2 1.5-6C6 13 5 11.5 5 9.5 5 5.8 8 3 12 3z" />
        <circle cx="9.5" cy="9" r="1" fill="currentColor" />
        <circle cx="14.5" cy="9" r="1" fill="currentColor" />
      </svg>
    </span>
  )
}

export function Layout() {
  const { isConnected } = useAccount()
  const links: [string, string][] = [['/tokens', 'Explore']]
  if (isConnected) links.push(['/launch', 'Launch'])

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 bg-black/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[920px] items-center justify-between gap-4 px-6">
          <div className="flex items-center gap-4">
            <Link to="/" aria-label="Home" className="transition hover:opacity-80">
              <Logo />
            </Link>
            <nav className="seg">
              {links.map(([to, label]) => (
                <NavLink key={to} to={to} className={({ isActive }) => `seg-item ${isActive ? 'is-active' : ''}`}>
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>
          <WalletButton />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1080px] flex-1 px-6 pt-10 pb-4">
        {deployment ? (
          <Outlet />
        ) : (
          <div className="panel mx-auto max-w-xl p-8 text-center">
            <h2 className="text-xl font-semibold text-white">No deployment found</h2>
            <p className="mt-2 text-sm text-ink-300">
              Expected <code className="font-mono">contractsV2/deployments/{deploymentName}.json</code>. Start the
              local stack first:
            </p>
            <pre className="mt-4 rounded-[14px] bg-black p-4 text-left font-mono text-xs text-kraken-glow">
              cd contractsV2 && ./dev.sh up
            </pre>
          </div>
        )}
      </main>
    </div>
  )
}

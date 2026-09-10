import { Link, useParams } from 'react-router-dom'
import { isAddress, type Address } from 'viem'
import { useReadContract } from 'wagmi'
import { useLaunch } from '../hooks/useLaunches'
import { useTrades } from '../hooks/useTrades'
import { PhaseBadge, Progress, TokenAvatar } from '../components/TokenCard'
import { TradePanel } from '../components/TradePanel'
import { fmtEth, fmtTokens, short } from '../lib/format'
import { launchPrice, tokensSold } from '../lib/curve'
import { deployment } from '../lib/deployment'
import { LauncherTokenAbi } from '../generated/abis'

export function Token() {
  const { address } = useParams()
  const token = address && isAddress(address) ? (address as Address) : undefined
  const { launch, isLoading } = useLaunch(token)
  const { data: trades } = useTrades(launch?.curve, launch?.launchBlock)
  const { data: socials } = useReadContract({
    address: token,
    abi: LauncherTokenAbi,
    functionName: 'socials',
    query: { enabled: !!token },
  })

  if (!token) return <NotFound msg="That is not a valid address." />
  if (isLoading && !launch) return <div className="text-sm text-ink-300">Loading…</div>
  if (!launch) return <NotFound msg="No launch found for this token on the current deployment." />

  const price = launchPrice(launch)
  const mcap = (price * launch.supply) / 10n ** 18n
  const sold = tokensSold(launch)
  const links = socials
    ? (['twitter', 'telegram', 'discord', 'website', 'farcaster'] as const)
        .map((k, i) => [k, socials[i]] as const)
        .filter(([, v]) => v)
    : []

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <div className="card p-6">
          <div className="flex flex-wrap items-start gap-4">
            <TokenAvatar launch={launch} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-black text-white">{launch.name}</h1>
                <span className="font-mono text-ink-300">${launch.symbol}</span>
                <PhaseBadge phase={launch.phase} />
              </div>
              <p className="mt-2 text-sm text-ink-300">{launch.description || 'No description'}</p>
              {links.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  {links.map(([k, v]) => (
                    <a
                      key={k}
                      href={v.startsWith('http') ? v : `https://${v}`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md border border-ink-600 px-2 py-0.5 capitalize text-ink-200 hover:border-kraken-glow"
                    >
                      {k}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="mt-6">
            <Progress launch={launch} />
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat k={launch.phase === 0 ? 'Price' : 'Pool seed price'} v={`${fmtEth(price, 9)} ETH`} />
            <Stat k="Market cap" v={`${fmtEth(mcap, 3)} ETH`} />
            <Stat k="Raised" v={`${fmtEth(launch.phase > 0 ? launch.threshold : launch.realQuote, 4)} ETH`} />
            <Stat k="Sold" v={`${fmtTokens(sold)} / ${fmtTokens(launch.supply)}`} />
          </div>
        </div>

        <div className="card p-6">
          <h2 className="text-sm font-bold text-white">Trades</h2>
          {!trades?.length ? (
            <p className="mt-3 text-xs text-ink-300">No trades yet.</p>
          ) : (
            <table className="mt-3 w-full text-xs">
              <thead className="text-left text-ink-300">
                <tr>
                  <th className="pb-2 font-medium">Side</th>
                  <th className="pb-2 font-medium">Account</th>
                  <th className="pb-2 text-right font-medium">ETH</th>
                  <th className="pb-2 text-right font-medium">{launch.symbol}</th>
                  <th className="pb-2 text-right font-medium">Block</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {trades.slice(0, 50).map((t) => (
                  <tr key={t.tx + t.account} className="border-t border-ink-800">
                    <td className={`py-1.5 font-semibold ${t.side === 'buy' ? 'text-mint' : 'text-coral'}`}>{t.side}</td>
                    <td className="py-1.5 text-ink-200">{short(t.account)}</td>
                    <td className="py-1.5 text-right text-white">{fmtEth(t.quote, 5)}</td>
                    <td className="py-1.5 text-right text-white">{fmtTokens(t.tokens)}</td>
                    <td className="py-1.5 text-right text-ink-300">{t.block.toString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <TradePanel launch={launch} />
        <div className="card p-5 text-xs">
          <h3 className="text-sm font-bold text-white">Details</h3>
          <dl className="mt-3 space-y-2 text-ink-300">
            <Addr k="Token" v={launch.token} />
            <Addr k="Curve" v={launch.curve} />
            <Addr k="Creator" v={launch.deployer} />
            <Addr k="Fee recipient" v={launch.creatorFeeRecipient} />
            {deployment && <Addr k="Hook" v={deployment.memeHook} />}
            <div className="flex justify-between">
              <dt>Creator tax</dt>
              <dd className="font-mono text-white">{Number(launch.creatorTaxBps) / 100}%</dd>
            </div>
            <div className="flex justify-between">
              <dt>Buyback</dt>
              <dd className="font-mono text-white">{launch.buybackEnabled ? 'on' : 'off'}</dd>
            </div>
            <div className="flex justify-between">
              <dt>v4 pool</dt>
              <dd className="font-mono text-white">
                {launch.poolFee / 10_000}% · ts {launch.tickSpacing}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  )
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-xl bg-ink-950/60 p-3">
      <div className="text-[11px] uppercase tracking-wide text-ink-300">{k}</div>
      <div className="mt-1 truncate font-mono text-sm text-white">{v}</div>
    </div>
  )
}

function Addr({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt>{k}</dt>
      <dd className="font-mono text-white">
        <button className="hover:text-kraken-glow" title={v} onClick={() => navigator.clipboard.writeText(v)}>
          {short(v, 6)}
        </button>
      </dd>
    </div>
  )
}

function NotFound({ msg }: { msg: string }) {
  return (
    <div className="card mx-auto max-w-md p-8 text-center">
      <div className="text-lg font-bold text-white">Not found</div>
      <p className="mt-1 text-sm text-ink-300">{msg}</p>
      <Link to="/" className="btn btn-ghost mt-4">
        Back to tokens
      </Link>
    </div>
  )
}

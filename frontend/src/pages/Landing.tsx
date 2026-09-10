import { Link } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { useLaunches } from '../hooks/useLaunches'
import { TokenCard } from '../components/TokenCard'
import { WalletButton } from '../components/WalletButton'
import { fmtEth } from '../lib/format'

const FEATURES: [string, string][] = [
  ['Fair launch', 'Every token starts on a constant-product bonding curve. No presale, no team allocation, no snipers.'],
  ['Graduates to Uniswap v4', 'When the curve fills, liquidity is seeded into a v4 pool and the LP position is locked forever.'],
  ['Any Kraken pair', 'Launch against ETH, kBTC, kHYPE, USDC or tokenized stocks like TSLAx and NVDAx.'],
]

export function Landing() {
  const { isConnected } = useAccount()
  const { data } = useLaunches()
  const launches = data ?? []
  const graduated = launches.filter((l) => l.phase > 0).length
  const raised = launches
    .filter((l) => l.pair.decimals === 18 && l.pair.symbol === 'ETH')
    .reduce((acc, l) => acc + (l.phase > 0 ? l.threshold : l.realQuote), 0n)
  const trending = launches.slice(0, 5)

  return (
    <div className="space-y-12 py-4">
      <section className="mx-auto max-w-2xl text-center">
        <span className="badge badge-outline">Ink · chain 57073</span>
        <h1 className="mt-6 text-[44px] leading-[1.05] font-medium tracking-tight text-white sm:text-[56px]">
          Launch on <span className="text-kraken-glow">Ink</span>.
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-[17px] leading-7 text-ink-300">
          Bonding-curve launches that graduate into Uniswap v4 with permanently locked liquidity.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link to="/tokens" className="btn btn-ghost px-6 py-3 text-[15px]">
            Explore tokens
          </Link>
          {isConnected ? (
            <Link to="/launch" className="btn btn-primary px-6 py-3 text-[15px]">
              Launch a token
            </Link>
          ) : (
            <WalletButton />
          )}
        </div>
      </section>

      <section className="panel grid divide-y divide-white/[0.08] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Stat k="Launches" v={launches.length.toString()} />
        <Stat k="Graduated" v={graduated.toString()} />
        <Stat k="Raised in ETH markets" v={`${fmtEth(raised, 2)} ETH`} />
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        {FEATURES.map(([title, body], i) => (
          <div key={title} className="panel p-6">
            <div className="grid h-8 w-8 place-items-center rounded-[10px] bg-kraken/20 text-[13px] font-semibold text-kraken-glow">
              {i + 1}
            </div>
            <h3 className="mt-4 text-[16px] font-medium text-white">{title}</h3>
            <p className="mt-2 text-[13px] leading-5 text-ink-300">{body}</p>
          </div>
        ))}
      </section>

      {trending.length > 0 && (
        <section className="panel p-6">
          <div className="flex items-end justify-between">
            <h2 className="text-[18px] font-medium text-white">Latest launches</h2>
            <Link to="/tokens" className="text-[13px] text-kraken-glow hover:underline">
              View all →
            </Link>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {trending.map((l) => (
              <TokenCard key={l.token} launch={l} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="p-6 text-center">
      <div className="text-[12px] text-ink-300">{k}</div>
      <div className="mt-1 text-[26px] font-medium tracking-tight text-white">{v}</div>
    </div>
  )
}

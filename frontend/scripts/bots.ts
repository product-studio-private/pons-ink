/**
 * Trading bots for the local Anvil fork (`./dev.sh bots`, or `node scripts/bots.ts`).
 *
 * Dev accounts #1-#9 randomly launch tokens (ETH or an approved ERC-20 pair they
 * hold), buy/sell on the bonding curves, create the v4 pool once a curve is swept,
 * then add liquidity and swap on the graduated pools through LocalV4Router.
 * Every action is logged; failures are caught, counted and never stop the run.
 * A summary + per-launch state check is printed at the end.
 *
 *   node scripts/bots.ts [--ticks 200] [--interval 1500] [--seed 42] [--rpc http://127.0.0.1:8545]
 *   node scripts/bots.ts --report          only print the state of every launch
 *
 * Needs Node >= 22.6 (runs TypeScript directly). Local development only.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  erc20Abi,
  formatUnits,
  http,
  keccak256,
  parseAbiItem,
  parseUnits,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import { BondingCurveAbi, LaunchFactoryAbi, LocalV4RouterAbi, MemeHookAbi } from '../src/generated/abis.ts'

// ---------------------------------------------------------------- config

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i].replace(/^--/, '')
  const v = process.argv[i + 1]
  if (v !== undefined && !v.startsWith('--')) args.set(k, process.argv[++i])
  else args.set(k, '')
}
const REPORT_ONLY = args.has('report')
const TICKS = Number(args.get('ticks') ?? 200) // 0 = run forever
const INTERVAL = Number(args.get('interval') ?? 1500)
const RPC = args.get('rpc') ?? 'http://127.0.0.1:8545'
let seed = Number(args.get('seed') ?? Date.now() % 100_000)

interface PairToken {
  address: Address
  symbol: string
  decimals: number
  phantomQuote: string
  graduationThreshold: string
}
interface Deployment {
  chainId: number
  startBlock: number
  factory: Address
  memeHook: Address
  v4Router?: Address
  pairTokens: PairToken[]
}

const here = dirname(fileURLToPath(import.meta.url))
const deployment: Deployment = JSON.parse(
  readFileSync(resolve(here, '../../contractsV2/deployments/local.json'), 'utf8'),
)
if (!deployment.v4Router) throw new Error('local.json has no v4Router - rerun ./dev.sh deploy')
const ROUTER = deployment.v4Router
const NATIVE: PairToken = { address: zeroAddress, symbol: 'ETH', decimals: 18, phantomQuote: '', graduationThreshold: '' }
const pairFor = (a: Address): PairToken =>
  a === zeroAddress ? NATIVE : (deployment.pairTokens.find((p) => p.address.toLowerCase() === a.toLowerCase()) ?? NATIVE)

// anvil's default mnemonic; #0 is the deployer/owner, bots use #1-#9
const MNEMONIC = 'test test test test test test test test test test test junk'
const bots = Array.from({ length: 9 }, (_, i) => mnemonicToAccount(MNEMONIC, { addressIndex: i + 1 }))

const chain = {
  id: deployment.chainId,
  name: 'Ink (anvil fork)',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
} as const
const pub = createPublicClient({ chain, transport: http(RPC) })
const wallets = bots.map((account) => createWalletClient({ account, chain, transport: http(RPC) }))

const factory = { address: deployment.factory, abi: LaunchFactoryAbi } as const
const hook = { address: deployment.memeHook, abi: MemeHookAbi } as const
const router = { address: ROUTER, abi: LocalV4RouterAbi } as const

// ---------------------------------------------------------------- helpers

// deterministic PRNG so a run can be replayed with --seed
function rand(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]
const between = (lo: number, hi: number) => lo + rand() * (hi - lo)
// fraction (0-1) of a bigint, 6 decimal places of precision
const frac = (x: bigint, f: number) => (x * BigInt(Math.floor(f * 1_000_000))) / 1_000_000n

const short = (a: Address) => `${a.slice(0, 6)}…${a.slice(-4)}`
const fmt = (v: bigint, decimals: number, digits = 4) => {
  const n = Number(formatUnits(v, decimals))
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`
  return n.toLocaleString('en-US', { maximumFractionDigits: digits })
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const NAMES = [
  ['Ink Pepe', 'IPEPE'],
  ['Kraken Cat', 'KCAT'],
  ['Squid Coin', 'SQUID'],
  ['Purple Frog', 'PFROG'],
  ['Tentacle', 'TNTCL'],
  ['Deep Sea Doge', 'DSDOGE'],
  ['Blot Rocket', 'BLOTR'],
  ['Ink Drop', 'DROP'],
  ['Cuttlefish', 'CUTL'],
  ['Octo Moon', 'OCTO'],
  ['Wen Graduate', 'WEN'],
  ['Nautilus', 'NAUT'],
]

interface Launch {
  token: Address
  curve: Address
  pair: PairToken
  symbol: string
  phase: number // 0 bonding, 1 swept, 2 pool created, 3 rescued
  threshold: bigint
  poolFee: number
  tickSpacing: number
}

const tokenLaunched = parseAbiItem(
  'event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)',
)

const launches = new Map<Address, Launch>()
let scannedTo = BigInt(deployment.startBlock) - 1n

async function refreshLaunches() {
  const head = await pub.getBlockNumber()
  if (head > scannedTo) {
    const logs = await pub.getLogs({ address: deployment.factory, event: tokenLaunched, fromBlock: scannedTo + 1n, toBlock: head })
    for (const l of logs) {
      const token = l.args.token!
      if (!launches.has(token)) {
        const symbol = await pub.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' })
        launches.set(token, {
          token,
          curve: l.args.curve!,
          pair: pairFor(l.args.pairToken!),
          symbol,
          phase: 0,
          threshold: l.args.graduationThreshold!,
          poolFee: 0,
          tickSpacing: 0,
        })
      }
    }
    scannedTo = head
  }
  for (const l of launches.values()) {
    const s = await pub.readContract({ ...factory, functionName: 'getLaunchedToken', args: [l.token] })
    l.phase = s.phase
    l.poolFee = s.poolFee
    l.tickSpacing = s.tickSpacing
  }
}

const approved = new Set<string>()
async function ensureApproval(i: number, token: Address, spender: Address) {
  const k = `${i}:${token}:${spender}`
  if (approved.has(k)) return
  const allowance = await pub.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [bots[i].address, spender] })
  if (allowance < 2n ** 200n) {
    const h = await wallets[i].writeContract({ address: token, abi: erc20Abi, functionName: 'approve', args: [spender, 2n ** 256n - 1n] })
    await pub.waitForTransactionReceipt({ hash: h })
  }
  approved.add(k)
}

async function quoteBalance(i: number, pair: PairToken): Promise<bigint> {
  if (pair.address === zeroAddress) return pub.getBalance({ address: bots[i].address })
  return pub.readContract({ address: pair.address, abi: erc20Abi, functionName: 'balanceOf', args: [bots[i].address] })
}
const tokenBalance = (i: number, token: Address) =>
  pub.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [bots[i].address] })

async function confirm(pending: Promise<Hex>): Promise<Hex> {
  const hash = await pending
  const r = await pub.waitForTransactionReceipt({ hash })
  if (r.status !== 'success') throw new Error(`tx ${hash} reverted`)
  return hash
}

function poolKey(l: Launch) {
  const [c0, c1] =
    l.pair.address === zeroAddress || l.pair.address.toLowerCase() < l.token.toLowerCase()
      ? [l.pair.address, l.token]
      : [l.token, l.pair.address]
  return { currency0: c0, currency1: c1, fee: l.poolFee, tickSpacing: l.tickSpacing, hooks: deployment.memeHook } as const
}

// ---------------------------------------------------------------- actions

const stats = { launch: 0, buy: 0, sell: 0, graduate: 0, pool: 0, lp: 0, swap: 0, skipped: 0, failed: 0 }
const failures: string[] = []
let tick = 0
const log = (i: number, msg: string) => console.log(`[${String(tick).padStart(4)}] #${i + 1} ${msg}`)

async function launch(i: number) {
  const pairs = [NATIVE, NATIVE, NATIVE, ...deployment.pairTokens] // ETH-weighted
  let pair = pick(pairs)
  if (pair.address !== zeroAddress && (await quoteBalance(i, pair)) === 0n) pair = NATIVE
  const [name, sym] = pick(NAMES)
  const n = launches.size + 1
  const launchFee = await pub.readContract({ ...factory, functionName: 'launchFee' })
  const params = {
    name: `${name} ${n}`,
    symbol: `${sym}${n}`,
    logo: '',
    description: `bot launch #${n} paired with ${pair.symbol}`,
    socials: { twitter: '', telegram: '', discord: '', website: '', farcaster: '' },
    creatorFeeRecipient: bots[i].address,
    creatorTaxBps: pick([0, 50, 100, 200]),
    buybackEnabled: rand() < 0.5,
    expectedEconomics: `0x${'0'.repeat(64)}` as Hex,
    salt: keccak256(toHex(`${bots[i].address}:${sym}:${n}:${rand()}`)),
  } as const
  const hash = await confirm(
    wallets[i].writeContract({ ...factory, functionName: 'launchToken', args: [params, 0n, pair.address], value: launchFee }),
  )
  stats.launch++
  log(i, `LAUNCH ${params.symbol} paired with ${pair.symbol} (tax ${params.creatorTaxBps}bps, buyback ${params.buybackEnabled}) ${hash}`)
}

async function buy(i: number, l: Launch) {
  const bal = await quoteBalance(i, l.pair)
  // 1-12% of the graduation threshold per buy so curves graduate in ~10-30 buys
  let amount = frac(l.threshold, between(0.01, 0.12))
  const cap = l.pair.address === zeroAddress ? bal - parseUnits('0.05', 18) : bal
  if (amount > cap) amount = cap
  if (amount <= 0n) return skip(i, `no ${l.pair.symbol} to buy ${l.symbol}`)
  const native = l.pair.address === zeroAddress
  if (!native) await ensureApproval(i, l.pair.address, l.curve)
  const before = await tokenBalance(i, l.token)
  const hash = await confirm(
    wallets[i].writeContract({
      address: l.curve,
      abi: BondingCurveAbi,
      functionName: 'buy',
      args: [amount, 0n, bots[i].address],
      value: native ? amount : 0n,
    }),
  )
  const got = (await tokenBalance(i, l.token)) - before
  stats.buy++
  log(i, `BUY  ${fmt(amount, l.pair.decimals)} ${l.pair.symbol} -> ${fmt(got, 18)} ${l.symbol} ${hash}`)
  const s = await pub.readContract({ ...factory, functionName: 'getLaunchedToken', args: [l.token] })
  if (s.phase !== 0) {
    stats.graduate++
    log(i, `GRAD ${l.symbol} hit its threshold - curve swept, pool pending`)
  }
}

async function sell(i: number, l: Launch) {
  const bal = await tokenBalance(i, l.token)
  if (bal === 0n) return skip(i, `holds no ${l.symbol} to sell`)
  const amount = frac(bal, between(0.1, 0.6))
  await ensureApproval(i, l.token, l.curve)
  const before = await quoteBalance(i, l.pair)
  const hash = await confirm(
    wallets[i].writeContract({ address: l.curve, abi: BondingCurveAbi, functionName: 'sell', args: [amount, 0n, bots[i].address] }),
  )
  const got = (await quoteBalance(i, l.pair)) - before
  stats.sell++
  log(i, `SELL ${fmt(amount, 18)} ${l.symbol} -> ${fmt(got, l.pair.decimals)} ${l.pair.symbol} ${hash}`)
}

async function createPool(i: number, l: Launch) {
  const hash = await confirm(wallets[i].writeContract({ ...factory, functionName: 'createGraduatedPool', args: [l.token] }))
  stats.pool++
  log(i, `POOL ${l.symbol}/${l.pair.symbol} created on Uniswap v4 ${hash}`)
}

async function swap(i: number, l: Launch) {
  const key = poolKey(l)
  const native = l.pair.address === zeroAddress
  const buying = rand() < 0.6 // quote -> token
  let amountIn: bigint
  let tokenIn: Address
  if (buying) {
    tokenIn = l.pair.address
    const bal = await quoteBalance(i, l.pair)
    amountIn = frac(l.threshold, between(0.005, 0.04))
    const cap = native ? bal - parseUnits('0.05', 18) : bal
    if (amountIn > cap) amountIn = cap
  } else {
    tokenIn = l.token
    amountIn = frac(await tokenBalance(i, l.token), between(0.1, 0.5))
  }
  if (amountIn <= 0n) return skip(i, `nothing to swap on ${l.symbol}`)
  if (tokenIn !== zeroAddress) await ensureApproval(i, tokenIn, ROUTER)
  const zeroForOne = key.currency0.toLowerCase() === tokenIn.toLowerCase()
  const outBal = () => (buying ? tokenBalance(i, l.token) : quoteBalance(i, l.pair))
  const before = await outBal()
  const hash = await confirm(
    wallets[i].writeContract({
      ...router,
      functionName: 'swap',
      args: [key, zeroForOne, amountIn],
      value: tokenIn === zeroAddress ? amountIn : 0n,
    }),
  )
  const got = (await outBal()) - before
  stats.swap++
  const [inSym, inDec] = buying ? [l.pair.symbol, l.pair.decimals] : [l.symbol, 18]
  const [outSym, outDec] = buying ? [l.symbol, 18] : [l.pair.symbol, l.pair.decimals]
  log(i, `SWAP ${fmt(amountIn, inDec)} ${inSym} -> ${fmt(got, outDec)} ${outSym} on v4 ${hash}`)
}

async function addLiquidity(i: number, l: Launch) {
  const key = poolKey(l)
  const native = l.pair.address === zeroAddress
  const tokens = await tokenBalance(i, l.token)
  if (tokens === 0n) return skip(i, `holds no ${l.symbol} to LP`)
  const qBal = await quoteBalance(i, l.pair)
  let quote = frac(l.threshold, between(0.01, 0.05))
  const cap = native ? qBal - parseUnits('0.05', 18) : qBal
  if (quote > cap) quote = cap
  if (quote <= 0n) return skip(i, `no ${l.pair.symbol} to LP ${l.symbol}`)
  const tokenAmt = frac(tokens, between(0.2, 0.8))
  if (!native) await ensureApproval(i, l.pair.address, ROUTER)
  await ensureApproval(i, l.token, ROUTER)
  const pairIsZero = key.currency0.toLowerCase() === l.pair.address.toLowerCase()
  const [a0, a1] = pairIsZero ? [quote, tokenAmt] : [tokenAmt, quote]
  const hash = await confirm(
    wallets[i].writeContract({
      ...router,
      functionName: 'addFullRangeLiquidity',
      args: [key, a0, a1],
      value: native ? quote : 0n,
    }),
  )
  stats.lp++
  log(i, `LP   up to ${fmt(quote, l.pair.decimals)} ${l.pair.symbol} + ${fmt(tokenAmt, 18)} ${l.symbol} full-range ${hash}`)
}

function skip(i: number, why: string) {
  stats.skipped++
  log(i, `skip: ${why}`)
}

// ---------------------------------------------------------------- loop

async function step() {
  await refreshLaunches()
  const all = [...launches.values()]
  const bonding = all.filter((l) => l.phase === 0)
  const swept = all.filter((l) => l.phase === 1)
  const graduated = all.filter((l) => l.phase === 2)
  const i = Math.floor(rand() * bots.length)

  if (swept.length) return createPool(i, pick(swept))
  const r = rand()
  if (bonding.length < 2 || r < 0.04) return launch(i)
  if (graduated.length && r < 0.3) return rand() < 0.65 ? swap(i, pick(graduated)) : addLiquidity(i, pick(graduated))
  // trade the newest few curves so volume concentrates enough to graduate them
  const l = pick(bonding.slice(-4))
  return rand() < 0.65 ? buy(i, l) : sell(i, l)
}

async function report() {
  await refreshLaunches()
  console.log('\n=== summary ===')
  console.log(stats)
  if (failures.length) console.log(`failures (${failures.length}):\n  ${failures.slice(0, 20).join('\n  ')}`)
  console.log('\n=== launches ===')
  const PHASE = ['bonding', 'swept', 'graduated', 'rescued']
  for (const l of launches.values()) {
    const curve = { address: l.curve, abi: BondingCurveAbi } as const
    const [quoteReserve, tokenReserve, sold] = await Promise.all([
      pub.readContract({ ...curve, functionName: 'realQuoteReserve' }),
      pub.readContract({ ...curve, functionName: 'tokenReserve' }),
      pub.readContract({ address: l.token, abi: erc20Abi, functionName: 'totalSupply' }).then(async (supply) => supply - (await pub.readContract({ address: l.token, abi: erc20Abi, functionName: 'balanceOf', args: [l.curve] }))),
    ])
    let line = `${l.symbol.padEnd(9)} ${l.pair.symbol.padEnd(6)} ${PHASE[l.phase].padEnd(9)} `
    line +=
      l.phase === 0
        ? `raised ${fmt(quoteReserve, l.pair.decimals).padStart(10)} / ${fmt(l.threshold, l.pair.decimals)} ${l.pair.symbol}  curve holds ${fmt(tokenReserve, 18)}  circulating ${fmt(sold, 18)}`
        : `curve closed at ${fmt(l.threshold, l.pair.decimals)} ${l.pair.symbol}  supply out of curve ${fmt(sold, 18)}`
    if (l.phase === 2) {
      const key = poolKey(l)
      const poolId = keccak256(
        encodeAbiParameters(
          [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
          [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
        ),
      )
      const fees = await pub.readContract({ ...hook, functionName: 'pendingFees', args: [poolId, l.token] })
      line += `  hook fees ${fmt(fees, 18)} ${l.symbol}`
    }
    console.log(line)
  }
  console.log('\nbot balances:')
  for (let i = 0; i < bots.length; i++) {
    const eth = await pub.getBalance({ address: bots[i].address })
    console.log(`  #${i + 1} ${short(bots[i].address)} ${fmt(eth, 18)} ETH`)
  }
}

async function main() {
  if (REPORT_ONLY) return report()
  console.log(`bots: ${bots.length} accounts, factory ${deployment.factory}, router ${ROUTER}, seed ${seed}, ${TICKS || '∞'} ticks @ ${INTERVAL}ms`)
  const stop = { now: false }
  process.on('SIGINT', () => {
    stop.now = true
  })
  for (tick = 1; (TICKS === 0 || tick <= TICKS) && !stop.now; tick++) {
    try {
      await step()
    } catch (e) {
      stats.failed++
      const msg = (e as { shortMessage?: string; message: string }).shortMessage ?? (e as Error).message
      failures.push(`[${tick}] ${msg.split('\n')[0]}`)
      console.log(`[${String(tick).padStart(4)}] FAIL ${msg.split('\n')[0]}`)
    }
    await sleep(INTERVAL)
  }
  await report()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

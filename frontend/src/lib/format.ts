import { formatUnits, parseUnits, type BaseError } from 'viem'

/** Parse a user-typed decimal amount; invalid input parses to 0. */
export function parseSafe(v: string, decimals: number): bigint {
  try {
    return v ? parseUnits(v.replace(/,/g, ''), decimals) : 0n
  } catch {
    return 0n
  }
}

export function errMsg(e: unknown): string {
  const be = e as BaseError
  return be?.shortMessage ?? (e instanceof Error ? e.message : String(e))
}

export function short(addr: string, n = 4): string {
  return `${addr.slice(0, 2 + n)}…${addr.slice(-n)}`
}

/** Quote-asset amount in whole units, `digits` max fraction digits, tiny values shown as `<0.0001`. */
export function fmtQuote(raw: bigint, decimals: number, digits = 4): string {
  const v = Number(formatUnits(raw, decimals))
  if (v === 0) return '0'
  if (v < 10 ** -digits) return `<${(10 ** -digits).toFixed(digits)}`
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  return v.toLocaleString(undefined, { maximumFractionDigits: digits })
}

export function fmtEth(wei: bigint, digits = 4): string {
  return fmtQuote(wei, 18, digits)
}

/**
 * Price-style formatting: keeps enough significant digits for very small numbers
 * (0.000000123) without exploding large ones.
 */
export function fmtPrice(raw: bigint, decimals: number): string {
  const v = Number(formatUnits(raw, decimals))
  if (v === 0) return '0'
  if (v >= 1) return v.toLocaleString(undefined, { maximumFractionDigits: 4 })
  const sig = Math.max(4, Math.ceil(-Math.log10(v)) + 3)
  return v.toFixed(Math.min(sig, 12)).replace(/0+$/, '')
}

export function fmtTokens(raw: bigint, decimals = 18): string {
  const v = Number(formatUnits(raw, decimals))
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)}K`
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

export function pct(num: bigint, den: bigint): number {
  if (den === 0n) return 0
  return Math.min(100, Number((num * 10_000n) / den) / 100)
}

/** "3m", "2h", "5d" — how long before `now` (unix seconds) a timestamp was. */
export function ago(ts: number | bigint, now: number): string {
  const s = Math.max(0, now - Number(ts))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export const PHASES = ['Bonding', 'Swept', 'Graduated', 'Rescued'] as const
export type PhaseName = (typeof PHASES)[number]
export function phaseName(p: number): PhaseName {
  return PHASES[p] ?? 'Bonding'
}

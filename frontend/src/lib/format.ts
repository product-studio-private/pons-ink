import { formatEther, formatUnits } from 'viem'

export function short(addr: string, n = 4): string {
  return `${addr.slice(0, 2 + n)}…${addr.slice(-n)}`
}

export function fmtEth(wei: bigint, digits = 4): string {
  const v = Number(formatEther(wei))
  if (v === 0) return '0'
  if (v < 10 ** -digits) return `<${(10 ** -digits).toFixed(digits)}`
  return v.toLocaleString(undefined, { maximumFractionDigits: digits })
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

export const PHASES = ['Bonding', 'Swept', 'Graduated', 'Rescued'] as const
export type PhaseName = (typeof PHASES)[number]
export function phaseName(p: number): PhaseName {
  return PHASES[p] ?? 'Bonding'
}

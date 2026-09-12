export const RANGES = [
  ['5M', 300],
  ['1H', 3_600],
  ['6H', 21_600],
  ['1D', 86_400],
  ['ALL', 0],
] as const
export type Range = (typeof RANGES)[number][0]

export interface Point {
  /** unix seconds */
  t: number
  /** value in whole quote units */
  v: number
}

export function rangeSeconds(r: Range): number {
  return RANGES.find(([k]) => k === r)![1]
}

/** Points inside the range, plus the last point before it so the line enters from the left edge. */
export function windowPoints(points: Point[], range: Range, now: number): Point[] {
  const secs = rangeSeconds(range)
  if (!secs) return points
  const since = now - secs
  const idx = points.findIndex((p) => p.t >= since)
  if (idx === -1) return points.length ? [{ ...points[points.length - 1], t: since }] : []
  const out = points.slice(idx)
  if (idx > 0) out.unshift({ t: since, v: points[idx - 1].v })
  return out
}

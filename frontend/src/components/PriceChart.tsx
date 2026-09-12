import { useId, useMemo } from 'react'
import { rangeSeconds, windowPoints, type Point, type Range } from '../lib/chart'

function fmtAxis(v: number): string {
  if (v === 0) return '0'
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`
  if (v >= 1) return v.toFixed(2)
  const sig = Math.ceil(-Math.log10(v)) + 2
  return v.toFixed(Math.min(sig, 10))
}

function fmtTime(t: number, span: number): string {
  const d = new Date(t * 1000)
  if (span > 2 * 86_400) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

const W = 1000
const H = 420
const PAD = { top: 24, right: 84, bottom: 44, left: 16 }

export function PriceChart({ points, range, unit, now }: { points: Point[]; range: Range; unit: string; now: number }) {
  const id = useId()
  const data = useMemo(() => windowPoints(points, range, now), [points, range, now])

  if (data.length === 0) {
    return (
      <div className="chart-stage grid place-items-center text-sm text-ink-300">No trades in this window yet.</div>
    )
  }

  const secs = rangeSeconds(range)
  const t0 = secs ? now - secs : data[0].t
  const t1 = Math.max(now, data[data.length - 1].t)
  const span = Math.max(1, t1 - t0)
  const vs = data.map((p) => p.v)
  let vMin = Math.min(...vs)
  let vMax = Math.max(...vs)
  if (vMin === vMax) {
    vMin *= 0.9
    vMax = vMax * 1.1 || 1
  } else {
    const pad = (vMax - vMin) * 0.15
    vMin = Math.max(0, vMin - pad)
    vMax += pad
  }

  const x = (t: number) => PAD.left + ((t - t0) / span) * (W - PAD.left - PAD.right)
  const y = (v: number) => PAD.top + (1 - (v - vMin) / (vMax - vMin)) * (H - PAD.top - PAD.bottom)

  // step-after line: a curve price only changes on trades
  const path = data
    .map((p, i) => {
      if (i === 0) return `M${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`
      return `H${x(p.t).toFixed(1)}V${y(p.v).toFixed(1)}`
    })
    .join('')
  const last = data[data.length - 1]
  const lineEnd = `${path}H${x(t1).toFixed(1)}`
  const area = `${lineEnd}V${(H - PAD.bottom).toFixed(1)}H${x(data[0].t).toFixed(1)}Z`

  const grid = [0.2, 0.5, 0.8].map((f) => vMin + (vMax - vMin) * f)
  const ticks = [0.05, 0.35, 0.65, 0.95].map((f) => t0 + span * f)

  return (
    <div className="chart-stage">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full">
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7132f5" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#7132f5" stopOpacity="0" />
          </linearGradient>
        </defs>
        {grid.map((g) => (
          <g key={g}>
            <line
              x1={PAD.left}
              x2={W - PAD.right + 8}
              y1={y(g)}
              y2={y(g)}
              stroke="rgba(255,255,255,0.12)"
              strokeDasharray="4 6"
            />
            <text x={W - PAD.right + 14} y={y(g) + 4} fill="rgba(242,242,242,0.5)" fontSize="12">
              {fmtAxis(g)} {unit}
            </text>
          </g>
        ))}
        <path d={area} fill={`url(#${id}-fill)`} />
        <path d={lineEnd} fill="none" stroke="#8a55ff" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <circle cx={x(t1)} cy={y(last.v)} r="5" fill="#b39bff" />
        {ticks.map((t) => (
          <text key={t} x={x(t)} y={H - 14} fill="rgba(242,242,242,0.5)" fontSize="13" textAnchor="middle">
            {fmtTime(t, span)}
          </text>
        ))}
      </svg>
    </div>
  )
}

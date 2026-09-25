// Stacked daily columns by status (part-to-whole over time). Recharts, styled to the dataviz mark specs:
// ≤24px columns, 4px rounded data-end on the topmost segment only, 2px surface gap between segments, hairline grid.
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts'
import type { VerificationStatus } from '@/domain/types'
import { formatDate } from '@/lib/format'
import { STATUS_LABELS } from '@/lib/labels'
import { fmtInt } from './numbers'
import { STATUS_STACK, useVizTokens } from './vizTokens'

type Row = { day: string } & Record<VerificationStatus, number>

const GAP = 2
const RADIUS = 4

function topKey(row: Row): VerificationStatus | undefined {
  return [...STATUS_STACK].reverse().find((k) => row[k] > 0)
}

function segmentPath(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0 || w <= 0) return ''
  const rr = Math.min(r, w / 2, h)
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`
}

function makeShape(key: VerificationStatus, fill: string) {
  return function Segment(props: unknown) {
    const { x, y, width, height, payload } = props as { x: number; y: number; width: number; height: number; payload: Row }
    if (!height) return <g />
    const isTop = topKey(payload) === key
    const idx = STATUS_STACK.indexOf(key)
    const hasBelow = STATUS_STACK.slice(0, idx).some((k) => payload[k] > 0)
    const h = Math.max(0, height - (hasBelow ? GAP : 0)) // gap sits between this segment and the one below
    return <path d={segmentPath(x, y, width, h, isTop ? RADIUS : 0)} fill={fill} />
  }
}

function DailyTooltip({ active, payload, label }: TooltipContentProps<number, string>) {
  const t = useVizTokens()
  if (!active || !payload?.length) return null
  const row = payload[0].payload as Row
  const total = STATUS_STACK.reduce((n, k) => n + row[k], 0)
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="mb-1 font-medium">
        {formatDate(String(label))} · <span className="font-semibold">{fmtInt(total)}</span> <span className="text-muted-foreground">total</span>
      </div>
      <ul className="space-y-0.5">
        {[...STATUS_STACK].reverse().map((k) => (
          <li key={k} className="flex items-center gap-2">
            <span className="h-0.5 w-3 rounded" style={{ background: t.status[k] }} aria-hidden />
            <span className="min-w-6 text-right font-semibold tabular-nums">{fmtInt(row[k])}</span>
            <span className="text-muted-foreground">{STATUS_LABELS[k]}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function DailyStatusChart({ daily }: { daily: { day: string; counts: Record<VerificationStatus, number> }[] }) {
  const t = useVizTokens()
  const data: Row[] = daily.map((d) => ({ day: d.day, ...d.counts }))
  const tickEvery = Math.max(1, Math.ceil(data.length / 8))
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }} barCategoryGap="20%">
          <CartesianGrid vertical={false} stroke={t.grid} />
          <XAxis
            dataKey="day"
            tickLine={false}
            axisLine={{ stroke: t.axis }}
            tick={{ fill: t.muted, fontSize: 11 }}
            interval={tickEvery - 1}
            tickFormatter={(d: string) => formatDate(d).slice(0, 6)}
          />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: t.muted, fontSize: 11 }} width={40} />
          <Tooltip content={(p) => <DailyTooltip {...(p as TooltipContentProps<number, string>)} />} cursor={{ fill: t.hover }} isAnimationActive={false} />
          {STATUS_STACK.map((k) => (
            <Bar key={k} dataKey={k} name={STATUS_LABELS[k]} stackId="s" fill={t.status[k]} maxBarSize={24} isAnimationActive={false} shape={makeShape(k, t.status[k])} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

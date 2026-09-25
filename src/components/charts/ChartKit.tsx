// Small chart building blocks in plain HTML: stat tile, chart card with table twin, status legend, hover tips, bar list.
import { useState, type ReactNode } from 'react'
import { CheckCircle2, Clock, Loader, XCircle } from 'lucide-react'
import type { VerificationStatus } from '@/domain/types'
import { STATUS_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { fmtInt, fmtPct, pct } from './numbers'
import { useVizTokens } from './vizTokens'


const STATUS_ICON: Record<VerificationStatus, typeof CheckCircle2> = {
  APPROVED: CheckCircle2,
  PENDING_REVIEW: Clock,
  REJECTED: XCircle,
  PROCESSING: Loader,
}

/** Stat tile: label · value · optional delta vs a named period · optional note. Proportional figures for the value. */
export function StatTile({ label, value, delta, note, deltaUpIsGood = true }: { label: string; value: string; delta?: { value: number; vs: string }; note?: ReactNode; deltaUpIsGood?: boolean }) {
  const d = delta?.value ?? 0
  const good = d === 0 ? undefined : d > 0 === deltaUpIsGood
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 text-3xl font-semibold">{value}</div>
      {delta && (
        <div className={cn('mt-1 text-xs', good === undefined ? 'text-muted-foreground' : good ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400')}>
          {d > 0 ? '▲' : d < 0 ? '▼' : '●'} {d > 0 ? '+' : ''}
          {fmtPct(d)} vs {delta.vs}
        </div>
      )}
      {note && <div className="mt-1 text-xs text-muted-foreground">{note}</div>}
    </div>
  )
}

/** Card with a chart and its table-view twin (WCAG-clean equivalent). */
export function ChartCard({ title, subtitle, legend, table, children, className, busy }: { title: string; subtitle?: ReactNode; legend?: ReactNode; table: ReactNode; children: ReactNode; className?: string; busy?: boolean }) {
  const [asTable, setAsTable] = useState(false)
  return (
    <section aria-label={title} className={cn('rounded-lg border bg-card', className)}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b px-4 py-2.5">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <button type="button" onClick={() => setAsTable((t) => !t)} aria-pressed={asTable} className="rounded px-1.5 text-xs text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring">
          {asTable ? 'Show chart' : 'Show table'}
        </button>
      </div>
      <div className={cn('p-4 transition-opacity', busy && 'opacity-60')} aria-busy={busy}>
        {asTable ? <div className="overflow-x-auto">{table}</div> : (
          <>
            {legend && <div className="mb-3">{legend}</div>}
            {children}
          </>
        )}
      </div>
    </section>
  )
}

/** Legend for status series: swatch + icon + label (+ value), so identity is never colour-alone. */
export function StatusLegend({ counts, total }: { counts?: Record<VerificationStatus, number>; total?: number }) {
  const t = useVizTokens()
  const order: VerificationStatus[] = ['APPROVED', 'PENDING_REVIEW', 'REJECTED', 'PROCESSING']
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
      {order.map((s) => {
        const Icon = STATUS_ICON[s]
        return (
          <li key={s} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: t.status[s] }} aria-hidden />
            <Icon className="size-3.5 text-muted-foreground" aria-hidden />
            <span>{STATUS_LABELS[s]}</span>
            {counts && (
              <span className="text-muted-foreground">
                {fmtInt(counts[s])}
                {total ? ` · ${fmtPct(pct(counts[s], total))}` : ''}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** Tooltip shown on hover and keyboard focus of its mark. Value leads, label follows. */
export function HoverTip({ value, label, children, className }: { value: string; label: string; children: ReactNode; className?: string }) {
  return (
    <div tabIndex={0} aria-label={`${label}: ${value}`} className={cn('group/tip relative outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}>
      {children}
      <div role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 hidden -translate-x-1/2 rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-md group-hover/tip:block group-focus-visible/tip:block">
        <span className="font-semibold">{value}</span> <span className="text-muted-foreground">{label}</span>
      </div>
    </div>
  )
}

/** 100% stacked bar of status shares, 2px surface gaps between segments. */
export function StatusShareBar({ counts, total }: { counts: Record<VerificationStatus, number>; total: number }) {
  const t = useVizTokens()
  const order: VerificationStatus[] = ['APPROVED', 'PENDING_REVIEW', 'REJECTED', 'PROCESSING']
  const shown = order.filter((s) => counts[s] > 0)
  if (!total) return <p className="text-sm text-muted-foreground">No verifications in this range.</p>
  return (
    <div className="flex h-6 w-full gap-0.5" role="group" aria-label={order.map((s) => `${STATUS_LABELS[s]} ${counts[s]}`).join(', ')}>
      {shown.map((s, i) => (
        <div key={s} style={{ width: `${pct(counts[s], total)}%` }} className="h-full min-w-1">
          <HoverTip value={`${fmtInt(counts[s])} · ${fmtPct(pct(counts[s], total))}`} label={STATUS_LABELS[s]} className="h-full">
            <div className={cn('h-full', i === 0 && 'rounded-l', i === shown.length - 1 && 'rounded-r')} style={{ background: t.status[s] }} />
          </HoverTip>
        </div>
      ))}
    </div>
  )
}

/** Horizontal bar list — one series, value at the tip. For magnitude by nominal category. */
export function BarList({ rows, format = fmtInt, unit }: { rows: { label: string; value: number }[]; format?: (n: number) => string; unit: string }) {
  const t = useVizTokens()
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[8rem_1fr] items-center gap-3 text-sm">
          <span className="truncate text-muted-foreground">{r.label}</span>
          <HoverTip value={format(r.value)} label={`${unit} · ${r.label}`} className="flex items-center gap-2">
            <div className="h-3 rounded-r-[4px]" style={{ width: `${(100 * r.value) / max}%`, minWidth: r.value ? 4 : 0, background: t.series1, maxWidth: 'calc(100% - 4rem)' }} />
            <span className="tabular-nums">{format(r.value)}</span>
          </HoverTip>
        </li>
      ))}
    </ul>
  )
}

export function DataTable({ columns, rows, caption }: { columns: string[]; rows: (string | number)[][]; caption: string }) {
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead className="text-left text-xs text-muted-foreground">
        <tr>
          {columns.map((c, i) => (
            <th key={c} scope="col" className={cn('py-1.5 pr-4 font-medium', i > 0 && 'text-right')}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t">
            {r.map((cell, j) => (
              <td key={j} className={cn('py-1.5 pr-4', j > 0 && 'text-right tabular-nums')}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}


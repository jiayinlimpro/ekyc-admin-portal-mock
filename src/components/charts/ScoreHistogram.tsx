// Score distribution for one phase, 5-point bins, with the two threshold lines (Auto-Reject, Auto-Pass).
import { HISTOGRAM_BIN } from '@/domain/dashboards'
import { HoverTip } from './ChartKit'
import { fmtInt } from './numbers'
import { useVizTokens } from './vizTokens'

export function ScoreHistogram({ bins, thresholds, label }: { bins: number[]; thresholds?: { autoReject: number; autoPass: number }; label: string }) {
  const t = useVizTokens()
  const max = Math.max(1, ...bins)
  const zone = (from: number, to: number) => bins.reduce((n, c, i) => (i * HISTOGRAM_BIN >= from && i * HISTOGRAM_BIN < to ? n + c : n), 0)
  return (
    <figure className="space-y-2">
      <div className="relative h-36 border-b" style={{ borderColor: t.axis }}>
        {/* Hairline grid at 50% and 100% of the tallest bin */}
        {[0.5, 1].map((f) => (
          <div key={f} className="absolute inset-x-0 border-t" style={{ bottom: `${f * 100}%`, borderColor: t.grid }} aria-hidden />
        ))}
        <div className="absolute inset-0 flex items-end gap-0.5">
          {bins.map((c, i) => {
            const lo = i * HISTOGRAM_BIN
            const hi = Math.min(100, lo + HISTOGRAM_BIN)
            return (
              <HoverTip key={i} value={fmtInt(c)} label={`sessions scored ${lo}–${hi === 100 ? 100 : `${hi - 0.1}`}`} className="flex h-full flex-1 items-end">
                <div className="w-full rounded-t-[4px]" style={{ height: `${(100 * c) / max}%`, minHeight: c ? 2 : 0, background: t.series1 }} />
              </HoverTip>
            )
          })}
        </div>
        {thresholds &&
          (
            [
              ['Reject <', thresholds.autoReject],
              ['Pass ≥', thresholds.autoPass],
            ] as const
          ).map(([name, v]) => (
            <div key={name} className="pointer-events-none absolute inset-y-0" style={{ left: `${v}%` }} aria-hidden>
              <div className="h-full border-l-2 border-dashed" style={{ borderColor: t.textSecondary }} />
              <span className="absolute -top-0.5 left-1 rounded bg-card px-1 text-[10px] font-medium whitespace-nowrap text-foreground">
                {name} {v}
              </span>
            </div>
          ))}
      </div>
      {/* Ticks sit at their exact score position (first/last kept inside the plot edges). */}
      <div className="relative h-4 text-[11px] text-muted-foreground tabular-nums" aria-hidden>
        {[0, 20, 40, 60, 80, 100].map((n) => (
          <span key={n} className="absolute" style={{ left: `${n}%`, transform: `translateX(${n === 0 ? 0 : n === 100 ? -100 : -50}%)` }}>
            {n}
          </span>
        ))}
      </div>
      {thresholds && (
        <figcaption className="text-xs text-muted-foreground">
          {label}: {fmtInt(zone(0, thresholds.autoReject))} below Auto-Reject · {fmtInt(zone(thresholds.autoReject, thresholds.autoPass))} in review band · {fmtInt(zone(thresholds.autoPass, 101))} at or above Auto-Pass (bin-level approximation)
        </figcaption>
      )}
    </figure>
  )
}

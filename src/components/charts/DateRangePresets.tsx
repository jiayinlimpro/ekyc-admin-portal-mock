import { RANGE_PRESETS } from '@/hooks/useRangeDays'
import { cn } from '@/lib/utils'

/** One filter row above the charts; scopes everything below it. */
export function DateRangePresets({ days, onChange, children }: { days: number; onChange: (d: number) => void; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div role="group" aria-label="Date range (submitted, MYT)" className="inline-flex rounded-lg border bg-card p-0.5">
        {RANGE_PRESETS.map((p) => (
          <button
            key={p.days}
            type="button"
            aria-pressed={days === p.days}
            onClick={() => onChange(p.days)}
            className={cn('rounded-md px-3 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring', days === p.days ? 'bg-foreground font-medium text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
          >
            {p.label}
          </button>
        ))}
      </div>
      {children}
    </div>
  )
}

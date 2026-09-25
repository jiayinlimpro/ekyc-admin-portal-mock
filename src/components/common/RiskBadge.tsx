import type { RiskLevel } from '@/domain/types'
import { RISK_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'

// Outlined, so it never reads as a status badge. Text + colour.
const STYLES: Record<RiskLevel, string> = {
  LOW: 'text-green-700 border-green-300 dark:text-green-300 dark:border-green-500/40',
  MEDIUM: 'text-amber-700 border-amber-300 dark:text-amber-300 dark:border-amber-500/40',
  HIGH: 'text-red-700 border-red-300 dark:text-red-300 dark:border-red-500/40',
}

/** V1 records have no risk result: shown as an em dash with an accessible "Not applicable". */
export function RiskBadge({ level }: { level?: RiskLevel }) {
  if (!level)
    return (
      <span className="text-muted-foreground">
        <span aria-hidden>—</span>
        <span className="sr-only">Not applicable</span>
      </span>
    )
  return <span className={cn('inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium', STYLES[level])}>{RISK_LABELS[level]}</span>
}

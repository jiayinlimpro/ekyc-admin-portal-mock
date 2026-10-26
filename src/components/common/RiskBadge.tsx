import type { RiskResult } from '@/domain/types'
import { RISK_RESULT_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'

// REQ: DEC-107 — outlined, so it never reads as a status badge. Text + colour.
const STYLES: Record<RiskResult, string> = {
  CLEAR: 'text-green-700 border-green-300 dark:text-green-300 dark:border-green-500/40',
  FLAGGED: 'text-amber-700 border-amber-300 dark:text-amber-300 dark:border-amber-500/40',
}

/** Cases without a risk result (V1/V3, or risk not run yet): an em dash with an accessible "Not applicable". */
export function RiskBadge({ result }: { result?: RiskResult }) {
  if (!result)
    return (
      <span className="text-muted-foreground">
        <span aria-hidden>—</span>
        <span className="sr-only">Not applicable</span>
      </span>
    )
  return <span className={cn('inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium', STYLES[result])}>{RISK_RESULT_LABELS[result]}</span>
}

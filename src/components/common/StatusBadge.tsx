import type { VerificationStatus } from '@/domain/types'
import { STATUS_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'

// Text + colour, never colour alone.
const STYLES: Record<VerificationStatus, string> = {
  PROCESSING: 'bg-slate-100 text-slate-700 ring-slate-300 dark:bg-slate-500/15 dark:text-slate-300 dark:ring-slate-500/40',
  PENDING_REVIEW: 'bg-amber-50 text-amber-800 ring-amber-300 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/40',
  APPROVED: 'bg-green-50 text-green-800 ring-green-300 dark:bg-green-500/15 dark:text-green-300 dark:ring-green-500/40',
  REJECTED: 'bg-red-50 text-red-800 ring-red-300 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/40',
}

export function StatusBadge({ status, className }: { status: VerificationStatus; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset', STYLES[status], className)}>
      {STATUS_LABELS[status]}
    </span>
  )
}

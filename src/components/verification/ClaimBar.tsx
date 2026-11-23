import { useEffect, useRef } from 'react'
import { Clock, Info, Lock, UserCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { formatUpdatedBy } from '@/domain/audit'
import { claimRemainingMs, isClaimActive, isClaimInWarningWindow } from '@/domain/claimRules'
import type { Actor, VerificationDetail } from '@/domain/types'
import { formatClock, formatRemaining } from '@/lib/format'
import { cn } from '@/lib/utils'

const TONE = {
  info: 'border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-500/10 dark:text-slate-200',
  mine: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-100',
  warn: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-100',
  other: 'border-violet-200 bg-violet-50 text-violet-900 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-100',
}

// REQ: DEC-20 … DEC-25 — claim is not a status; viewing is never blocked; one owner; ends by Cancel, timeout or decision.
export function ClaimBar({
  v,
  actor,
  now,
  warningMin,
  mayClaim,
  busy,
  onClaim,
  onRelease,
}: {
  v: VerificationDetail
  actor: Actor
  now: Date
  warningMin?: number
  /** The user's role in the case's project may claim it (DEC-70). */
  mayClaim: boolean
  busy: boolean
  onClaim: () => void
  onRelease: () => void
}) {
  const active = isClaimActive(v, now)
  const mine = active && v.claimedBy!.userId === actor.userId
  const warn = mine && warningMin !== undefined && isClaimInWarningWindow(v, { claimWarningMin: warningMin }, now)

  // Tell the reviewer once when their own claim runs out while they are on the page.
  const wasMine = useRef(mine)
  useEffect(() => {
    if (wasMine.current && !mine && v.status === 'PENDING_REVIEW') toast.warning('Your claim expired. Assign it to yourself again to continue.')
    wasMine.current = mine
  }, [mine, v.status])

  let tone: keyof typeof TONE = 'info'
  let icon = <Info className="size-4 shrink-0" aria-hidden />
  let body: React.ReactNode
  let action: React.ReactNode = null

  if (v.status === 'PROCESSING') {
    body = 'Still processing: the end user hasn’t finished the flow. This record is read-only.'
  } else if (v.status === 'UNSUCCESSFUL') {
    // REQ: DEC-112 / DEC-113 — no usable image: nothing to review; the same Reference ID may start a new session.
    icon = <Lock className="size-4 shrink-0" aria-hidden />
    body = `Unsuccessful: no usable image when retries ran out — ${formatUpdatedBy(v.lastUpdatedBy)}. Nothing to review; the same Reference ID can start a new session.`
  } else if (v.status !== 'PENDING_REVIEW') {
    icon = <Lock className="size-4 shrink-0" aria-hidden />
    // REQ: DEC-113 — a reviewer never reopens a case; after a rejection the same Reference ID can start a new session.
    body = `Decision is final — ${formatUpdatedBy(v.lastUpdatedBy)}. It cannot be reopened${v.status === 'REJECTED' ? '; the same Reference ID can start a new session' : ''}.`
  } else if (mine) {
    tone = warn ? 'warn' : 'mine'
    icon = <UserCheck className="size-4 shrink-0" aria-hidden />
    body = (
      <>
        <strong>You are reviewing this record.</strong> Claim expires in{' '}
        <span className="font-mono tabular-nums">{formatClock(claimRemainingMs(v, now))}</span>
        {warn && ' — save your decision soon.'}
      </>
    )
    action = (
      <Button variant="outline" size="sm" disabled={busy} onClick={onRelease}>
        Cancel claim
      </Button>
    )
  } else if (active) {
    tone = 'other'
    icon = <Clock className="size-4 shrink-0" aria-hidden />
    body = (
      <>
        <strong>
          Claimed by {v.claimedBy!.fullName}
        </strong>{' '}
        · {formatRemaining(claimRemainingMs(v, now))}. You can view it; only they can decide.
      </>
    )
  } else {
    body = mayClaim ? 'Unclaimed. Assign it to yourself to review — nobody else can decide while you hold it.' : 'Unclaimed. Your role in this project can view this record but not review it.'
    if (mayClaim)
      action = (
        <Button size="sm" disabled={busy} onClick={onClaim}>
          Assign to me
        </Button>
      )
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm', TONE[tone])}>
      {icon}
      <p className="min-w-0 flex-1">{body}</p>
      {action}
      <span className="sr-only" aria-live="polite">
        {warn ? `Your claim expires in less than ${warningMin} minutes.` : ''}
      </span>
    </div>
  )
}

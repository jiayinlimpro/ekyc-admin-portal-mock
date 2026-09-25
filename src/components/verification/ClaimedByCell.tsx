import { claimRemainingMs, isClaimActive } from '@/domain/claimRules'
import type { VerificationSummary } from '@/domain/types'
import { formatRemaining } from '@/lib/format'

/** "Siti Aminah Binti Yusof (USR-2026-0031) · 12 min left". Blank once the claim has expired (DEC-20, DEC-22). */
export function ClaimedByCell({ row, now, currentUserId }: { row: Pick<VerificationSummary, 'claimedBy' | 'claimExpiresAt'>; now: Date; currentUserId: string }) {
  if (!isClaimActive(row, now)) {
    return (
      <span className="text-muted-foreground">
        <span aria-hidden>—</span>
        <span className="sr-only">Unclaimed</span>
      </span>
    )
  }
  const mine = row.claimedBy!.userId === currentUserId
  return (
    <div className="leading-tight">
      <div className="whitespace-nowrap">
        {row.claimedBy!.fullName}
        {mine && <span className="ml-1 rounded bg-blue-100 px-1 text-[10px] font-medium text-blue-800 dark:bg-blue-500/20 dark:text-blue-300">You</span>}
      </div>
      <div className="text-xs whitespace-nowrap text-muted-foreground">
        {row.claimedBy!.userId} · {formatRemaining(claimRemainingMs(row, now))}
      </div>
    </div>
  )
}

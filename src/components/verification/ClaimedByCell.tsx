import { claimRemainingMs, isClaimActive } from '@/domain/claimRules'
import type { VerificationSummary } from '@/domain/types'
import { formatMyt, formatRemaining } from '@/lib/format'

type ClaimRow = Pick<VerificationSummary, 'claimedBy' | 'claimExpiresAt'>

/** REQ: DEC-40 — "Claimed by" or "Unclaimed". Unclaimed again once the claim has expired (DEC-20, DEC-22). */
export function ClaimedByCell({ row, now, currentUserId }: { row: ClaimRow; now: Date; currentUserId: string }) {
  if (!isClaimActive(row, now)) return <span className="text-muted-foreground">Unclaimed</span>
  const mine = row.claimedBy!.userId === currentUserId
  return (
    <div className="leading-tight">
      <div className="whitespace-nowrap">
        {row.claimedBy!.fullName}
        {mine && <span className="ml-1 rounded bg-blue-100 px-1 text-[10px] font-medium text-blue-800 dark:bg-blue-500/20 dark:text-blue-300">You</span>}
      </div>
      <div className="text-xs whitespace-nowrap text-muted-foreground">{row.claimedBy!.userId}</div>
    </div>
  )
}

/** REQ: DEC-40 — "Claim expires": the countdown and the expiry time; blank when unclaimed. */
export function ClaimExpiresCell({ row, now }: { row: ClaimRow; now: Date }) {
  if (!isClaimActive(row, now)) return <span className="text-muted-foreground" aria-label="No active claim">—</span>
  return (
    <div className="leading-tight whitespace-nowrap">
      <div>{formatRemaining(claimRemainingMs(row, now))}</div>
      <div className="text-xs text-muted-foreground">{formatMyt(row.claimExpiresAt!).split(', ')[1]} MYT</div>
    </div>
  )
}

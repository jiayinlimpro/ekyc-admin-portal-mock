import { claimRemainingMs, isClaimActive } from '@/domain/claimRules'
import type { VerificationSummary } from '@/domain/types'
import { formatMyt, formatRemaining } from '@/lib/format'

type ClaimRow = Pick<VerificationSummary, 'claimedBy' | 'claimExpiresAt'>

/**
 * REQ: DEC-40 — "Claimed by" or "Unclaimed", with the claim's countdown and expiry time on the second line (the former
 * "Claim expires" column). Unclaimed again once the claim has expired (DEC-20, DEC-22).
 */
export function ClaimedByCell({ row, now, currentUserId }: { row: ClaimRow; now: Date; currentUserId: string }) {
  if (!isClaimActive(row, now)) return <span className="text-muted-foreground">Unclaimed</span>
  const mine = row.claimedBy!.userId === currentUserId
  return (
    <div className="leading-tight" title={row.claimedBy!.userId}>
      <div className="max-w-40">
        {row.claimedBy!.fullName}
        {mine && <span className="ml-1 rounded bg-blue-100 px-1 text-[10px] font-medium text-blue-800 dark:bg-blue-500/20 dark:text-blue-300">You</span>}
      </div>
      <div className="text-xs whitespace-nowrap text-muted-foreground">
        {formatRemaining(claimRemainingMs(row, now))} · until {formatMyt(row.claimExpiresAt!).split(', ')[1]}
      </div>
    </div>
  )
}

// REQ: DEC-22 / MOCK-03 — lazy claim expiry. No background job: every service call sweeps first.
import { makeAudit } from '@/domain/audit'
import { CLEARED_CLAIM, isClaimTimedOut } from '@/domain/claimRules'
import { db } from '@/mocks/mockDb'

/** Clears expired claims and writes exactly one CLAIM_TIMEOUT per expired claim (idempotent: the fields are cleared). */
export function sweepExpiredClaims(now: Date): void {
  const expired = db.state().verifications.filter((v) => isClaimTimedOut(v, now))
  for (const v of expired) {
    db.updateVerification(v.referenceNo, (x) => ({ ...x, ...CLEARED_CLAIM }))
    db.appendAudit(
      makeAudit({
        id: '',
        now, // when it was detected; the actual expiry is in details.claimExpiresAt
        action: 'CLAIM_TIMEOUT',
        actor: 'SYSTEM',
        ip: '-',
        merchantId: v.merchantId,
        referenceNo: v.referenceNo,
        details: { claimedBy: v.claimedBy, claimedAt: v.claimedAt, claimExpiresAt: v.claimExpiresAt },
      }),
    )
  }
}

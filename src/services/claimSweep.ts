// REQ: DEC-22 / MOCK-03 — lazy claim expiry. No background job: every service call sweeps first.
import { canInProject } from '@/domain/access'
import { makeAudit } from '@/domain/audit'
import { CLEARED_CLAIM, isClaimActive, isClaimTimedOut } from '@/domain/claimRules'
import { grantsOf } from '@/domain/roles'
import { db } from '@/mocks/mockDb'

/** Clears expired claims and writes exactly one CASE_CLAIM_EXPIRED per expired claim (idempotent: the fields are cleared). */
export function sweepExpiredClaims(now: Date): void {
  const expired = db.state().verifications.filter((v) => isClaimTimedOut(v, now))
  for (const v of expired) {
    db.updateVerification(v.caseId, (x) => ({ ...x, ...CLEARED_CLAIM }))
    db.appendAudit(
      makeAudit({
        id: '',
        now, // when it was detected; the actual expiry is in details.claimExpiresAt
        action: 'CASE_CLAIM_EXPIRED',
        actor: 'SYSTEM',
        ip: '-',
        merchantId: v.merchantId,
        projectId: v.projectId,
        caseId: v.caseId, referenceNo: v.referenceNo,
        details: { claimedBy: v.claimedBy, claimedAt: v.claimedAt, claimExpiresAt: v.claimExpiresAt },
      }),
    )
  }
  releaseClaimsWithoutAccess(now)
}

/** REQ: DEC-99 — a claim whose holder can no longer claim there (access ended, role changed) is released by the system. */
function releaseClaimsWithoutAccess(now: Date): void {
  const s = db.state()
  for (const v of s.verifications) {
    if (!v.claimedBy || !isClaimActive(v, now)) continue
    const holder = s.accounts.find((a) => a.userId === v.claimedBy!.userId)
    if (holder && canInProject({ ...holder, grants: grantsOf(holder.assignments, s.roles, now) }, 'claimCase', v)) continue
    db.updateVerification(v.caseId, (x) => ({ ...x, ...CLEARED_CLAIM }))
    db.appendAudit(makeAudit({ id: '', now, action: 'CASE_RELEASED', actor: 'SYSTEM', ip: '-', merchantId: v.merchantId, projectId: v.projectId, caseId: v.caseId, referenceNo: v.referenceNo, details: { claimedBy: v.claimedBy, reason: 'Access ended' } }))
  }
}

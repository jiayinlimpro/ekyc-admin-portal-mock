// Claim lifecycle and decision rules. Pure functions: every rule takes `now` explicitly.
import { can, canAccessMerchant } from './permissions'
import type { Actor, Decision, MerchantConfig, Verification } from './types'

export type ClaimErrorCode =
  | 'FORBIDDEN'
  | 'NOT_CLAIMABLE' // not PENDING_REVIEW
  | 'ALREADY_CLAIMED' // someone else holds an active claim
  | 'NOT_CLAIM_OWNER'
  | 'OWNERSHIP_CONFLICT' // save-time check failed
  | 'VALIDATION'

export type RuleResult<T> = { ok: true; value: T } | { ok: false; code: ClaimErrorCode; message: string }

const fail = (code: ClaimErrorCode, message: string): RuleResult<never> => ({ ok: false, code, message })

type ClaimFields = Pick<Verification, 'claimedBy' | 'claimedAt' | 'claimExpiresAt'>

// REQ: DEC-20 — a claim is active only while now < claimExpiresAt.
export function isClaimActive(v: ClaimFields, now: Date): boolean {
  return !!v.claimedBy && !!v.claimExpiresAt && now.getTime() < Date.parse(v.claimExpiresAt)
}

/** Claim fields are set but the expiry has passed: a CLAIM_TIMEOUT should be recorded (MOCK-03). */
export function isClaimTimedOut(v: ClaimFields, now: Date): boolean {
  return !!v.claimedBy && !!v.claimExpiresAt && now.getTime() >= Date.parse(v.claimExpiresAt)
}

export function claimRemainingMs(v: ClaimFields, now: Date): number {
  if (!isClaimActive(v, now)) return 0
  return Date.parse(v.claimExpiresAt!) - now.getTime()
}

export function isClaimInWarningWindow(v: ClaimFields, cfg: Pick<MerchantConfig, 'claimWarningMin'>, now: Date): boolean {
  const left = claimRemainingMs(v, now)
  return left > 0 && left <= cfg.claimWarningMin * 60_000
}

export const CLEARED_CLAIM: ClaimFields = { claimedBy: undefined, claimedAt: undefined, claimExpiresAt: undefined }

// REQ: DEC-21 / DEC-22
export function claim(
  v: Verification,
  actor: Actor,
  cfg: Pick<MerchantConfig, 'claimTimeoutMin'>,
  now: Date,
): RuleResult<ClaimFields> {
  if (!can(actor, 'canReview') || !canAccessMerchant(actor, v.merchantId)) {
    return fail('FORBIDDEN', 'You do not have review permission for this merchant.')
  }
  if (v.status !== 'PENDING_REVIEW') return fail('NOT_CLAIMABLE', 'Only Pending Review records can be claimed.')
  if (isClaimActive(v, now)) {
    if (v.claimedBy!.userId === actor.userId) return fail('ALREADY_CLAIMED', 'You already hold this claim.')
    return fail('ALREADY_CLAIMED', `Already claimed by ${v.claimedBy!.fullName}.`)
  }
  return {
    ok: true,
    value: {
      claimedBy: { userId: actor.userId, fullName: actor.fullName },
      claimedAt: now.toISOString(),
      claimExpiresAt: new Date(now.getTime() + cfg.claimTimeoutMin * 60_000).toISOString(),
    },
  }
}

// REQ: DEC-22 — Cancel. Only the owner can release; no supervisor force-release (DEC-23).
export function release(v: Verification, actor: Actor, now: Date): RuleResult<ClaimFields> {
  if (!isClaimActive(v, now)) return fail('NOT_CLAIM_OWNER', 'There is no active claim to cancel.')
  if (v.claimedBy!.userId !== actor.userId) return fail('NOT_CLAIM_OWNER', `Claimed by ${v.claimedBy!.fullName}.`)
  return { ok: true, value: CLEARED_CLAIM }
}

export interface OverlayState {
  enabled: boolean
  why?: string
  showClaim?: boolean // show the "Assign to me" button
  showCancel?: boolean // show the "Cancel claim" button
}

// REQ: DEC-25 / DEC-30 / DEC-32 / DEC-33 — viewing is never blocked; only the overlay changes.
export function decisionOverlayState(v: Verification, actor: Actor, now: Date): OverlayState {
  if (v.status === 'PROCESSING') return { enabled: false, why: 'Record is still processing (read-only)' }
  if (v.status !== 'PENDING_REVIEW') return { enabled: false, why: 'Decision is final' }
  if (!can(actor, 'canReview') || !canAccessMerchant(actor, v.merchantId)) {
    return { enabled: false, why: 'No review permission' }
  }
  if (!isClaimActive(v, now)) return { enabled: false, why: 'Assign to me to review', showClaim: true }
  if (v.claimedBy!.userId !== actor.userId) return { enabled: false, why: `Claimed by ${v.claimedBy!.fullName}` }
  return { enabled: true, showCancel: true }
}

export function validateDecision(d: Decision): RuleResult<Decision> {
  if (!d.reasonCode.trim()) return fail('VALIDATION', 'Reason Code is required.')
  if (!d.comment.trim()) return fail('VALIDATION', 'Audit Comment is required.')
  return { ok: true, value: d }
}

// REQ: DEC-24 — re-checked against the record as it is at save time.
export function checkOwnershipAtSave(v: Verification, actor: Actor, now: Date): RuleResult<true> {
  if (v.status !== 'PENDING_REVIEW') return fail('OWNERSHIP_CONFLICT', 'This record has already been decided. No changes saved.')
  if (!isClaimActive(v, now)) {
    // Run this before expired claim fields are swept, so an expired claim of the actor's own is still recognisable.
    const expiredMine = v.claimedBy?.userId === actor.userId
    return fail('OWNERSHIP_CONFLICT', expiredMine ? 'Your claim expired. No changes saved.' : 'You do not hold a claim on this record. No changes saved.')
  }
  if (v.claimedBy!.userId !== actor.userId) {
    return fail('OWNERSHIP_CONFLICT', `Claimed by ${v.claimedBy!.fullName}. No changes saved.`)
  }
  return { ok: true, value: true }
}

// REQ: DEC-30 / DEC-03 — a decision changes status, so lastUpdatedBy/At change; the claim ends.
export function applyDecision(v: Verification, actor: Actor, d: Decision, reasonText: string, now: Date): Verification {
  return {
    ...v,
    ...CLEARED_CLAIM,
    status: d.outcome === 'APPROVE' ? 'APPROVED' : 'REJECTED',
    statusReason: reasonText,
    lastUpdatedBy: { kind: 'USER', userId: actor.userId, fullName: actor.fullName },
    lastUpdatedAt: now.toISOString(),
  }
}

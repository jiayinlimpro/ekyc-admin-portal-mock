// Claim lifecycle and decision rules. Pure functions: every rule takes `now` explicitly.
import { REJECT_REASONS } from './conditions'
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

/** What the claimer may do in the case's project (access.canInProject 'claimCase') and that project's timeout. */
export interface ClaimContext {
  mayClaim: boolean
  claimTimeoutMin: number // REQ: DEC-22 — per project (OQ-04)
}

// REQ: DEC-21 / DEC-22
export function claim(v: Verification, actor: Pick<Actor, 'userId' | 'fullName'>, ctx: ClaimContext, now: Date): RuleResult<ClaimFields> {
  if (!ctx.mayClaim) return fail('FORBIDDEN', 'You do not have review permission for this project.')
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
      claimExpiresAt: new Date(now.getTime() + ctx.claimTimeoutMin * 60_000).toISOString(),
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
// `mayDecide` = the user's role in the case's project allows claiming and deciding (access.canInProject 'decideCase').
export function decisionOverlayState(v: Verification, actor: Pick<Actor, 'userId'>, now: Date, mayDecide: boolean): OverlayState {
  if (v.status === 'PROCESSING') return { enabled: false, why: 'Record is still processing (read-only)' }
  if (v.status !== 'PENDING_REVIEW') return { enabled: false, why: 'Decision is final' }
  if (!mayDecide) return { enabled: false, why: 'No review permission' }
  if (!isClaimActive(v, now)) return { enabled: false, why: 'Assign to me to review', showClaim: true }
  if (v.claimedBy!.userId !== actor.userId) return { enabled: false, why: `Claimed by ${v.claimedBy!.fullName}` }
  return { enabled: true, showCancel: true }
}

export const NOTE_MAX = 500

// REQ: DEC-31 — Reject needs at least one reason from the condition catalogue; Approve none; the note is optional.
export function validateDecision(d: Decision): RuleResult<Decision> {
  if ((d.note?.length ?? 0) > NOTE_MAX) return fail('VALIDATION', `The note can be at most ${NOTE_MAX} characters.`)
  if (d.outcome === 'REJECT') {
    if (!d.reasonIds.length) return fail('VALIDATION', 'Choose at least one reason for the rejection.')
    if (d.reasonIds.some((id) => !REJECT_REASONS.some((r) => r.id === id))) return fail('VALIDATION', 'Unknown rejection reason.')
  }
  return { ok: true, value: d }
}

export const MANUAL_PASS_REASON = 'Confirmed manual pass by reviewer'

/** The case's reason after a manual decision: the chosen conditions for a Reject (DEC-35). */
export function decisionReason(d: Decision): string {
  if (d.outcome === 'APPROVE') return MANUAL_PASS_REASON
  return d.reasonIds.map((id) => REJECT_REASONS.find((r) => r.id === id)?.label ?? id).join('; ')
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
export function applyDecision(v: Verification, actor: Pick<Actor, 'userId' | 'fullName'>, d: Decision, now: Date): Verification {
  return {
    ...v,
    ...CLEARED_CLAIM,
    status: d.outcome === 'APPROVE' ? 'APPROVED' : 'REJECTED',
    statusReason: decisionReason(d),
    statusDetail: undefined, // the automated detail no longer explains the status
    lastUpdatedBy: { kind: 'USER', userId: actor.userId, fullName: actor.fullName },
    lastUpdatedAt: now.toISOString(),
  }
}

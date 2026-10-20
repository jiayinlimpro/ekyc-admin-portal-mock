import { describe, expect, it } from 'vitest'
import { ADMIN, ALI, OTHER_MERCHANT_REVIEWER, SITI, NOW, at, minutes, verification } from '@/test/factories'
import {
  applyDecision,
  checkOwnershipAtSave,
  claim,
  claimRemainingMs,
  decisionOverlayState,
  isClaimActive,
  isClaimInWarningWindow,
  isClaimTimedOut,
  release,
  validateDecision,
} from './claimRules'
import type { Verification } from './types'

const cfg = { claimWarningMin: 5 }
const ctx = { mayClaim: true, claimTimeoutMin: 30 }

function claimedBy(actor: typeof ALI, minutesLeft: number, base: Partial<Verification> = {}): Verification {
  return verification({
    ...base,
    claimedBy: { userId: actor.userId, fullName: actor.fullName },
    claimedAt: at(minutes(minutesLeft - 30)).toISOString(),
    claimExpiresAt: at(minutes(minutesLeft)).toISOString(),
  })
}

describe('claim (DEC-20 … DEC-22)', () => {
  it('Given an unclaimed PENDING_REVIEW record, when Ali claims, then he owns it until now + timeout', () => {
    const r = claim(verification(), ALI, ctx, NOW)
    expect(r).toEqual({
      ok: true,
      value: { claimedBy: { userId: ALI.userId, fullName: ALI.fullName }, claimedAt: NOW.toISOString(), claimExpiresAt: at(minutes(30)).toISOString() },
    })
  })

  it('Given Siti holds an active claim, when Ali claims, then ALREADY_CLAIMED (S10)', () => {
    const r = claim(claimedBy(SITI, 10), ALI, ctx, NOW)
    expect(r).toMatchObject({ ok: false, code: 'ALREADY_CLAIMED', message: 'Already claimed by Siti Aminah Binti Yusof.' })
  })

  it("Given Siti's claim has expired, when Ali claims, then he gets it", () => {
    expect(claim(claimedBy(SITI, -1), ALI, ctx, NOW).ok).toBe(true)
  })

  it('Given Ali just timed out, when he claims again, then he gets it (OQ-12)', () => {
    expect(claim(claimedBy(ALI, 0), ALI, ctx, NOW).ok).toBe(true)
  })

  it.each(['PROCESSING', 'APPROVED', 'REJECTED'] as const)('Given a %s record, then it cannot be claimed', (status) => {
    expect(claim(verification({ status }), ALI, ctx, NOW)).toMatchObject({ ok: false, code: 'NOT_CLAIMABLE' })
  })

  it("Given a user without the claim right in the case's project (Viewer, Platform Admin, other merchant), then FORBIDDEN", () => {
    expect(claim(verification(), OTHER_MERCHANT_REVIEWER, { ...ctx, mayClaim: false }, NOW)).toMatchObject({ ok: false, code: 'FORBIDDEN' })
  })

  it("Given the project's claim timeout is 45 min, then the claim expires 45 min after claiming (DEC-22)", () => {
    const r = claim(verification(), ALI, { mayClaim: true, claimTimeoutMin: 45 }, NOW)
    expect(r.ok && r.value.claimExpiresAt).toBe(at(minutes(45)).toISOString())
  })
})

describe('claim activity and countdown', () => {
  it('Given expiry exactly now, then the claim is no longer active and has timed out', () => {
    const v = claimedBy(ALI, 0)
    expect(isClaimActive(v, NOW)).toBe(false)
    expect(isClaimTimedOut(v, NOW)).toBe(true)
  })

  it('Given 2 minutes left and warning at 5, then the warning window is on (S07)', () => {
    const v = claimedBy(ALI, 2)
    expect(claimRemainingMs(v, NOW)).toBe(minutes(2))
    expect(isClaimInWarningWindow(v, cfg, NOW)).toBe(true)
  })

  it('Given 10 minutes left and warning at 5, then no warning', () => {
    expect(isClaimInWarningWindow(claimedBy(ALI, 10), cfg, NOW)).toBe(false)
  })
})

describe('release (Cancel)', () => {
  it('Given Ali owns the claim, when he cancels, then the claim fields are cleared', () => {
    expect(release(claimedBy(ALI, 10), ALI, NOW)).toEqual({ ok: true, value: { claimedBy: undefined, claimedAt: undefined, claimExpiresAt: undefined } })
  })

  it("Given Siti owns the claim, when Ali cancels, then it is refused (no force-release, DEC-23)", () => {
    expect(release(claimedBy(SITI, 10), ALI, NOW)).toMatchObject({ ok: false, code: 'NOT_CLAIM_OWNER' })
  })

  it('Given a Platform Admin, when they cancel someone else\'s claim, then it is refused (DEC-23)', () => {
    expect(release(claimedBy(SITI, 10), ADMIN, NOW).ok).toBe(false)
  })
})

describe('decisionOverlayState (DEC-25, DEC-30, DEC-32, DEC-33)', () => {
  it('Given PROCESSING, then disabled as read-only (S05)', () => {
    expect(decisionOverlayState(verification({ status: 'PROCESSING' }), ALI, NOW, true)).toEqual({ enabled: false, why: 'Record is still processing (read-only)' })
  })

  it.each(['APPROVED', 'REJECTED'] as const)('Given %s, then disabled "Decision is final" (S11)', (status) => {
    expect(decisionOverlayState(verification({ status }), ALI, NOW, true)).toEqual({ enabled: false, why: 'Decision is final' })
  })

  it('Given unclaimed, then disabled with an "Assign to me" prompt', () => {
    expect(decisionOverlayState(verification(), ALI, NOW, true)).toEqual({ enabled: false, why: 'Assign to me to review', showClaim: true })
  })

  it('Given claimed by Siti, when Ali views, then disabled "Claimed by Siti…" (S09)', () => {
    expect(decisionOverlayState(claimedBy(SITI, 10), ALI, NOW, true)).toEqual({ enabled: false, why: 'Claimed by Siti Aminah Binti Yusof' })
  })

  it('Given claimed by Ali, when Ali views, then enabled with Cancel (S07)', () => {
    expect(decisionOverlayState(claimedBy(ALI, 2), ALI, NOW, true)).toEqual({ enabled: true, showCancel: true })
  })

  it("Given Ali's claim has just expired, then disabled and claimable again", () => {
    expect(decisionOverlayState(claimedBy(ALI, 0), ALI, NOW, true)).toMatchObject({ enabled: false, showClaim: true })
  })

  it('Given a Viewer in the project of the case (S16), then disabled "No review permission"', () => {
    expect(decisionOverlayState(verification(), ALI, NOW, false)).toEqual({ enabled: false, why: 'No review permission' })
  })
})

describe('save-time ownership check (DEC-24)', () => {
  it('Given Ali still holds the claim, then the save may proceed', () => {
    expect(checkOwnershipAtSave(claimedBy(ALI, 1), ALI, NOW)).toEqual({ ok: true, value: true })
  })

  it("Given Ali's claim expired while he was typing, then OWNERSHIP_CONFLICT \"Your claim expired\" (S08)", () => {
    expect(checkOwnershipAtSave(claimedBy(ALI, -1), ALI, NOW)).toMatchObject({
      ok: false,
      code: 'OWNERSHIP_CONFLICT',
      message: 'Your claim expired. No changes saved.',
    })
  })

  it('Given Siti took the record after Ali expired, then OWNERSHIP_CONFLICT naming Siti', () => {
    expect(checkOwnershipAtSave(claimedBy(SITI, 20), ALI, NOW)).toMatchObject({ ok: false, message: 'Claimed by Siti Aminah Binti Yusof. No changes saved.' })
  })

  it('Given the record was already decided, then OWNERSHIP_CONFLICT', () => {
    expect(checkOwnershipAtSave(claimedBy(ALI, 10, { status: 'APPROVED' }), ALI, NOW)).toMatchObject({ ok: false, code: 'OWNERSHIP_CONFLICT' })
  })
})

describe('decisions (DEC-03, DEC-30, DEC-31)', () => {
  it('Given Approve with no reason and no note, then valid: Approve needs no reason code and the note is optional', () => {
    expect(validateDecision({ outcome: 'APPROVE' }).ok).toBe(true)
  })

  it('Given Reject without a reason, or with one outside the catalogue, then VALIDATION', () => {
    expect(validateDecision({ outcome: 'REJECT', reasonIds: [] })).toMatchObject({ ok: false, message: 'Choose at least one reason for the rejection.' })
    expect(validateDecision({ outcome: 'REJECT', reasonIds: ['NOT_LIVE_RETRY'] })).toMatchObject({ ok: false, message: 'Unknown rejection reason.' }) // never ends a case
    expect(validateDecision({ outcome: 'REJECT', reasonIds: ['EXISTING_USER'] }).ok).toBe(false) // record-only
    expect(validateDecision({ outcome: 'REJECT', reasonIds: ['NOT_LIVE', 'PASSPORT_MRZ'] }).ok).toBe(true)
  })

  it('Given a note over 500 characters, then VALIDATION', () => {
    expect(validateDecision({ outcome: 'APPROVE', note: 'x'.repeat(501) }).ok).toBe(false)
  })

  it('When Ali approves, then APPROVED, lastUpdatedBy = Ali, lastUpdatedAt = now, claim cleared', () => {
    const later = at(minutes(5))
    const v = applyDecision(claimedBy(ALI, 10, { statusDetail: 'Auto-Reject < 70 · Auto-Pass ≥ 85 · Actual 78' }), ALI, { outcome: 'APPROVE' }, later)
    expect(v).toMatchObject({
      status: 'APPROVED',
      statusReason: 'Confirmed manual pass by reviewer',
      statusDetail: undefined,
      lastUpdatedBy: { kind: 'USER', userId: ALI.userId, fullName: ALI.fullName },
      lastUpdatedAt: later.toISOString(),
      claimedBy: undefined,
      claimExpiresAt: undefined,
    })
  })

  it('When Ali rejects, then REJECTED with the chosen conditions as the reason (DEC-35)', () => {
    const v = applyDecision(claimedBy(ALI, 10), ALI, { outcome: 'REJECT', reasonIds: ['NOT_LIVE', 'PASSPORT_MRZ'] }, NOW)
    expect(v).toMatchObject({ status: 'REJECTED', statusReason: 'Face not live (Retry Not Allowed); Unable to detect the 2 lines MRZ field in passport image' })
  })
})

import { describe, expect, it } from 'vitest'
import { RISK_NOT_PASSED, evaluateCase, evaluateRisk, evaluateCheck, type FlowContext } from './checkRules'
import type { CheckSettings } from './types'

// Standard presets (OQ-02): face match reject < 85, approve ≥ 95 · liveness reject < 70, approve ≥ 85. 3 retries per phase.
const std = (): CheckSettings => ({ threshold: { preset: 'STANDARD' } })
const RETRIES = { DOCUMENT: 3, SELFIE: 3, LIVENESS: 3 }
const STD = { preset: 'STANDARD' } as const

const V4: FlowContext = {
  checks: ['FACE_MATCH', 'LIVENESS'],
  faceMatchMethod: 'ID_VS_LIVENESS',
  hasRisk: true,
  settings: { checks: { FACE_MATCH: std(), LIVENESS: std() }, retries: RETRIES, risk: { enabled: true, minimums: { EXIF: 50, NOISE: 50, EMAIL_VALIDITY: 50, OSINT: 50 } } },
}
const CLEAN = { EXIF: 80, NOISE: 80, EMAIL_VALIDITY: 80, OSINT: 80 }
const V1: FlowContext = { ...V4, faceMatchMethod: 'ID_VS_SELFIE', hasRisk: false, settings: { checks: V4.settings.checks, retries: RETRIES } }

describe('one check with retries (DEC-15, DEC-16, DEC-18)', () => {
  it('Given no submission yet, then pending', () => {
    expect(evaluateCheck('LIVENESS', [], STD, 3).state).toBe('PENDING')
  })

  it('Given a score at or above Auto-Pass, then pass at once, on any attempt', () => {
    expect(evaluateCheck('LIVENESS', [85], STD, 3).state).toBe('PASS')
    expect(evaluateCheck('LIVENESS', [50, 60, 90], STD, 3)).toMatchObject({ state: 'PASS', retriesUsed: 2 })
  })

  it('Given a score below Auto-Pass with retries left — review band or reject band — then retry', () => {
    expect(evaluateCheck('LIVENESS', [80], STD, 3).state).toBe('RETRY')
    expect(evaluateCheck('LIVENESS', [10, 20, 30], STD, 3)).toMatchObject({ state: 'RETRY', retriesUsed: 2, retriesAllowed: 3 })
  })

  it('Given 3 retries allowed, then 4 submissions in total and the last one decides', () => {
    expect(evaluateCheck('LIVENESS', [10, 20, 30, 75], STD, 3)).toMatchObject({ state: 'REVIEW', submissions: 4, retriesUsed: 3, lastScore: 75 })
    expect(evaluateCheck('LIVENESS', [80, 80, 80, 69], STD, 3).state).toBe('REJECT') // last, not best
  })
})

describe('case status in a flow (DEC-12 … DEC-16)', () => {
  it('Given a retry is pending, then PROCESSING with the "(Retry Allowed)" condition', () => {
    const r = evaluateCase({ submissions: { FACE_MATCH: [97], LIVENESS: [60] } }, V4)
    expect(r).toMatchObject({ status: 'PROCESSING', reason: 'Face not live (Retry Allowed)' })
  })

  it('Given liveness retries run out in the review band, then PENDING_REVIEW with the final condition and the numbers', () => {
    const r = evaluateCase({ submissions: { FACE_MATCH: [97], LIVENESS: [60, 60, 60, 78] }, riskScores: CLEAN }, V4)
    expect(r).toMatchObject({ status: 'PENDING_REVIEW', reason: 'Face not live (Retry Not Allowed)', detail: 'Auto-Reject < 70 · Auto-Pass ≥ 85 · Actual 78' })
  })

  it('Given face match retries run out below Auto-Reject, then REJECTED at once even before liveness finishes (rejects win, OQ-01)', () => {
    const r = evaluateCase({ submissions: { FACE_MATCH: [50, 50, 50, 50] } }, V4)
    expect(r).toMatchObject({ status: 'REJECTED', reason: 'Liveness face does not match ID face (Retry Not Allowed)' })
  })

  it('Given V1, then face match uses the ID vs Selfie condition', () => {
    const r = evaluateCase({ submissions: { FACE_MATCH: [50, 50, 50, 50], LIVENESS: [90] } }, V1)
    expect(r.reason).toBe('ID face and Selfie face do not match (Retry Not Allowed)')
  })

  it('Given REVIEW_WINS, then a final review outranks a final reject', () => {
    const r = evaluateCase({ submissions: { FACE_MATCH: [50, 50, 50, 50], LIVENESS: [60, 60, 60, 78] } }, V1, 'REVIEW_WINS')
    expect(r.status).toBe('PENDING_REVIEW')
  })

  it('Given every check passes, then V1 is APPROVED; V4 also needs Low risk, else PENDING_REVIEW with the categories missed (DEC-107)', () => {
    const pass = { FACE_MATCH: [96], LIVENESS: [90] }
    expect(evaluateCase({ submissions: pass }, V1).status).toBe('APPROVED')
    expect(evaluateCase({ submissions: pass }, V4).status).toBe('PROCESSING') // risk not run yet
    expect(evaluateCase({ submissions: pass, riskScores: { ...CLEAN, OSINT: 50 } }, V4).status).toBe('APPROVED') // at the minimum is enough
    expect(evaluateCase({ submissions: pass, riskScores: { ...CLEAN, OSINT: 22, EXIF: 49 } }, V4)).toMatchObject({ status: 'PENDING_REVIEW', reason: RISK_NOT_PASSED, detail: 'EXIF Score 49 < 50 · OSINT Score 22 < 50' })
  })

  it('Given the decision table, then biometric review or reject wins whatever the risk result (DEC-107)', () => {
    const flagged = { ...CLEAN, NOISE: 10 }
    expect(evaluateCase({ submissions: { FACE_MATCH: [96, 96, 96, 90], LIVENESS: [90, 90, 90, 90] }, riskScores: CLEAN }, V4).status).toBe('PENDING_REVIEW') // review + Low risk
    expect(evaluateCase({ submissions: { FACE_MATCH: [96], LIVENESS: [10, 10, 10, 10] }, riskScores: flagged }, V4).status).toBe('REJECTED') // reject + High risk: from biometrics
    expect(evaluateRisk(flagged, V4.settings.risk)).toMatchObject({ result: 'HIGH', below: [{ category: 'NOISE', score: 10, minimum: 50 }] })
    expect(evaluateRisk(CLEAN, V4.settings.risk).result).toBe('LOW')
  })

  it('Given 1 retry allowed (OQ-03 minimum), then the second submission decides', () => {
    const flow = { ...V1, settings: { checks: V4.settings.checks, retries: { DOCUMENT: 1, SELFIE: 1, LIVENESS: 1 } } }
    expect(evaluateCase({ submissions: { FACE_MATCH: [96], LIVENESS: [60, 72] } }, flow).status).toBe('PENDING_REVIEW')
  })
})

describe('retries per phase (DEC-108)', () => {
  it('Given failed ID images, then each uses a Document retry; the 4th failing one is FAILED (not REJECTED) with its condition (DEC-112)', () => {
    expect(evaluateCase({ submissions: {}, document: { failed: 3, lastFailed: 'ID image smaller than 320x320' } }, V4)).toMatchObject({ status: 'PROCESSING', reason: 'ID image smaller than 320x320 (Retry Allowed)' })
    const r = evaluateCase({ submissions: {}, document: { failed: 4, lastFailed: 'ID image smaller than 320x320' } }, V4)
    expect(r).toMatchObject({ status: 'FAILED', reason: 'ID image smaller than 320x320 (Retry Not Allowed)', exhaustedPhase: 'DOCUMENT' })
    expect(r.phases.find((p) => p.phase === 'DOCUMENT')).toEqual({ phase: 'DOCUMENT', submissions: 4, retriesUsed: 3, retriesAllowed: 3 })
  })

  it('Given a document that passed after 2 failures, then 2 Document retries used and the checks decide as usual', () => {
    const r = evaluateCase({ submissions: { FACE_MATCH: [96], LIVENESS: [90] }, document: { failed: 2 } }, V1)
    expect(r.status).toBe('APPROVED')
    expect(r.phases.map((p) => `${p.phase} ${p.retriesUsed}/${p.retriesAllowed}`)).toEqual(['DOCUMENT 2/3', 'SELFIE 0/3', 'LIVENESS 0/3'])
  })

  it('Given V1, then a failed selfie uses a Selfie retry, so fewer face match retries remain', () => {
    // 2 failed selfies + 2 face match submissions = 4 submissions: the Selfie phase's 3 retries are used up.
    const r = evaluateCase({ submissions: { FACE_MATCH: [80, 88], LIVENESS: [90] }, selfie: { failed: 2 } }, V1)
    expect(r).toMatchObject({ status: 'PENDING_REVIEW', reason: 'ID face and Selfie face do not match (Retry Not Allowed)' })
    expect(r.checks.find((c) => c.check === 'FACE_MATCH')).toMatchObject({ retriesUsed: 3, retriesAllowed: 3 })
    expect(evaluateCase({ submissions: { FACE_MATCH: [80, 88] }, selfie: { failed: 1 } }, V1).status).toBe('PROCESSING') // 2 of 3 used
  })

  it('Given V1 whose last submitted selfie failed its check, then retry pending while Selfie retries are left', () => {
    expect(evaluateCase({ submissions: {}, selfie: { failed: 1, lastFailed: 'No valid face in Selfie detected' } }, V1)).toMatchObject({ status: 'PROCESSING', reason: 'No valid face in Selfie detected (Retry Allowed)' })
  })

  it('Given V1 with Selfie retries used up and no selfie ever usable, then FAILED: no usable image (DEC-112)', () => {
    expect(evaluateCase({ submissions: {}, selfie: { failed: 4, lastFailed: 'No valid face in Selfie detected' } }, V1)).toMatchObject({ status: 'FAILED', reason: 'No valid face in Selfie detected (Retry Not Allowed)', exhaustedPhase: 'SELFIE' })
  })

  it('Given V1 with Selfie retries used up, a compared selfie below Auto-Reject and a blurry last selfie, then REJECTED by the face match, not FAILED (DEC-112)', () => {
    // Standard face match: Auto-Reject < 85. 3 compared selfies (60, 62, 58) + 1 blurry last one = 4 submissions.
    expect(evaluateCase({ submissions: { FACE_MATCH: [60, 62, 58] }, selfie: { failed: 1, lastFailed: 'No valid face in Selfie detected' } }, V1)).toMatchObject({ status: 'REJECTED', reason: 'ID face and Selfie face do not match (Retry Not Allowed)', exhaustedPhase: 'SELFIE' })
  })

  it('Given V1 with Selfie retries used up, a compared selfie in the review band and a blurry last selfie, then the face match is in review and liveness runs next (DEC-112)', () => {
    const r = evaluateCase({ submissions: { FACE_MATCH: [80, 90, 88] }, selfie: { failed: 1, lastFailed: 'No valid face in Selfie detected' } }, V1)
    expect(r.status).toBe('PROCESSING') // liveness not run yet
    expect(r.checks.find((c) => c.check === 'FACE_MATCH')!.state).toBe('REVIEW')
    expect(evaluateCase({ submissions: { FACE_MATCH: [80, 90, 88], LIVENESS: [90] }, selfie: { failed: 1, lastFailed: 'No valid face in Selfie detected' } }, V1)).toMatchObject({ status: 'PENDING_REVIEW', reason: 'ID face and Selfie face do not match (Retry Not Allowed)' })
  })

  it('Given V3/V4, then face match and liveness share the Liveness budget (one liveness submission scores both)', () => {
    const r = evaluateCase({ submissions: { FACE_MATCH: [96, 96, 90], LIVENESS: [60, 90, 90] } }, { ...V4, hasRisk: false })
    expect(r.phases.map((p) => p.phase)).toEqual(['DOCUMENT', 'LIVENESS'])
    expect(r.checks.map((c) => `${c.check} ${c.state} ${c.retriesUsed}/${c.retriesAllowed}`)).toEqual(['FACE_MATCH RETRY 2/3', 'LIVENESS PASS 2/3'])
  })
})

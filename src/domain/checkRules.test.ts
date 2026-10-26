import { describe, expect, it } from 'vitest'
import { RISK_NOT_PASSED, evaluateCase, evaluateRisk, evaluateCheck, type FlowContext } from './checkRules'
import type { CheckSettings } from './types'

// Standard presets (OQ-02): face match reject < 85, approve ≥ 95 · liveness reject < 70, approve ≥ 85. 3 retries.
const std = (retriesAllowed = 3): CheckSettings => ({ threshold: { preset: 'STANDARD' }, retriesAllowed })

const V4: FlowContext = {
  checks: ['FACE_MATCH', 'LIVENESS'],
  faceMatchMethod: 'ID_VS_LIVENESS',
  hasRisk: true,
  settings: { checks: { FACE_MATCH: std(), LIVENESS: std() }, risk: { enabled: true, minimums: { EXIF: 50, NOISE: 50, EMAIL_VALIDITY: 50, OSINT: 50 } } },
}
const CLEAN = { EXIF: 80, NOISE: 80, EMAIL_VALIDITY: 80, OSINT: 80 }
const V1: FlowContext = { ...V4, faceMatchMethod: 'ID_VS_SELFIE', hasRisk: false, settings: { checks: V4.settings.checks } }

describe('one check with retries (DEC-15, DEC-16, DEC-18)', () => {
  it('Given no submission yet, then pending', () => {
    expect(evaluateCheck('LIVENESS', [], std()).state).toBe('PENDING')
  })

  it('Given a score at or above Auto-Pass, then pass at once, on any attempt', () => {
    expect(evaluateCheck('LIVENESS', [85], std()).state).toBe('PASS')
    expect(evaluateCheck('LIVENESS', [50, 60, 90], std())).toMatchObject({ state: 'PASS', retriesUsed: 2 })
  })

  it('Given a score below Auto-Pass with retries left — review band or reject band — then retry', () => {
    expect(evaluateCheck('LIVENESS', [80], std()).state).toBe('RETRY')
    expect(evaluateCheck('LIVENESS', [10, 20, 30], std())).toMatchObject({ state: 'RETRY', retriesUsed: 2, retriesAllowed: 3 })
  })

  it('Given 3 retries allowed, then 4 submissions in total and the last one decides', () => {
    expect(evaluateCheck('LIVENESS', [10, 20, 30, 75], std())).toMatchObject({ state: 'REVIEW', submissions: 4, retriesUsed: 3, lastScore: 75 })
    expect(evaluateCheck('LIVENESS', [80, 80, 80, 69], std()).state).toBe('REJECT') // last, not best
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

  it('Given every check passes, then V1 is APPROVED; V4 also needs risk Clear, else PENDING_REVIEW with the categories missed (DEC-107)', () => {
    const pass = { FACE_MATCH: [96], LIVENESS: [90] }
    expect(evaluateCase({ submissions: pass }, V1).status).toBe('APPROVED')
    expect(evaluateCase({ submissions: pass }, V4).status).toBe('PROCESSING') // risk not run yet
    expect(evaluateCase({ submissions: pass, riskScores: { ...CLEAN, OSINT: 50 } }, V4).status).toBe('APPROVED') // at the minimum is enough
    expect(evaluateCase({ submissions: pass, riskScores: { ...CLEAN, OSINT: 22, EXIF: 49 } }, V4)).toMatchObject({ status: 'PENDING_REVIEW', reason: RISK_NOT_PASSED, detail: 'EXIF Score 49 < 50 · OSINT Score 22 < 50' })
  })

  it('Given the decision table, then biometric review or reject wins whatever the risk result (DEC-107)', () => {
    const flagged = { ...CLEAN, NOISE: 10 }
    expect(evaluateCase({ submissions: { FACE_MATCH: [96, 96, 96, 90], LIVENESS: [90, 90, 90, 90] }, riskScores: CLEAN }, V4).status).toBe('PENDING_REVIEW') // review + Clear
    expect(evaluateCase({ submissions: { FACE_MATCH: [96], LIVENESS: [10, 10, 10, 10] }, riskScores: flagged }, V4).status).toBe('REJECTED') // reject + Flagged: from biometrics
    expect(evaluateRisk(flagged, V4.settings.risk)).toMatchObject({ result: 'FLAGGED', below: [{ category: 'NOISE', score: 10, minimum: 50 }] })
    expect(evaluateRisk(CLEAN, V4.settings.risk).result).toBe('CLEAR')
  })

  it('Given 1 retry allowed (OQ-03 minimum), then the second submission decides', () => {
    const flow = { ...V1, settings: { checks: { FACE_MATCH: std(1), LIVENESS: std(1) } } }
    expect(evaluateCase({ submissions: { FACE_MATCH: [96], LIVENESS: [60, 72] } }, flow).status).toBe('PENDING_REVIEW')
  })
})

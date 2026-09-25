import { describe, expect, it } from 'vitest'
import { ALL_PASS, completed, config, stopped } from '@/test/factories'
import { deriveStatus, derivePhaseResult, REASONS, riskPasses } from './statusRules'
import { VERIFICATION_STATUSES } from './types'

describe('VerificationStatus (DEC-01)', () => {
  it('has exactly the 4 agreed statuses', () => {
    expect(VERIFICATION_STATUSES).toEqual(['PROCESSING', 'PENDING_REVIEW', 'APPROVED', 'REJECTED'])
  })
})

describe('derivePhaseResult (DEC-11)', () => {
  const c = { autoPass: 85, autoReject: 70 }
  it.each([
    [85, 'PASS'], // boundary: >= autoPass
    [99, 'PASS'],
    [84.9, 'REVIEW'],
    [70, 'REVIEW'], // boundary: equal to autoReject is not a reject
    [69.9, 'REJECT'],
  ] as const)('Given score %s with Pass 85 / Reject 70, then %s', (score, expected) => {
    expect(derivePhaseResult(score, c)).toBe(expected)
  })
})

describe('deriveStatus', () => {
  const v1 = config({ workflowVersion: 'V1', risk: undefined })
  const v4 = config()

  it('Given V1 and all phases >= Auto-Pass, then APPROVED (S01)', () => {
    expect(deriveStatus({ attempts: [completed(ALL_PASS)] }, v1)).toEqual({ status: 'APPROVED' })
  })

  it('Given Face Match between thresholds, then PENDING_REVIEW "Between thresholds" (S03)', () => {
    const r = deriveStatus({ attempts: [completed({ ...ALL_PASS, FACE_MATCH: 83.5 })], riskLevel: 'LOW' }, v4)
    expect(r).toEqual({ status: 'PENDING_REVIEW', reason: REASONS.BETWEEN_THRESHOLDS })
  })

  it('Given Liveness below Auto-Reject, then REJECTED (S04)', () => {
    const r = deriveStatus({ attempts: [completed({ ...ALL_PASS, LIVENESS: 40 })], riskLevel: 'LOW' }, v4)
    expect(r).toEqual({ status: 'REJECTED', reason: REASONS.BELOW_AUTO_REJECT })
  })

  it('Given a missing phase score, then it counts as 0 (reject)', () => {
    const { LIVENESS: _omit, ...noLiveness } = ALL_PASS
    expect(deriveStatus({ attempts: [completed(noLiveness)] }, v1).status).toBe('REJECTED')
  })

  it('Given a disabled phase, when its score is low, then it is ignored', () => {
    const cfg = config({ workflowVersion: 'V1', risk: undefined, phases: v1.phases.map((p) => (p.phase === 'SELFIE' ? { ...p, enabled: false } : p)) })
    expect(deriveStatus({ attempts: [completed({ ...ALL_PASS, SELFIE: 1 })] }, cfg).status).toBe('APPROVED')
  })

  describe('phase combination precedence (OQ-01)', () => {
    const mixed = { attempts: [completed({ ...ALL_PASS, FACE_MATCH: 80, LIVENESS: 10 })], riskLevel: 'LOW' as const }
    it('Given one review and one reject with REJECT_WINS, then REJECTED', () => {
      expect(deriveStatus(mixed, v4, 'REJECT_WINS').status).toBe('REJECTED')
    })
    it('Given one review and one reject with REVIEW_WINS, then PENDING_REVIEW', () => {
      expect(deriveStatus(mixed, v4, 'REVIEW_WINS').status).toBe('PENDING_REVIEW')
    })
  })

  describe('V4 risk gate (DEC-13)', () => {
    it('Given V4, all pass and risk HIGH with max MEDIUM, then PENDING_REVIEW "Risk Assessment not passed" (S02)', () => {
      expect(deriveStatus({ attempts: [completed(ALL_PASS)], riskLevel: 'HIGH' }, v4)).toEqual({
        status: 'PENDING_REVIEW',
        reason: REASONS.RISK_NOT_PASSED,
      })
    })
    it('Given V4, all pass and risk MEDIUM with max MEDIUM, then APPROVED', () => {
      expect(deriveStatus({ attempts: [completed(ALL_PASS)], riskLevel: 'MEDIUM' }, v4).status).toBe('APPROVED')
    })
    it('Given V4 with no risk result, then it cannot auto-approve', () => {
      expect(deriveStatus({ attempts: [completed(ALL_PASS)] }, v4).status).toBe('PENDING_REVIEW')
    })
    it('Given V1 with a HIGH risk level on the record, then risk is ignored', () => {
      expect(deriveStatus({ attempts: [completed(ALL_PASS)], riskLevel: 'HIGH' }, v1).status).toBe('APPROVED')
    })
    it('Given risk disabled in config, then riskPasses is true', () => {
      expect(riskPasses({ riskLevel: 'HIGH' }, { risk: { enabled: false, maxAllowedLevel: 'LOW' } })).toBe(true)
    })
  })

  describe('attempts (DEC-15, DEC-16)', () => {
    it('Given no attempts yet, then PROCESSING', () => {
      expect(deriveStatus({ attempts: [] }, v4).status).toBe('PROCESSING')
    })
    it.each(['ABORTED', 'TIMED_OUT', 'FAILED_RETAKE'] as const)('Given last attempt %s with attempts left, then PROCESSING (S05)', (outcome) => {
      expect(deriveStatus({ attempts: [stopped('LIVENESS', outcome)] }, v4)).toEqual({ status: 'PROCESSING' })
    })
    it('Given 3 failed Liveness attempts with max 3, then PENDING_REVIEW "Attempt limit reached – Liveness" (S06)', () => {
      const attempts = [1, 2, 3].map((n) => stopped('LIVENESS', 'FAILED_RETAKE', n))
      expect(deriveStatus({ attempts }, v4)).toEqual({ status: 'PENDING_REVIEW', reason: 'Attempt limit reached – Liveness' })
    })
    it('Given 2 failed Liveness attempts and 1 failed Selfie, then attempts are counted per phase (still PROCESSING)', () => {
      const attempts = [stopped('LIVENESS', 'FAILED_RETAKE', 1), stopped('LIVENESS', 'FAILED_RETAKE', 2), stopped('SELFIE', 'ABORTED', 3)]
      expect(deriveStatus({ attempts }, v4).status).toBe('PROCESSING')
    })
    it('Given failed retakes then a completed passing run, then the completed run decides (S13)', () => {
      const attempts = [stopped('LIVENESS', 'FAILED_RETAKE', 1), stopped('LIVENESS', 'FAILED_RETAKE', 2), completed(ALL_PASS, 3)]
      expect(deriveStatus({ attempts }, v1).status).toBe('APPROVED')
    })
  })
})

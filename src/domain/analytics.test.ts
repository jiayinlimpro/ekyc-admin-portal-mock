import { describe, expect, it } from 'vitest'
import { ALL_PASS, ALI, NOW, at, completed, config, minutes, stopped, verification } from '@/test/factories'
import { intelligenceStats, overviewStats, presetRange } from './analytics'
import { billingLine, billingTotals, monthRange } from './billing'
import { PRICING } from './openQuestions'

const range = presetRange(7, NOW)

describe('presetRange', () => {
  it('covers the last 7 MYT days including today, and the 7 days before', () => {
    // NOW = 25 Sep 2026 10:00 MYT → from 19 Sep 00:00 MYT
    expect(range.current).toEqual({ from: '2026-09-18T16:00:00.000Z', to: NOW.toISOString() })
    expect(range.previous).toEqual({ from: '2026-09-11T16:00:00.000Z', to: '2026-09-18T15:59:59.999Z' })
  })
})

describe('overviewStats', () => {
  const rows = [
    verification({ referenceNo: 'A', status: 'APPROVED', lastUpdatedBy: { kind: 'SYSTEM' } }),
    verification({ referenceNo: 'B', status: 'APPROVED', lastUpdatedBy: { kind: 'USER', userId: ALI.userId, fullName: ALI.fullName } }),
    verification({ referenceNo: 'C', status: 'PENDING_REVIEW', claimedBy: { userId: ALI.userId, fullName: ALI.fullName }, claimExpiresAt: at(minutes(5)).toISOString() }),
    verification({ referenceNo: 'D', status: 'PENDING_REVIEW' }),
    verification({ referenceNo: 'OLD', status: 'REJECTED', attempts: [{ ...completed(ALL_PASS), startedAt: '2026-09-15T02:00:00.000Z' }] }),
  ]
  const s = overviewStats(rows, range.current, range.previous, NOW)

  it('counts Auto-Clear as SYSTEM approvals only (DEC-14), manual decisions separately', () => {
    expect(s.total).toBe(4)
    expect(s.autoCleared).toBe(1)
    expect(s.manuallyDecided).toBe(1)
  })

  it('splits pending into claimed / unclaimed without a CLAIMED status (DEC-20)', () => {
    expect(s.pending).toEqual({ total: 2, claimed: 1, unclaimed: 1 })
    expect(Object.keys(s.byStatus)).toEqual(['PROCESSING', 'PENDING_REVIEW', 'APPROVED', 'REJECTED'])
  })

  it('has one bucket per MYT day, zeros included, and counts the previous period', () => {
    expect(s.daily).toHaveLength(7)
    expect(s.daily.at(-1)).toMatchObject({ day: '2026-09-25', counts: { APPROVED: 2, PENDING_REVIEW: 2 } })
    expect(s.previousTotal).toBe(1)
  })
})

describe('intelligenceStats', () => {
  const v = verification({ attempts: [stopped('LIVENESS', 'FAILED_RETAKE', 1), stopped('LIVENESS', 'FAILED_RETAKE', 2), completed({ ...ALL_PASS, FACE_MATCH: 83.5 }, 3)] })
  const limit = verification({ attempts: [1, 2, 3].map((n) => stopped('SELFIE', 'FAILED_RETAKE', n)) })
  const s = intelligenceStats([v, limit, verification()], range.current, () => config())

  it('counts user retakes only, by the phase being retaken (DEC-18)', () => {
    expect(s.userRetakes).toBe(4)
    expect(s.retriedSessions).toBe(2)
    expect(s.retakesByPhase).toMatchObject({ LIVENESS: 2, SELFIE: 2, DOCUMENT: 0 })
  })

  it('counts sessions that hit the attempt limit', () => {
    expect(s.attemptLimitReached).toBe(1)
  })

  it('bins the latest score per phase in 5-point bins', () => {
    expect(s.histograms.FACE_MATCH[16]).toBe(1) // 83.5 → [80,85)
    expect(s.histograms.FACE_MATCH[19]).toBe(1) // 95 → [95,100]
  })
})

describe('billing (DEC-60, OQ-07)', () => {
  const v = verification({ workflowVersion: 'V4', attempts: [stopped('LIVENESS', 'FAILED_RETAKE', 1), completed(ALL_PASS, 2)] })
  it('Given per-attempt charging off, then one charge per verification', () => {
    expect(billingLine(v, PRICING, false)).toMatchObject({ base: 2.5, retries: 0, total: 2.5, userRetakes: 1 })
  })
  it('Given per-attempt charging on, then retakes add Cost of Retries', () => {
    expect(billingLine(v, PRICING, true)).toMatchObject({ retries: 0.5, total: 3 })
  })
  it('Given a PROCESSING session, then it is still charged', () => {
    expect(billingLine(verification({ status: 'PROCESSING', attempts: [stopped('SELFIE', 'ABORTED')] }), PRICING, false).total).toBe(2.5)
  })
  it('totals without floating-point drift', () => {
    const lines = Array.from({ length: 3 }, () => billingLine(verification({ workflowVersion: 'V1' }), PRICING, false))
    expect(billingTotals(lines)).toEqual({ verifications: 3, base: 4.5, retries: 0, userRetakes: 0, total: 4.5 })
  })
  it('maps a billing month to MYT boundaries', () => {
    expect(monthRange('2026-09')).toEqual({ from: '2026-08-31T16:00:00.000Z', to: '2026-09-30T15:59:59.999Z' })
  })
})

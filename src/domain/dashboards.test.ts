import { describe, expect, it } from 'vitest'
import { ALI, NOW, at, minutes, verification } from '@/test/factories'
import { evaluateCheck } from './checkRules'
import { billingBy, billingLine, billingTotals, intelligenceStats, monthRange, overviewStats, presetRange, type CaseContext } from './dashboards'
import type { Verification } from './types'

const range = presetRange(7, NOW)
const HOUR = 3_600_000

describe('presetRange / monthRange', () => {
  it('covers the last 7 MYT days including today, and the 7 days before', () => {
    // NOW = 25 Sep 2026 10:00 MYT → from 19 Sep 00:00 MYT
    expect(range.current).toEqual({ from: '2026-09-18T16:00:00.000Z', to: NOW.toISOString() })
    expect(range.previous).toEqual({ from: '2026-09-11T16:00:00.000Z', to: '2026-09-18T15:59:59.999Z' })
  })

  it('maps a billing month to MYT', () => {
    expect(monthRange('2026-09')).toEqual({ from: '2026-08-31T16:00:00.000Z', to: '2026-09-30T15:59:59.999Z' })
  })
})

describe('overviewStats (DEC-14, DEC-20, DEC-86)', () => {
  const rows = [
    verification({ referenceNo: 'A', status: 'APPROVED', lastUpdatedBy: { kind: 'SYSTEM' } }),
    verification({ referenceNo: 'B', status: 'APPROVED', lastUpdatedBy: { kind: 'USER', userId: ALI.userId, fullName: ALI.fullName }, projectId: 'PRJ-0002', flowId: 'FLW-0004', workflowVersion: 'V3' }),
    verification({ referenceNo: 'C', status: 'PENDING_REVIEW', lastUpdatedAt: new Date(NOW.getTime() - 5 * HOUR).toISOString(), claimedBy: { userId: ALI.userId, fullName: ALI.fullName }, claimExpiresAt: at(minutes(5)).toISOString() }),
    verification({ referenceNo: 'D', status: 'PENDING_REVIEW', lastUpdatedAt: new Date(NOW.getTime() - 1 * HOUR).toISOString() }),
    verification({ referenceNo: 'E', status: 'REJECTED' }),
    verification({ referenceNo: 'OLD', status: 'REJECTED', createdAt: '2026-09-15T02:00:00.000Z' }),
  ]
  const s = overviewStats(rows, range.current, range.previous, NOW)

  it('counts Auto-Clear as SYSTEM approvals only, manual decisions separately, pending as claimed / unclaimed', () => {
    expect(s.total).toBe(5)
    expect(s.autoCleared).toBe(1)
    expect(s.manuallyDecided).toBe(1)
    expect(s.pending).toEqual({ total: 2, claimed: 1, unclaimed: 1 })
    expect(s.previousTotal).toBe(1)
    expect(s.daily).toHaveLength(7)
  })

  it('breaks down by project with pass rate (approved out of completed) and pending age (DEC-86)', () => {
    const def = s.byProject.find((r) => r.key === 'PRJ-0001')!
    expect(def).toMatchObject({ total: 4, pending: 2, oldestPendingHours: 5, avgPendingHours: 3 })
    expect(def.passRate).toBe(0.5) // A approved, E rejected
    expect(s.byProject.find((r) => r.key === 'PRJ-0002')!.passRate).toBe(1)
    expect(s.byFlow.map((r) => r.key).sort()).toEqual(['FLW-0001', 'FLW-0004'])
    expect(s.byVersion.find((r) => r.key === 'V3')!.total).toBe(1)
  })
})

describe('intelligenceStats (DEC-18, DEC-86)', () => {
  const settings = { threshold: { preset: 'STANDARD' as const }, retriesAllowed: 3 }
  const ctx = (v: Verification): CaseContext => ({
    checks: (['FACE_MATCH', 'LIVENESS'] as const).map((c) => evaluateCheck(c, v.submissions[c] ?? [], settings)),
    hasSelfie: v.workflowVersion === 'V1',
  })
  const rows = [
    verification({ referenceNo: 'clean', status: 'APPROVED', submissions: { FACE_MATCH: [96], LIVENESS: [90] } }),
    verification({ referenceNo: 'retried', status: 'APPROVED', submissions: { FACE_MATCH: [96, 96], LIVENESS: [60, 90] } }),
    verification({ referenceNo: 'exhausted', status: 'PENDING_REVIEW', submissions: { FACE_MATCH: [96, 96, 96, 96], LIVENESS: [60, 61, 62, 75] } }),
    verification({ referenceNo: 'id', status: 'PROCESSING', submissions: {} }),
    verification({ referenceNo: 'v1-selfie', status: 'PROCESSING', workflowVersion: 'V1', flowId: 'FLW-0005', submissions: { FACE_MATCH: [70] } }),
  ]
  const s = intelligenceStats(rows, range.current, ctx)

  it('counts face match and liveness retries only, first-attempt passes and retries used up', () => {
    expect(s).toMatchObject({ sessions: 5, submitted: 4, firstAttemptPass: 1, retriedSessions: 2, retries: 2 + 6, retriesExhausted: 1 })
    expect(s.retriesByCheck).toEqual({ FACE_MATCH: 4, LIVENESS: 4 })
  })

  it('reports unfinished sessions by the last phase reached, per flow; selfie only for flows with a selfie step', () => {
    expect(s.byFlow.find((f) => f.flowId === 'FLW-0001')!.dropOff).toEqual({ idCapture: 1, liveness: 0 })
    expect(s.byFlow.find((f) => f.flowId === 'FLW-0005')!.dropOff).toEqual({ idCapture: 0, selfie: 1, liveness: 0 })
  })
})

describe('billing (DEC-60)', () => {
  const lines = [
    billingLine(verification({ referenceNo: 'A', submissions: { FACE_MATCH: [96], LIVENESS: [90] } }), 0.5),
    billingLine(verification({ referenceNo: 'B', submissions: { FACE_MATCH: [96, 96, 96], LIVENESS: [60, 61, 90] }, status: 'PROCESSING' }), 0.5),
    billingLine(verification({ referenceNo: 'C', submissions: {}, projectId: 'PRJ-0002', flowId: 'FLW-0004' }), 0.5),
  ]

  it('charges a token per liveness submission whatever the status; ID capture and selfie are free', () => {
    expect(lines.map((l) => l.tokens)).toEqual([1, 3, 0])
    expect(lines[1]).toMatchObject({ retryTokens: 2, cost: 1.5 })
    expect(billingTotals(lines, 0.5)).toEqual({ verifications: 3, tokens: 4, retryTokens: 2, cost: 2, retryCost: 1 })
  })

  it('groups tokens and cost by project and flow', () => {
    expect(billingBy(lines, (l) => l.projectId, 0.5).map((r) => [r.key, r.tokens])).toEqual([
      ['PRJ-0001', 4],
      ['PRJ-0002', 0],
    ])
  })
})

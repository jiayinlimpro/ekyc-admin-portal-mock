import { describe, expect, it } from 'vitest'
import { ALI, NOW, completed, minutes, verification } from '@/test/factories'
import { fx } from '@/lib/ids'
import { continueCase, decideSessionStart, resumedAuditDetails } from './caseSessions'

const ACTIVE = { status: 'ACTIVE' } as const
const RULES = { cooldownMin: 120, unsuccessfulCooldownMin: 30 }
const endedAt = (minAgo: number) => new Date(NOW.getTime() - minutes(minAgo)).toISOString()

describe('decideSessionStart: a create-session request with a Reference ID (DEC-113, DEC-26)', () => {
  it('Given no case with that Reference ID in the project, then a new case', () => {
    expect(decideSessionStart(undefined, ACTIVE, undefined, NOW)).toEqual({ kind: 'NEW_CASE' })
  })

  it('Given a flow that is not Active, then refused whatever the case (DEC-95)', () => {
    expect(decideSessionStart(undefined, { status: 'RETIRING' }, undefined, NOW)).toMatchObject({ kind: 'REFUSED', code: 'FLOW_NOT_ACTIVE' })
  })

  it('Given the case is Processing, Pending Review or Approved, then refused (OQ-38)', () => {
    expect(decideSessionStart({ status: 'PROCESSING', lastUpdatedAt: endedAt(1) }, ACTIVE, RULES, NOW)).toMatchObject({ kind: 'REFUSED', code: 'IN_PROGRESS' })
    expect(decideSessionStart({ status: 'PENDING_REVIEW', lastUpdatedAt: endedAt(1) }, ACTIVE, RULES, NOW)).toMatchObject({ kind: 'REFUSED', code: 'IN_REVIEW' })
    expect(decideSessionStart({ status: 'APPROVED', lastUpdatedAt: endedAt(1) }, ACTIVE, RULES, NOW)).toMatchObject({ kind: 'REFUSED', code: 'APPROVED' })
  })

  it('Given Rejected 60 min ago with a 120-min Rejected cooldown, then refused until the end + 120 min', () => {
    expect(decideSessionStart({ status: 'REJECTED', lastUpdatedAt: endedAt(60) }, ACTIVE, RULES, NOW)).toEqual({
      kind: 'REFUSED',
      code: 'COOLDOWN',
      message: 'Cooldown running.',
      allowedFrom: new Date(NOW.getTime() + minutes(60)).toISOString(),
    })
  })

  it('Given Unsuccessful 60 min ago, then the 30-min Unsuccessful cooldown applies (the status picks it), so the case continues', () => {
    expect(decideSessionStart({ status: 'UNSUCCESSFUL', lastUpdatedAt: endedAt(60) }, ACTIVE, RULES, NOW)).toEqual({ kind: 'CONTINUE_CASE' })
    expect(decideSessionStart({ status: 'UNSUCCESSFUL', lastUpdatedAt: endedAt(10) }, ACTIVE, RULES, NOW)).toMatchObject({ kind: 'REFUSED', code: 'COOLDOWN' })
  })

  it('Given cooldown 0 (the default), then a Rejected or Unsuccessful case continues at once', () => {
    const none = { cooldownMin: 0, unsuccessfulCooldownMin: 0 }
    expect(decideSessionStart({ status: 'REJECTED', lastUpdatedAt: endedAt(0) }, ACTIVE, none, NOW).kind).toBe('CONTINUE_CASE')
    expect(decideSessionStart({ status: 'UNSUCCESSFUL', lastUpdatedAt: endedAt(0) }, ACTIVE, none, NOW).kind).toBe('CONTINUE_CASE')
  })
})

describe('continueCase: the new session on the same case (DEC-113)', () => {
  const rejectedByAli = verification({
    status: 'REJECTED',
    statusReason: 'Face not live',
    lastUpdatedBy: { kind: 'USER', userId: ALI.userId, fullName: ALI.fullName },
    lastUpdatedAt: endedAt(200),
    decidedReasons: [{ code: 'NOT_LIVE', name: 'Face not live' }],
    attempts: [completed({ FACE_MATCH: 96, LIVENESS: 60 }, 1), completed({ FACE_MATCH: 96, LIVENESS: 62 }, 2)],
    submissions: { FACE_MATCH: [96, 96], LIVENESS: [60, 62] },
  })
  const target = { flowId: fx('FLW-0002'), projectId: fx('PRJ-0001'), workflowVersion: 'W4', configRevision: 1 }

  it('Given a case a reviewer rejected, then same Verification ID, PROCESSING by SYSTEM, fresh retries, on the new flow', () => {
    const next = continueCase(rejectedByAli, target, NOW)
    expect(next).toMatchObject({ verificationId: rejectedByAli.verificationId, referenceId: rejectedByAli.referenceId, status: 'PROCESSING', lastUpdatedBy: { kind: 'SYSTEM' }, lastUpdatedAt: NOW.toISOString(), flowId: fx('FLW-0002'), configRevision: 1 })
    expect(next).toMatchObject({ attempts: [], submissions: {}, idCaptureSoftRejects: 0, statusReason: undefined, decidedReasons: undefined, riskScores: undefined })
    expect(next.createdAt).toBe(rejectedByAli.createdAt) // reports count the case once, from its first session
  })

  it('Given the new session, then the ended one keeps how it ended, by whom, its tokens and its attempts', () => {
    const [first, second] = continueCase(rejectedByAli, target, NOW).sessions
    expect(first).toMatchObject({ sessionNo: 1, flowId: fx('FLW-0001'), ended: { status: 'REJECTED', reason: 'Face not live', at: endedAt(200), by: { kind: 'USER', fullName: ALI.fullName }, tokens: 2, retryTokens: 1 } })
    expect(first.ended!.attempts).toHaveLength(2)
    expect(second).toEqual({ sessionNo: 2, startedAt: NOW.toISOString(), flowId: fx('FLW-0002'), workflowVersion: 'W4', configRevision: 1 })
  })

  it('Given a third session, then sessions 1 and 2 are both kept', () => {
    const second = { ...continueCase(rejectedByAli, target, NOW), status: 'UNSUCCESSFUL' as const, lastUpdatedAt: NOW.toISOString() }
    expect(continueCase(second, target, new Date(NOW.getTime() + minutes(5))).sessions.map((s) => `${s.sessionNo} ${s.ended?.status ?? 'current'}`)).toEqual(['1 REJECTED', '2 UNSUCCESSFUL', '3 current'])
  })

  it('Given a case that is not Rejected or Unsuccessful, or a flow in another project, then it never continues (OQ-37, OQ-38)', () => {
    expect(() => continueCase(verification({ status: 'APPROVED' }), target, NOW)).toThrow()
    expect(() => continueCase(rejectedByAli, { ...target, projectId: fx('PRJ-0002') }, NOW)).toThrow(/new case/)
  })

  it('Given the audit entry, then CASE_RESUMED names the previous status, the session and the flow move', () => {
    const next = continueCase(rejectedByAli, target, NOW)
    expect(resumedAuditDetails(rejectedByAli, next, (id) => (id === fx('FLW-0001') ? 'Malaysian onboarding' : 'Foreigner onboarding'))).toEqual({
      fromStatus: 'REJECTED',
      toStatus: 'PROCESSING',
      sessionNo: 2,
      fromFlowId: fx('FLW-0001'),
      toFlowId: fx('FLW-0002'),
      fromFlowName: 'Malaysian onboarding',
      toFlowName: 'Foreigner onboarding',
      configRevision: 1,
    })
  })
})

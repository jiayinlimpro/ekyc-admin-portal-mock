// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuditAction } from '@/domain/types'
import { verificationIdOf, fx } from '@/lib/ids'
import { db } from '@/mocks/mockDb'
import { ADMIN, ALI, NOW, OTHER_MERCHANT_REVIEWER, OWNER } from '@/test/factories'
import { auditService } from './auditService'
import { devService } from './devService'
import { projectService as projects } from './projectService'
import { verificationService as svc } from './verificationService'

const ATOZ = fx('PRJ-0001')
const C = (n: number) => verificationIdOf(`KYC-260901-${900000 + n}`)
const lastAudit = async (action: AuditAction) => (await auditService.list({ actions: [action] }, ADMIN)).items[0]
const reasonsAt = (projectId: string) => db.state().projects.find((p) => p.projectId === projectId)!.decisionReasons

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  await devService.resetDemoData()
})

describe('decision reasons in Project Settings › Review operations (DEC-106)', () => {
  it('Given the Owner adds a Reject reason, then a generated code, audited as a project setting; a duplicate name is refused', async () => {
    const p = await projects.addDecisionReason(ATOZ, { name: 'Document not in Malay or English', outcome: 'REJECT', group: 'DOCUMENT', noteRequired: false }, OWNER)
    expect(p.decisionReasons.custom.at(-1)).toMatchObject({ code: 'CUSTOM_DOCUMENT_NOT_IN_MALAY_OR_ENGLISH', system: false, active: true, group: 'DOCUMENT' })
    expect(await lastAudit('PROJECT_SETTING_CHANGED')).toMatchObject({ projectId: ATOZ, details: { changes: [{ field: 'Decision reason added', to: 'Document not in Malay or English (Reject · Document)' }] } })
    await expect(projects.addDecisionReason(ATOZ, { name: 'Document expired', outcome: 'REJECT', group: 'DOCUMENT', noteRequired: false }, OWNER)).rejects.toMatchObject({ code: 'VALIDATION', message: 'A Reject reason with this name already exists.' })
  })

  it('Given a Reviewer, then reasons can’t be changed (Project settings · Edit only)', async () => {
    await expect(projects.setDecisionReasonActive(ATOZ, 'UNDERAGE', false, ALI)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('Given System Default reasons, then they can be turned off but not edited, and "Other" stays on', async () => {
    await expect(projects.updateDecisionReason(ATOZ, 'UNDERAGE', { name: 'Too young', group: 'IDENTITY', noteRequired: false }, OWNER)).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(projects.setDecisionReasonActive(ATOZ, 'REJECT_OTHER', false, OWNER)).rejects.toMatchObject({ message: '“Other” stays on, so every outcome always has a reason.' })
    const p = await projects.setDecisionReasonActive(ATOZ, 'UNDERAGE', false, OWNER)
    expect(p.decisionReasons.disabledSystemCodes).toEqual(['UNDERAGE'])
    expect(await lastAudit('PROJECT_SETTING_CHANGED')).toMatchObject({ details: { changes: [{ field: 'Decision reason “Below minimum age” (Reject · Identity & eligibility)', from: 'On', to: 'Off' }] } })
  })

  it('Given a reason turned off, then the case page no longer offers it and a save with it is refused', async () => {
    await projects.setDecisionReasonActive(ATOZ, 'UNDERAGE', false, OWNER)
    await svc.claim(C(10), ALI)
    const d = await svc.get(C(10), ALI)
    expect(d.reasonOptions.map((r) => r.code)).not.toContain('UNDERAGE')
    expect(d.reasonOptions.map((r) => r.code)).toContain('CUSTOM_CUSTOMER_ON_INTERNAL_WATCHLIST') // Atoz Default's own reason
    await expect(svc.decide(C(10), ALI, { outcome: 'REJECT', reasonCodes: ['UNDERAGE'] })).rejects.toMatchObject({ code: 'VALIDATION', message: '“Below minimum age” is turned off in this project.' })
  })

  it('Given a decision with a Custom reason that is later renamed, then the case keeps the name it was decided with', async () => {
    await svc.claim(C(10), ALI)
    const d = await svc.decide(C(10), ALI, { outcome: 'APPROVE', reasonCodes: ['CUSTOM_CONFIRMED_BY_VIDEO_CALL'] })
    expect(d).toMatchObject({ status: 'APPROVED', statusReason: 'Identity confirmed by video call', decidedReasons: [{ code: 'CUSTOM_CONFIRMED_BY_VIDEO_CALL', name: 'Identity confirmed by video call' }] })
    expect(await lastAudit('CASE_DECISION_APPROVED')).toMatchObject({ details: { reasonCodes: ['CUSTOM_CONFIRMED_BY_VIDEO_CALL'], reasons: 'Identity confirmed by video call' } })
    await projects.updateDecisionReason(ATOZ, 'CUSTOM_CONFIRMED_BY_VIDEO_CALL', { name: 'Confirmed on a video call', noteRequired: true }, OWNER)
    expect(reasonsAt(ATOZ).custom.find((r) => r.code === 'CUSTOM_CONFIRMED_BY_VIDEO_CALL')).toMatchObject({ name: 'Confirmed on a video call', noteRequired: true })
    expect((await svc.get(C(10), ALI)).decidedReasons![0].name).toBe('Identity confirmed by video call')
  })

  it('Given Vantage Default, then its turned-off reason is not offered and Atoz’s Custom reasons are not there', async () => {
    const d = await svc.get(C(20), OTHER_MERCHANT_REVIEWER)
    const codes = d.reasonOptions.map((r) => r.code)
    expect(codes).not.toContain('NATIONALITY_NOT_ACCEPTED')
    expect(codes.some((c) => c.startsWith('CUSTOM_'))).toBe(false)
  })
})

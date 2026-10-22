// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PLATFORM_ROLE_IDS, SYSTEM_ROLE_IDS, WRONG_ROLE_TYPE } from '@/domain/roles'
import type { AuditAction } from '@/domain/types'
import { caseIdOf, fx } from '@/lib/ids'
import { db } from '@/mocks/mockDb'
import { ADMIN, ALI, NOW, OWNER } from '@/test/factories'
import { mayInProject } from './accessGuard'
import { auditService } from './auditService'
import { devService } from './devService'
import { merchantAdminService } from './merchantAdminService'
import { registryService } from './registryService'
import { roleService } from './roleService'
import { staffService as staff } from './staffService'
import { userAdminService as users } from './userAdminService'
import { verificationService } from './verificationService'

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  await devService.resetDemoData()
})

const DANIEL = { userId: fx('USR-2026-0006'), fullName: 'Daniel Tan' } // Support · All merchants
const PRIYA = { userId: fx('USR-2026-0007'), fullName: 'Priya Nair' } // Verification Specialist · Vantage, ends in 14 days
const HANNAH = { userId: fx('USR-2026-0008'), fullName: 'Hannah Lee' } // Finance
const lastAudit = async (action: AuditAction) => (await auditService.list({ actions: [action] }, ADMIN)).items[0]

describe('platform staff: what they can do (DEC-99)', () => {
  it('Given Support, then masked case detail (audited as masked), merchants read-only, no registry changes', async () => {
    const d = await verificationService.get(caseIdOf('KYC-260901-900003'), DANIEL)
    expect(d.masked).toBe(true)
    expect(d.pii.nric).toMatch(/^[•-]+\d{4}$/)
    expect(d.pii.address).toContain('hidden')
    expect(d.images.docFront.url).toBe('')
    expect(d.pii.fullName).not.toContain('•')
    expect(await lastAudit('SENSITIVE_PII_VIEW')).toMatchObject({ actorRole: 'Support', details: { masked: true } })
    expect((await merchantAdminService.list(DANIEL)).length).toBeGreaterThan(0)
    await expect(merchantAdminService.changeStatus(fx('MER-0003'), 'SUSPENDED', 'Trying something', DANIEL)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(registryService.list(DANIEL)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('Given a merchant user, then the case detail is unmasked as before (DEC-41)', async () => {
    expect((await verificationService.get(caseIdOf('KYC-260901-900003'), ALI)).masked).toBeUndefined()
  })

  it('Given Priya (Verification Specialist, Vantage), then she reviews Vantage cases unmasked, and nothing of Atoz', async () => {
    const d = await verificationService.get(caseIdOf('KYC-260901-900013'), PRIYA)
    expect(d.masked).toBeUndefined()
    expect(mayInProject(PRIYA, 'claimCase', fx('PRJ-0003'))).toBe(true)
    await expect(verificationService.get(caseIdOf('KYC-260901-900003'), PRIYA)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('Given Priya’s access is changed to Finance while she holds a claim, then the claim is released at once', async () => {
    const pending = db.state().verifications.find((v) => v.projectId === fx('PRJ-0003') && v.status === 'PENDING_REVIEW' && !v.claimedBy)!
    await verificationService.claim(pending.caseId, PRIYA)
    const row = db.state().accounts.find((a) => a.userId === PRIYA.userId)!.assignments[0]
    await staff.changeAssignment(PRIYA.userId, row.assignmentId, { roleId: PLATFORM_ROLE_IDS.FINANCE, scope: { kind: 'ALL_MERCHANTS' } }, ADMIN)
    expect(mayInProject(PRIYA, 'viewCases', fx('PRJ-0003'))).toBe(false)
    expect(db.state().verifications.find((v) => v.caseId === pending.caseId)!.claimedBy).toBeUndefined()
    expect(await lastAudit('CASE_RELEASED')).toMatchObject({ details: { reason: 'Access changed' } })
  })

  it('Given Finance, then Billing for every merchant but no cases', async () => {
    expect(mayInProject(HANNAH, 'viewBilling', fx('PRJ-0001'))).toBe(true)
    await expect(verificationService.get(caseIdOf('KYC-260901-900003'), HANNAH)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('platform staff: managed only by super admins (DEC-99)', () => {
  it('Given a super admin, then staff are listed with their access; to a Merchant Owner they don’t exist', async () => {
    const rows = await staff.list(ADMIN)
    expect(rows.find((r) => r.userId === HANNAH.userId)!.access.map((c) => c.label)).toEqual(['Finance · Platform-wide'])
    expect(rows.find((r) => r.userId === DANIEL.userId)!.access.map((c) => c.label)).toEqual(['Support · All merchants'])
    await expect(staff.list(OWNER)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(staff.get(DANIEL.userId, OWNER)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(users.get(DANIEL.userId, OWNER)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(staff.list(DANIEL)).rejects.toMatchObject({ code: 'NOT_FOUND' }) // staff never manage staff
  })

  it('Given a new staff member, then the company domain, a platform role, Selected merchants', async () => {
    const assignment = { roleId: PLATFORM_ROLE_IDS.VERIFICATION_SPECIALIST, scope: { kind: 'MERCHANTS' as const, merchantIds: [fx('MER-0001')] } }
    await expect(staff.invite({ fullName: 'Outside Person', email: 'someone@gmail.example', assignment }, ADMIN)).rejects.toMatchObject({ message: 'Use a company email (@ekyc-platform.example).' })
    await expect(staff.invite({ fullName: 'Wrong Role', email: 'wrong.role@ekyc-platform.example', assignment: { ...assignment, roleId: SYSTEM_ROLE_IDS.REVIEWER } }, ADMIN)).rejects.toMatchObject({ code: 'VALIDATION' })
    const id = await staff.draftUserId(ADMIN)
    const row = await staff.invite({ userId: id, fullName: 'Mira Chen', email: 'mira.chen@ekyc-platform.example', assignment }, ADMIN)
    expect(row).toMatchObject({ userId: id, status: 'PENDING', access: [{ label: 'Verification Specialist · Atoz Software Tech' }] })
    const created = db.state().accounts.find((a) => a.userId === id)!
    expect(created.level).toBe('PLATFORM_STAFF')
    expect(created.merchantId).toBeUndefined()
    expect(await lastAudit('USER_INVITED')).toMatchObject({ actorRole: 'Super admin', details: { type: 'Platform (internal)' } })
  })

  it('Given a merchant user, then platform roles can’t be given and the staff domain isn’t allowed', async () => {
    await expect(users.addAssignment(ALI.userId, { roleId: PLATFORM_ROLE_IDS.SUPPORT, scope: { kind: 'ALL_PROJECTS' } }, ADMIN)).rejects.toMatchObject({ message: WRONG_ROLE_TYPE })
    await expect(users.invite(fx('MER-0001'), { fullName: 'Staff Here', email: 'staff.here@ekyc-platform.example', assignment: { roleId: SYSTEM_ROLE_IDS.VIEWER, scope: { kind: 'ALL_PROJECTS' } } }, OWNER)).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('Given platform roles, then only super admins create or open them; merchant admins never see them', async () => {
    const r = await roleService.create(undefined, { audience: 'PLATFORM', name: 'Night support', permissions: ['P_CASES_VIEW_UNMASKED'] }, ADMIN)
    expect(r).toMatchObject({ audience: 'PLATFORM', permissions: ['P_CASES_VIEW_MASKED', 'P_CASES_VIEW_UNMASKED'] })
    expect(r.merchantId).toBeUndefined()
    await expect(roleService.create(undefined, { audience: 'PLATFORM', name: 'Mine', permissions: ['P_FLOWS_VIEW'] }, OWNER)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(roleService.create(fx('MER-0001'), { name: 'Mixed', permissions: ['VIEW_CASES', 'P_FLOWS_VIEW'] }, OWNER)).rejects.toMatchObject({ code: 'VALIDATION' })
    expect((await roleService.list(OWNER)).some((x) => x.audience === 'PLATFORM')).toBe(false)
    await expect(roleService.update(PLATFORM_ROLE_IDS.SUPPORT, { name: 'Support', permissions: ['P_FLOWS_VIEW'] }, OWNER)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect((await roleService.list(ADMIN)).filter((x) => x.audience === 'PLATFORM').map((x) => x.name)).toEqual(['Platform Operations', 'Support', 'Verification Specialist', 'Finance', 'Workflow Engineer', 'Night support'])
  })
})

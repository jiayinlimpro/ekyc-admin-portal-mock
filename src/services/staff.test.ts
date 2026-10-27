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
import { flowService } from './flowService'
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

const DANIEL = { userId: fx('USR-2026-0006'), fullName: 'Daniel Tan' } // Support
const HANNAH = { userId: fx('USR-2026-0008'), fullName: 'Hannah Lee' } // Finance
const MARCUS = { userId: fx('USR-2026-0009'), fullName: 'Marcus Lee' } // Implementation
const RIZAL = { userId: fx('USR-2026-0010'), fullName: 'Rizal Hakim' } // Platform Admin
const lastAudit = async (action: AuditAction) => (await auditService.list({ actions: [action] }, ADMIN)).items[0]

describe('platform staff: one role, every merchant (DEC-99, DEC-104)', () => {
  it('Given Support, then the full case page in any merchant (no masking), audited; no decisions, no merchants or registry', async () => {
    for (const ref of ['KYC-260901-900003', 'KYC-260901-900013']) {
      const d = await verificationService.get(caseIdOf(ref), DANIEL)
      expect(d.pii.nric).toMatch(/^\d{6}-\d{2}-\d{4}$|^[A-Z0-9]+$/)
      expect(d.images.docFront.url).not.toBe('')
    }
    expect(await lastAudit('SENSITIVE_PII_VIEW')).toMatchObject({ actorRole: 'Support', actor: { userId: DANIEL.userId } })
    expect(mayInProject(DANIEL, 'claimCase', fx('PRJ-0001'))).toBe(false)
    await expect(merchantAdminService.list(DANIEL)).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/) })
    await expect(registryService.list(DANIEL)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('Given View list without View details (Auditor), then the case is in the list but its page is refused', async () => {
    const auditor = await users.invite(fx('MER-0001'), { fullName: 'Case Auditor', email: 'auditor@atoz.example', roleId: SYSTEM_ROLE_IDS.AUDITOR }, OWNER)
    const who = { userId: auditor.userId, fullName: auditor.fullName }
    db.setState((st) => ({ accounts: st.accounts.map((a) => (a.userId === who.userId ? { ...a, status: 'ACTIVE' } : a)) }))
    expect((await verificationService.list({ referenceNo: 'KYC-260901-900003' }, who)).items).toHaveLength(1)
    await expect(verificationService.get(caseIdOf('KYC-260901-900003'), who)).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'You can see this case in the list, but not its details.' })
  })

  it('Given Implementation, then flows in any merchant, but no cases', async () => {
    expect((await flowService.list(fx('PRJ-0003'), MARCUS)).length).toBeGreaterThan(0)
    expect(mayInProject(MARCUS, 'activateFlows', fx('PRJ-0001'))).toBe(true)
    await expect(verificationService.get(caseIdOf('KYC-260901-900003'), MARCUS)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('Given Platform Admin’s role is changed to Finance while holding a claim, then the claim is released at once', async () => {
    const pending = db.state().verifications.find((v) => v.projectId === fx('PRJ-0003') && v.status === 'PENDING_REVIEW' && !v.claimedBy)!
    await verificationService.claim(pending.caseId, RIZAL)
    const d = await staff.setRole(RIZAL.userId, PLATFORM_ROLE_IDS.FINANCE, ADMIN)
    expect(d.roleName).toBe('Finance')
    expect(mayInProject(RIZAL, 'viewCases', fx('PRJ-0003'))).toBe(false)
    expect(db.state().verifications.find((v) => v.caseId === pending.caseId)!.claimedBy).toBeUndefined()
    expect(await lastAudit('CASE_RELEASED')).toMatchObject({ details: { reason: 'Role changed' } })
    expect(await lastAudit('USER_ACCESS_CHANGED')).toMatchObject({ details: { changes: [{ from: 'Platform Admin', to: 'Finance' }] } })
  })

  it('Given Finance, then Billing for every merchant but no cases', async () => {
    expect(mayInProject(HANNAH, 'viewBilling', fx('PRJ-0001'))).toBe(true)
    await expect(verificationService.get(caseIdOf('KYC-260901-900003'), HANNAH)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('platform staff: merchant users, roles, projects and members, as their role allows (DEC-104)', () => {
  const KAVITHA = fx('USR-2026-0044')
  it('Given Platform Admin, then Vantage’s users: invite with a merchant role, change a role; Support may not', async () => {
    expect((await users.list(RIZAL, fx('MER-0002'))).map((r) => r.fullName)).toEqual(expect.arrayContaining(['Kavitha A/P Subramaniam']))
    const row = await users.invite(fx('MER-0002'), { fullName: 'Vantage Billing', email: 'billing@vantage.example', roleId: SYSTEM_ROLE_IDS.BILLING }, RIZAL)
    expect(row.merchantRoleName).toBe('Billing')
    expect((await users.setRole(KAVITHA, SYSTEM_ROLE_IDS.MEMBER, RIZAL)).merchantRole?.roleName).toBe('Member')
    expect(await lastAudit('USER_ACCESS_CHANGED')).toMatchObject({ actorRole: 'Platform Admin', merchantId: fx('MER-0002') })
    await expect(users.list(DANIEL)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('Given Platform Admin, then a merchant role and a project role at Vantage, and a member added in its Default project', async () => {
    const merchantRole = await roleService.create(fx('MER-0002'), { name: 'Vantage desk', permissions: ['VIEW_USERS'] }, RIZAL)
    expect(merchantRole).toMatchObject({ level: 'MERCHANT', merchantId: fx('MER-0002') })
    const projectRole = await roleService.create(fx('MER-0002'), { name: 'Night reviewer', permissions: ['CLAIM_CASES'], projectId: fx('PRJ-0003') }, RIZAL)
    expect(projectRole).toMatchObject({ level: 'PROJECT', projectId: fx('PRJ-0003') })
    const members = await users.addMember(fx('PRJ-0003'), fx('USR-2026-0045'), projectRole.roleId, RIZAL)
    expect(members.find((m) => m.userId === fx('USR-2026-0045'))!.roles.map((r) => r.roleName)).toContain('Night reviewer')
    await expect(roleService.create(fx('MER-0002'), { name: 'Nope', permissions: ['VIEW_USERS'] }, DANIEL)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('platform staff: managed only by super admins (DEC-99)', () => {
  it('Given a super admin, then staff are listed with their one role; to an Owner they don’t exist', async () => {
    const rows = await staff.list(ADMIN)
    expect(rows.find((r) => r.userId === HANNAH.userId)!.access.map((c) => c.label)).toEqual(['Finance'])
    expect(rows.find((r) => r.userId === DANIEL.userId)!.access.map((c) => c.label)).toEqual(['Support'])
    await expect(staff.list(OWNER)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(staff.get(DANIEL.userId, OWNER)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(users.get(DANIEL.userId, OWNER)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(staff.list(DANIEL)).rejects.toMatchObject({ code: 'NOT_FOUND' }) // staff never manage staff
  })

  it('Given a new staff member, then the company domain and a platform role (no scope to choose)', async () => {
    await expect(staff.invite({ fullName: 'Outside Person', email: 'someone@gmail.example', roleId: PLATFORM_ROLE_IDS.SUPPORT }, ADMIN)).rejects.toMatchObject({ message: 'Use a company email (@ekyc-platform.example).' })
    await expect(staff.invite({ fullName: 'Wrong Role', email: 'wrong.role@ekyc-platform.example', roleId: SYSTEM_ROLE_IDS.REVIEWER }, ADMIN)).rejects.toMatchObject({ message: WRONG_ROLE_TYPE })
    const id = await staff.draftUserId(ADMIN)
    const row = await staff.invite({ userId: id, fullName: 'Mira Chen', email: 'mira.chen@ekyc-platform.example', roleId: PLATFORM_ROLE_IDS.SUPPORT }, ADMIN)
    expect(row).toMatchObject({ userId: id, status: 'PENDING', access: [{ label: 'Support' }] })
    const created = db.state().accounts.find((a) => a.userId === id)!
    expect(created).toMatchObject({ level: 'PLATFORM_STAFF', assignments: [{ scope: { kind: 'ALL_MERCHANTS' } }] })
    expect(created.merchantId).toBeUndefined()
    expect(await lastAudit('USER_INVITED')).toMatchObject({ actorRole: 'Super admin', details: { type: 'Platform (internal)' } })
  })

  it('Given a merchant user, then platform roles can’t be given and the staff domain isn’t allowed', async () => {
    await expect(users.setRole(ALI.userId, PLATFORM_ROLE_IDS.SUPPORT, ADMIN)).rejects.toMatchObject({ message: WRONG_ROLE_TYPE })
    await expect(users.invite(fx('MER-0001'), { fullName: 'Staff Here', email: 'staff.here@ekyc-platform.example' }, OWNER)).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('Given platform roles, then only super admins create or open them; merchant admins never see them', async () => {
    const r = await roleService.create(undefined, { audience: 'PLATFORM', name: 'Night support', permissions: ['P_CASES_CLAIM'] }, ADMIN)
    expect(r).toMatchObject({ audience: 'PLATFORM', permissions: ['P_CASES_LIST', 'P_CASES_DETAILS', 'P_CASES_CLAIM'] })
    expect(r.merchantId).toBeUndefined()
    await expect(roleService.create(undefined, { audience: 'PLATFORM', name: 'Mine', permissions: ['P_FLOWS_VIEW'] }, OWNER)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(roleService.create(fx('MER-0001'), { name: 'Mixed', permissions: ['VIEW_CASE_LIST', 'P_FLOWS_VIEW'] }, OWNER)).rejects.toMatchObject({ code: 'VALIDATION' })
    expect((await roleService.list(OWNER)).some((x) => x.audience === 'PLATFORM')).toBe(false)
    await expect(roleService.update(PLATFORM_ROLE_IDS.SUPPORT, { name: 'Support', permissions: ['P_FLOWS_VIEW'] }, OWNER)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect((await roleService.list(ADMIN)).filter((x) => x.audience === 'PLATFORM').map((x) => x.name)).toEqual(['Platform Admin', 'Support', 'Implementation', 'Finance', 'Night support'])
  })
})

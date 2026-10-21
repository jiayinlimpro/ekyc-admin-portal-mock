// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GRANT_TOO_POWERFUL, MERCHANT_LEVEL_SCOPE, ROLE_IN_USE, ROLE_NEEDS_PERMISSION, SYSTEM_ROLE_IDS } from '@/domain/roles'
import type { AssignmentScope, AuditAction } from '@/domain/types'
import { db } from '@/mocks/mockDb'
import { ADMIN, ALI, HAFIZ, NOW, OWNER, SITI } from '@/test/factories'
import { mayInProject, requireActive } from './accessGuard'
import { auditService } from './auditService'
import { devService } from './devService'
import { roleService } from './roleService'
import { userAdminService as users } from './userAdminService'

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  await devService.resetDemoData()
})

const { MERCHANT_OWNER, PROJECT_ADMIN, REVIEWER, VIEWER } = SYSTEM_ROLE_IDS
const ALL: AssignmentScope = { kind: 'ALL_PROJECTS' }
const only = (...projectIds: string[]): AssignmentScope => ({ kind: 'PROJECTS', projectIds })
const account = (userId: string) => db.state().accounts.find((a) => a.userId === userId)!
const caseOf = (ref: string) => db.state().verifications.find((v) => v.referenceNo === ref)!
const lastAudit = async (action: AuditAction) => (await auditService.list({ actions: [action] }, ADMIN)).items[0]
const aliAssignment = (projectId: string) => account(ALI.userId).assignments.find((x) => x.scope.kind === 'PROJECTS' && x.scope.projectIds.includes(projectId))!
const VANTAGE_OWNER = { userId: 'USR-2026-0045', fullName: 'Ahmad Faiz Bin Zulkifli' }
const KAVITHA = { userId: 'USR-2026-0044', fullName: 'Kavitha A/P Subramaniam' }

describe('userAdminService: the Users screen (DEC-74)', () => {
  it('Given the Merchant Owner, then their merchant’s users, newest first, with the Access column; no Platform Admin', async () => {
    const rows = await users.list(OWNER)
    expect(rows.every((r) => r.merchantId === 'MER-0001')).toBe(true)
    expect(rows.map((r) => r.createdAt)).toEqual([...rows.map((r) => r.createdAt)].sort().reverse())
    expect(rows.find((r) => r.userId === ALI.userId)!.access.map((c) => c.label)).toEqual(['Reviewer · Default', 'Viewer · SME app'])
    expect(rows.find((r) => r.userId === OWNER.userId)!.access.map((c) => c.label)).toEqual(['Merchant Owner · All projects'])
    expect(rows.some((r) => r.userId === ADMIN.userId)).toBe(false)
  })

  it('Given Platform Admin, then every merchant’s users; given a Reviewer or a Project Admin, then forbidden', async () => {
    expect(new Set((await users.list(ADMIN)).map((r) => r.merchantId)).size).toBeGreaterThan(2)
    await expect(users.list(ALI)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(users.list(HAFIZ)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('Given an invitation, then the user is Pending with the first assignment, audited in that project', async () => {
    const row = await users.invite('MER-0001', { fullName: 'Aishah Binti Omar', email: 'Aishah@atoz.example', assignment: { roleId: REVIEWER, scope: only('PRJ-0002') } }, OWNER)
    expect(row).toMatchObject({ status: 'PENDING', email: 'aishah@atoz.example', access: [{ label: 'Reviewer · SME app', archived: false }] })
    expect(await lastAudit('USER_INVITED')).toMatchObject({ projectId: 'PRJ-0002', actorRole: 'Merchant Owner', details: { access: 'Reviewer · SME app' } })
    await expect(users.invite('MER-0001', { fullName: 'Aishah Again', email: 'aishah@atoz.example', assignment: { roleId: REVIEWER, scope: only('PRJ-0002') } }, OWNER)).rejects.toMatchObject({ code: 'VALIDATION', message: 'A user with this email already exists' })
  })

  it('Given Merchant Owner for selected projects, then refused: merchant-level permissions need All projects', async () => {
    await expect(users.invite('MER-0001', { fullName: 'Aishah Binti Omar', email: 'aishah@atoz.example', assignment: { roleId: MERCHANT_OWNER, scope: only('PRJ-0001') } }, OWNER)).rejects.toMatchObject({ message: MERCHANT_LEVEL_SCOPE })
  })

  it('Given a second owner, then the first can be demoted; the last one cannot be removed or suspended', async () => {
    const owner = account(OWNER.userId).assignments[0]
    await expect(users.removeAssignment(OWNER.userId, owner.assignmentId, ADMIN)).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(users.suspend(OWNER.userId, ADMIN)).rejects.toMatchObject({ code: 'VALIDATION' })
    await users.addAssignment(SITI.userId, { roleId: MERCHANT_OWNER, scope: ALL }, ADMIN)
    const d = await users.changeAssignment(OWNER.userId, owner.assignmentId, { roleId: PROJECT_ADMIN, scope: ALL }, ADMIN)
    expect(d.access.map((c) => c.label)).toEqual(['Project Admin · All projects'])
  })

  it('Given anyone, then they cannot change their own access', async () => {
    await expect(users.addAssignment(OWNER.userId, { roleId: REVIEWER, scope: only('PRJ-0001') }, OWNER)).rejects.toThrow('You can’t change your own access.')
  })

  it('Given Ali becomes a Viewer in Default, then his claim there is released and the change is audited', async () => {
    expect(caseOf('KYC-260901-900007').claimedBy?.userId).toBe(ALI.userId)
    await users.changeAssignment(ALI.userId, aliAssignment('PRJ-0001').assignmentId, { roleId: VIEWER, scope: only('PRJ-0001') }, OWNER)
    expect(caseOf('KYC-260901-900007').claimedBy).toBeUndefined()
    expect(await lastAudit('USER_ACCESS_CHANGED')).toMatchObject({ projectId: 'PRJ-0001', details: { changes: [{ from: 'Reviewer · Default', to: 'Viewer · Default' }] } })
    expect(await lastAudit('CASE_RELEASED')).toMatchObject({ referenceNo: expect.stringMatching(/^KYC-/), details: { reason: 'Access changed' } })
  })

  it('Given Siti is suspended, then her claims end, she can’t act, and she can be reactivated', async () => {
    expect(caseOf('KYC-260901-900009').claimedBy?.userId).toBe(SITI.userId)
    expect((await users.suspend(SITI.userId, OWNER)).status).toBe('SUSPENDED')
    expect(caseOf('KYC-260901-900009').claimedBy).toBeUndefined()
    expect(() => requireActive(SITI)).toThrow('Your account is inactive.')
    expect((await users.reactivate(SITI.userId, OWNER)).status).toBe('ACTIVE')
    expect((await lastAudit('USER_REACTIVATED')).details).toMatchObject({ userId: SITI.userId })
  })

  it('Given a Pending user, then the invitation can be resent; for an Active user it cannot', async () => {
    await users.resendInvitation('USR-2026-0035', OWNER)
    expect((await lastAudit('USER_INVITATION_RESENT')).details).toMatchObject({ email: 'peishan.chong@atoz.example' })
    await expect(users.resendInvitation(ALI.userId, OWNER)).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('Given a user desk role (Manage users and roles only), then they give only access they hold themselves', async () => {
    const desk = await roleService.create('MER-0001', { name: 'User desk', permissions: ['MANAGE_USERS_ROLES'] }, OWNER)
    await users.addAssignment(SITI.userId, { roleId: desk.roleId, scope: ALL }, OWNER)
    const invite = (scope: AssignmentScope, email: string) => users.invite('MER-0001', { fullName: 'New Reviewer', email, assignment: { roleId: REVIEWER, scope } }, SITI)
    expect((await invite(only('PRJ-0001'), 'r1@atoz.example')).access[0].label).toBe('Reviewer · Default') // Siti is Reviewer there
    await expect(invite(only('PRJ-0002'), 'r2@atoz.example')).rejects.toMatchObject({ code: 'FORBIDDEN', message: GRANT_TOO_POWERFUL })
  })

  it('Given Hafiz on SME app, then only roles he may give there are offered; the owner gets every role', async () => {
    expect((await roleService.assignable('MER-0001', HAFIZ, 'PRJ-0002')).map((r) => r.name)).toEqual(['Project Admin', 'Reviewer', 'Viewer'])
    await expect(roleService.assignable('MER-0001', HAFIZ, 'PRJ-0001')).resolves.toEqual([])
    expect((await roleService.assignable('MER-0001', OWNER)).map((r) => r.name)).toEqual(['Merchant Owner', 'Project Admin', 'Reviewer', 'Viewer'])
  })

  it('Given a user desk role, then roles it can’t give anywhere are not offered', async () => {
    const desk = await roleService.create('MER-0001', { name: 'User desk', permissions: ['MANAGE_USERS_ROLES'] }, OWNER)
    await users.addAssignment(SITI.userId, { roleId: desk.roleId, scope: ALL }, OWNER)
    // Siti is a Reviewer in Default only: she can give Reviewer or Viewer there, and her own User desk role; nothing broader.
    expect((await roleService.assignable('MER-0001', SITI)).map((r) => r.name)).toEqual(['Reviewer', 'Viewer', 'User desk'])
  })

  it('Given an archived project, then its access is labelled and read-only', async () => {
    // Ng Chee Keong owns MER-0005, whose Pilot 2025 (PRJ-0008) is archived.
    await users.invite('MER-0005', { fullName: 'Pilot Reviewer', email: 'pilot@3nova.example', assignment: { roleId: REVIEWER, scope: only('PRJ-0007') } }, ADMIN)
    const id = account((await users.list(ADMIN, 'MER-0005')).find((r) => r.fullName === 'Pilot Reviewer')!.userId)
    db.setState((st) => ({ accounts: st.accounts.map((a) => (a.userId === id.userId ? { ...a, assignments: [{ ...a.assignments[0], scope: only('PRJ-0008') }] } : a)) }))
    const d = await users.get(id.userId, ADMIN)
    expect(d.access).toEqual([{ label: 'Reviewer · Pilot 2025 (archived)', archived: true }])
    expect(d.assignments[0].editable).toBe(false)
  })

  it('Given a user from another merchant, then "not found"', async () => {
    await expect(users.get(KAVITHA.userId, OWNER)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('userAdminService: a project’s Members tab (DEC-77)', () => {
  it('Given SME app, then its members include the Merchant Owner as inherited, not removable there', async () => {
    const rows = await users.listMembers('PRJ-0002', HAFIZ)
    expect(rows.map((r) => r.userId)).toEqual(expect.arrayContaining([OWNER.userId, HAFIZ.userId, ALI.userId, 'USR-2026-0033']))
    expect(rows.find((r) => r.userId === OWNER.userId)!.roles).toEqual([expect.objectContaining({ roleName: 'Merchant Owner', inherited: true, removable: false })])
    expect(rows.find((r) => r.userId === ALI.userId)!.roles).toEqual([expect.objectContaining({ roleName: 'Viewer', inherited: false, removable: true })])
    expect(rows.some((r) => r.userId === SITI.userId)).toBe(false)
  })

  it('Given Hafiz (Project Admin of SME app), then he adds Siti there, but not in Default, and not as Merchant Owner', async () => {
    expect((await users.addMember('PRJ-0002', SITI.userId, REVIEWER, HAFIZ)).find((r) => r.userId === SITI.userId)!.roles[0].roleName).toBe('Reviewer')
    expect(mayInProject(SITI, 'claimCase', 'PRJ-0002')).toBe(true)
    expect(await lastAudit('USER_ACCESS_ADDED')).toMatchObject({ projectId: 'PRJ-0002', actorRole: 'Project Admin' })
    await expect(users.listMembers('PRJ-0001', HAFIZ)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(users.addMember('PRJ-0002', 'USR-2026-0035', MERCHANT_OWNER, HAFIZ)).rejects.toMatchObject({ message: MERCHANT_LEVEL_SCOPE })
  })

  it('Given an assignment for two projects, when removed from one on its Members tab, then it stays for the other', async () => {
    const d = await users.addAssignment('USR-2026-0035', { roleId: VIEWER, scope: only('PRJ-0001', 'PRJ-0002') }, OWNER)
    const id = d.assignments.at(-1)!.assignmentId
    await users.removeMember('PRJ-0002', 'USR-2026-0035', id, HAFIZ)
    expect(account('USR-2026-0035').assignments.find((x) => x.assignmentId === id)!.scope).toEqual(only('PRJ-0001'))
  })

  it('Given an archived project, then it takes no new members', async () => {
    await expect(users.addMember('PRJ-0008', 'USR-2026-0071', VIEWER, ADMIN)).rejects.toMatchObject({ code: 'VALIDATION' })
  })
})

describe('roleService: the Roles screen (DEC-76)', () => {
  it('Given the Merchant Owner, then System Default roles first and only their merchant’s Custom roles, with user counts', async () => {
    const rows = await roleService.list(OWNER)
    expect(rows.map((r) => r.name)).toEqual(['Merchant Owner', 'Project Admin', 'Reviewer', 'Viewer'])
    expect(rows.find((r) => r.name === 'Reviewer')!.users).toBe(4) // Ali, Siti, Nurul, Yap (suspended still holds it)
    const all = await roleService.list(ADMIN)
    expect(all.find((r) => r.name === 'Compliance Auditor')).toMatchObject({ type: 'CUSTOM', merchantName: 'Vantage', users: 1 })
  })

  it('Given a new role, then at least one permission; Claim ticks View cases; audited', async () => {
    await expect(roleService.create('MER-0001', { name: 'Empty', permissions: [] }, OWNER)).rejects.toMatchObject({ message: ROLE_NEEDS_PERMISSION })
    const r = await roleService.create('MER-0001', { name: 'Claimer', permissions: ['CLAIM_CASES'] }, OWNER)
    expect(r).toMatchObject({ roleId: 'ROL-2026-0006', type: 'CUSTOM', permissions: ['VIEW_CASES', 'CLAIM_CASES'] })
    expect(await lastAudit('ROLE_CREATED')).toMatchObject({ merchantId: 'MER-0001', actorRole: 'Merchant Owner' })
    await expect(roleService.create('MER-0001', { name: 'Mine', permissions: ['VIEW_CASES'] }, ALI)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('Given a System Default role, then it cannot be edited', async () => {
    await expect(roleService.update(REVIEWER, { name: 'Reviewer', permissions: ['VIEW_CASES'] }, OWNER)).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('Given the Compliance Auditor loses View audit log, then Kavitha loses it at once (role edits apply to every holder)', async () => {
    expect(mayInProject(KAVITHA, 'viewAudit', 'PRJ-0003')).toBe(true)
    await roleService.update('ROL-2026-0005', { name: 'Compliance Auditor', permissions: ['VIEW_CASES', 'VIEW_PROJECT_REPORTS'] }, VANTAGE_OWNER)
    expect(mayInProject(KAVITHA, 'viewAudit', 'PRJ-0003')).toBe(false)
    expect(await lastAudit('ROLE_UPDATED')).toMatchObject({ details: { users: 1, changes: [{ to: 'View cases, View project reports' }] } })
  })

  it('Given a role still assigned, then it cannot be deactivated; once unassigned it can', async () => {
    await expect(roleService.setStatus('ROL-2026-0005', 'INACTIVE', VANTAGE_OWNER)).rejects.toMatchObject({ message: ROLE_IN_USE })
    const r = await roleService.create('MER-0001', { name: 'Spare', permissions: ['VIEW_CASES'] }, OWNER)
    expect((await roleService.setStatus(r.roleId, 'INACTIVE', OWNER)).status).toBe('INACTIVE')
  })

  it('Given a Custom role held for selected projects, then a merchant-level permission can’t be added', async () => {
    const r = await roleService.create('MER-0001', { name: 'Desk', permissions: ['VIEW_CASES'] }, OWNER)
    await users.addAssignment(SITI.userId, { roleId: r.roleId, scope: only('PRJ-0001') }, OWNER)
    await expect(roleService.update(r.roleId, { name: 'Desk', permissions: ['VIEW_CASES', 'MANAGE_BILLING'] }, OWNER)).rejects.toMatchObject({ code: 'VALIDATION' })
  })
})

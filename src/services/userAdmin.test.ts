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
import { fx } from '@/lib/ids'

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
const VANTAGE_OWNER = { userId: fx('USR-2026-0045'), fullName: 'Ahmad Faiz Bin Zulkifli' }
const KAVITHA = { userId: fx('USR-2026-0044'), fullName: 'Kavitha A/P Subramaniam' }

describe('userAdminService: the Users screen (DEC-74)', () => {
  it('Given the Merchant Owner, then their merchant’s users, newest first, with the Access column; no Super admin', async () => {
    const rows = await users.list(OWNER)
    expect(rows.every((r) => r.merchantId === fx('MER-0001'))).toBe(true)
    expect(rows.map((r) => r.createdAt)).toEqual([...rows.map((r) => r.createdAt)].sort().reverse())
    expect(rows.find((r) => r.userId === ALI.userId)!.access.map((c) => c.label)).toEqual(['Reviewer · Default', 'Viewer · SME app'])
    expect(rows.find((r) => r.userId === OWNER.userId)!.access.map((c) => c.label)).toEqual(['Merchant Owner · All projects'])
    expect(rows.some((r) => r.userId === ADMIN.userId)).toBe(false)
  })

  it('Given Super admin, then every merchant’s users; given a Reviewer or a Project Admin, then forbidden', async () => {
    expect(new Set((await users.list(ADMIN)).map((r) => r.merchantId)).size).toBeGreaterThan(2)
    await expect(users.list(ALI)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(users.list(HAFIZ)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('Given an invitation, then the user is Pending with the first assignment, audited in that project', async () => {
    const row = await users.invite(fx('MER-0001'), { fullName: 'Aishah Binti Omar', email: 'Aishah@atoz.example', assignment: { roleId: REVIEWER, scope: only(fx('PRJ-0002')) } }, OWNER)
    expect(row).toMatchObject({ status: 'PENDING', email: 'aishah@atoz.example', access: [{ label: 'Reviewer · SME app', archived: false }] })
    expect(await lastAudit('USER_INVITED')).toMatchObject({ projectId: fx('PRJ-0002'), actorRole: 'Merchant Owner', details: { access: 'Reviewer · SME app' } })
    await expect(users.invite(fx('MER-0001'), { fullName: 'Aishah Again', email: 'aishah@atoz.example', assignment: { roleId: REVIEWER, scope: only(fx('PRJ-0002')) } }, OWNER)).rejects.toMatchObject({ code: 'VALIDATION', message: 'A user with this email already exists' })
  })

  it('Given the form’s drafted User ID, then the new user keeps it; a used one is never reused (DEC-97)', async () => {
    const id = await users.draftUserId(OWNER)
    expect(id).toMatch(/^usr_[a-z][a-z0-9]{23}$/)
    const row = await users.invite(fx('MER-0001'), { userId: id, fullName: 'Aishah Binti Omar', email: 'aishah@atoz.example', assignment: { roleId: REVIEWER, scope: only(fx('PRJ-0002')) } }, OWNER)
    expect(row.userId).toBe(id)
    const again = await users.invite(fx('MER-0001'), { userId: id, fullName: 'Second Person', email: 'second@atoz.example', assignment: { roleId: REVIEWER, scope: only(fx('PRJ-0002')) } }, OWNER)
    expect(again.userId).not.toBe(id)
    await expect(users.draftUserId(ALI)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('Given Merchant Owner for selected projects, then refused: merchant-level permissions need All projects', async () => {
    await expect(users.invite(fx('MER-0001'), { fullName: 'Aishah Binti Omar', email: 'aishah@atoz.example', assignment: { roleId: MERCHANT_OWNER, scope: only(fx('PRJ-0001')) } }, OWNER)).rejects.toMatchObject({ message: MERCHANT_LEVEL_SCOPE })
  })

  it('Given a second owner, then the first can be demoted; the last one cannot be removed or suspended', async () => {
    const owner = account(OWNER.userId).assignments[0]
    await expect(users.removeAssignment(OWNER.userId, owner.assignmentId, ADMIN)).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(users.suspend(OWNER.userId, ADMIN)).rejects.toMatchObject({ code: 'VALIDATION' })
    await users.addAssignment(SITI.userId, { roleId: MERCHANT_OWNER, scope: ALL }, ADMIN)
    const d = await users.changeAssignment(OWNER.userId, owner.assignmentId, { roleId: PROJECT_ADMIN, scope: ALL }, ADMIN)
    expect(d.access.map((c) => c.label)).toEqual(['Project Admin · All projects'])
  })

  it('Given Ali’s details, then Effective access shows each permission and the row it comes from, per project', async () => {
    const d = await users.get(ALI.userId, OWNER)
    const sme = d.effective.find((e) => e.projectId === fx('PRJ-0002'))!
    expect(sme.permissions).toEqual([
      { permission: 'VIEW_CASES', from: ['Viewer · SME app'] },
      { permission: 'VIEW_PROJECT_REPORTS', from: ['Viewer · SME app'] },
      { permission: 'EXPORT_PROJECT_REPORTS', from: ['Viewer · SME app'] },
    ])
    expect(d.effective.find((e) => e.projectId === fx('PRJ-0001'))!.permissions.find((p) => p.permission === 'CLAIM_CASES')!.from).toEqual(['Reviewer · Default'])
  })

  it('Given the only Merchant Owner, then Remove and Suspend are blocked with the reason before anyone clicks (DEC-78)', async () => {
    const d = await users.get(OWNER.userId, ADMIN)
    expect(d.assignments[0].removeBlocked).toBe('At least one Merchant Owner (All projects) is required.')
    expect(d.suspendBlocked).toBe('At least one Merchant Owner (All projects) is required.')
    expect((await users.get(ALI.userId, OWNER)).assignments.every((x) => !x.removeBlocked)).toBe(true)
  })

  it('Given anyone, then they cannot change their own access', async () => {
    await expect(users.addAssignment(OWNER.userId, { roleId: REVIEWER, scope: only(fx('PRJ-0001')) }, OWNER)).rejects.toThrow('You can’t change your own access.')
  })

  it('Given Ali becomes a Viewer in Default, then his claim there is released and the change is audited', async () => {
    expect(caseOf('KYC-260901-900007').claimedBy?.userId).toBe(ALI.userId)
    await users.changeAssignment(ALI.userId, aliAssignment(fx('PRJ-0001')).assignmentId, { roleId: VIEWER, scope: only(fx('PRJ-0001')) }, OWNER)
    expect(caseOf('KYC-260901-900007').claimedBy).toBeUndefined()
    expect(await lastAudit('USER_ACCESS_CHANGED')).toMatchObject({ projectId: fx('PRJ-0001'), details: { changes: [{ from: 'Reviewer · Default', to: 'Viewer · Default' }] } })
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
    await users.resendInvitation(fx('USR-2026-0035'), OWNER)
    expect((await lastAudit('USER_INVITATION_RESENT')).details).toMatchObject({ email: 'peishan.chong@atoz.example' })
    await expect(users.resendInvitation(ALI.userId, OWNER)).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('Given a user desk role (the Users permissions only), then they give only access they hold themselves', async () => {
    const desk = await roleService.create(fx('MER-0001'), { name: 'User desk', permissions: ['VIEW_USERS', 'INVITE_USERS', 'CHANGE_USER_ACCESS', 'SUSPEND_USERS'] }, OWNER)
    await users.addAssignment(SITI.userId, { roleId: desk.roleId, scope: ALL }, OWNER)
    const invite = (scope: AssignmentScope, email: string) => users.invite(fx('MER-0001'), { fullName: 'New Reviewer', email, assignment: { roleId: REVIEWER, scope } }, SITI)
    expect((await invite(only(fx('PRJ-0001')), 'r1@atoz.example')).access[0].label).toBe('Reviewer · Default') // Siti is Reviewer there
    await expect(invite(only(fx('PRJ-0002')), 'r2@atoz.example')).rejects.toMatchObject({ code: 'FORBIDDEN', message: GRANT_TOO_POWERFUL })
  })

  it('Given Hafiz on SME app, then only roles he may give there are offered; the owner gets every role', async () => {
    expect((await roleService.assignable(fx('MER-0001'), HAFIZ, fx('PRJ-0002'))).map((r) => r.name)).toEqual(['Project Admin', 'Reviewer', 'Viewer', 'Fraud Analyst'])
    await expect(roleService.assignable(fx('MER-0001'), HAFIZ, fx('PRJ-0001'))).resolves.toEqual([])
    expect((await roleService.assignable(fx('MER-0001'), OWNER)).map((r) => r.name)).toEqual(['Merchant Owner', 'Project Admin', 'Reviewer', 'Viewer', 'Fraud Analyst'])
  })

  it('Given a user desk role, then roles it can’t give anywhere are not offered', async () => {
    const desk = await roleService.create(fx('MER-0001'), { name: 'User desk', permissions: ['VIEW_USERS', 'INVITE_USERS', 'CHANGE_USER_ACCESS', 'SUSPEND_USERS'] }, OWNER)
    await users.addAssignment(SITI.userId, { roleId: desk.roleId, scope: ALL }, OWNER)
    // Siti is a Reviewer in Default only: she can give Reviewer or Viewer there, and her own User desk role; nothing broader.
    expect((await roleService.assignable(fx('MER-0001'), SITI)).map((r) => r.name)).toEqual(['Reviewer', 'Viewer', 'User desk'])
  })

  it('Given an archived project, then its access is labelled and read-only', async () => {
    // Ng Chee Keong owns MER-0005, whose Pilot 2025 (PRJ-0008) is archived.
    await users.invite(fx('MER-0005'), { fullName: 'Pilot Reviewer', email: 'pilot@3nova.example', assignment: { roleId: REVIEWER, scope: only(fx('PRJ-0007')) } }, ADMIN)
    const id = account((await users.list(ADMIN, fx('MER-0005'))).find((r) => r.fullName === 'Pilot Reviewer')!.userId)
    db.setState((st) => ({ accounts: st.accounts.map((a) => (a.userId === id.userId ? { ...a, assignments: [{ ...a.assignments[0], scope: only(fx('PRJ-0008')) }] } : a)) }))
    const d = await users.get(id.userId, ADMIN)
    expect(d.access).toEqual([{ label: 'Reviewer · Pilot 2025 (archived)', archived: true }])
    expect(d.assignments[0].editable).toBe(false)
  })

  it('Given a user from another merchant, then "not found"', async () => {
    await expect(users.get(KAVITHA.userId, OWNER)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('Users and Roles: one permission per action (DEC-102)', () => {
  it('Given a role with View users and Invite only, then Siti invites but can’t suspend or change access; the detail says so', async () => {
    const desk = await roleService.create(fx('MER-0001'), { name: 'Invite desk', permissions: ['INVITE_USERS'] }, OWNER)
    expect(desk.permissions).toEqual(['VIEW_USERS', 'INVITE_USERS']) // the View comes with it
    await users.addAssignment(SITI.userId, { roleId: desk.roleId, scope: ALL }, OWNER)
    await users.invite(fx('MER-0001'), { fullName: 'New Viewer', email: 'nv@atoz.example', assignment: { roleId: VIEWER, scope: only(fx('PRJ-0001')) } }, SITI)
    await expect(users.suspend(ALI.userId, SITI)).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'You do not have permission to suspend or reactivate users.' })
    const ali = await users.get(ALI.userId, SITI)
    expect(ali.can).toEqual({ changeAccess: false, resendInvitation: true, suspend: false })
    await expect(users.addAssignment(ALI.userId, { roleId: VIEWER, scope: only(fx('PRJ-0001')) }, SITI)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('Given a role with View roles only, then the Roles list opens but creating, editing and deactivating are refused', async () => {
    const look = await roleService.create(fx('MER-0001'), { name: 'Role viewer', permissions: ['VIEW_ROLES'] }, OWNER)
    await users.addAssignment(SITI.userId, { roleId: look.roleId, scope: ALL }, OWNER)
    expect((await roleService.list(SITI)).length).toBeGreaterThan(0)
    await expect(roleService.create(fx('MER-0001'), { name: 'Nope', permissions: ['VIEW_CASES'] }, SITI)).rejects.toMatchObject({ message: 'You do not have permission to create roles.' })
    await expect(roleService.update(look.roleId, { name: 'Renamed', permissions: ['VIEW_ROLES'] }, SITI)).rejects.toMatchObject({ message: 'You do not have permission to edit roles.' })
    await expect(roleService.setStatus(look.roleId, 'INACTIVE', SITI)).rejects.toMatchObject({ message: 'You do not have permission to activate or deactivate roles.' })
  })
})

describe('userAdminService: a project’s Members tab (DEC-77)', () => {
  it('Given SME app, then its members include the Merchant Owner as inherited, not removable there', async () => {
    const rows = await users.listMembers(fx('PRJ-0002'), HAFIZ)
    expect(rows.map((r) => r.userId)).toEqual(expect.arrayContaining([OWNER.userId, HAFIZ.userId, ALI.userId, fx('USR-2026-0033')]))
    expect(rows.find((r) => r.userId === OWNER.userId)!.roles).toEqual([expect.objectContaining({ roleName: 'Merchant Owner', inherited: true, removable: false })])
    expect(rows.find((r) => r.userId === ALI.userId)!.roles).toEqual([expect.objectContaining({ roleName: 'Viewer', inherited: false, removable: true })])
    expect(rows.some((r) => r.userId === SITI.userId)).toBe(false)
  })

  it('Given Hafiz (Project Admin of SME app), then he adds Siti there, but not in Default, and not as Merchant Owner', async () => {
    expect((await users.addMember(fx('PRJ-0002'), SITI.userId, REVIEWER, HAFIZ)).find((r) => r.userId === SITI.userId)!.roles[0].roleName).toBe('Reviewer')
    expect(mayInProject(SITI, 'claimCase', fx('PRJ-0002'))).toBe(true)
    expect(await lastAudit('USER_ACCESS_ADDED')).toMatchObject({ projectId: fx('PRJ-0002'), actorRole: 'Project Admin' })
    await expect(users.listMembers(fx('PRJ-0001'), HAFIZ)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(users.addMember(fx('PRJ-0002'), fx('USR-2026-0035'), MERCHANT_OWNER, HAFIZ)).rejects.toMatchObject({ message: MERCHANT_LEVEL_SCOPE })
  })

  it('Given an assignment for two projects, when removed from one on its Members tab, then it stays for the other', async () => {
    const d = await users.addAssignment(fx('USR-2026-0035'), { roleId: VIEWER, scope: only(fx('PRJ-0001'), fx('PRJ-0002')) }, OWNER)
    const id = d.assignments.at(-1)!.assignmentId
    await users.removeMember(fx('PRJ-0002'), fx('USR-2026-0035'), id, HAFIZ)
    expect(account(fx('USR-2026-0035')).assignments.find((x) => x.assignmentId === id)!.scope).toEqual(only(fx('PRJ-0001')))
  })

  it('Given an archived project, then it takes no new members', async () => {
    await expect(users.addMember(fx('PRJ-0008'), fx('USR-2026-0071'), VIEWER, ADMIN)).rejects.toMatchObject({ code: 'VALIDATION' })
  })
})

describe('roleService: the Roles screen (DEC-76)', () => {
  it('Given the Merchant Owner, then System Default roles first and only their merchant’s Custom roles, with user counts', async () => {
    const rows = await roleService.list(OWNER)
    expect(rows.map((r) => r.name)).toEqual(['Merchant Owner', 'Project Admin', 'Reviewer', 'Viewer', 'Fraud Analyst'])
    expect(rows.find((r) => r.name === 'Fraud Analyst')!.users).toBe(0)
    expect(rows.find((r) => r.name === 'Reviewer')!.users).toBe(4) // Ali, Siti, Nurul, Yap (suspended still holds it)
    const all = await roleService.list(ADMIN)
    expect(all.find((r) => r.name === 'Compliance Auditor')).toMatchObject({ type: 'CUSTOM', merchantName: 'Vantage', users: 1, projects: 1 })
    expect(rows.find((r) => r.name === 'Reviewer')!.projects).toBe(2) // Default and SME app
  })

  it('Given a new role, then at least one permission; Claim ticks View cases; audited', async () => {
    await expect(roleService.create(fx('MER-0001'), { name: 'Empty', permissions: [] }, OWNER)).rejects.toMatchObject({ message: ROLE_NEEDS_PERMISSION })
    const r = await roleService.create(fx('MER-0001'), { name: 'Claimer', permissions: ['CLAIM_CASES'] }, OWNER)
    expect(r).toMatchObject({ roleId: expect.stringMatching(/^rol_/), type: 'CUSTOM', status: 'ACTIVE', permissions: ['VIEW_CASES', 'CLAIM_CASES'] })
    expect(await lastAudit('ROLE_CREATED')).toMatchObject({ merchantId: fx('MER-0001'), actorRole: 'Merchant Owner' })
    await expect(roleService.create(fx('MER-0001'), { name: 'Mine', permissions: ['VIEW_CASES'] }, ALI)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('Given the dialog’s drafted Role ID, then the new role keeps it; it can start Inactive (DEC-76)', async () => {
    const id = await roleService.draftRoleId(OWNER)
    expect(id).toMatch(/^rol_[a-z][a-z0-9]{23}$/)
    const r = await roleService.create(fx('MER-0001'), { roleId: id, name: 'Night shift', permissions: ['VIEW_CASES'], status: 'INACTIVE' }, OWNER)
    expect(r).toMatchObject({ roleId: id, status: 'INACTIVE' })
    expect((await roleService.assignable(fx('MER-0001'), OWNER)).some((x) => x.roleId === id)).toBe(false) // inactive: can't be given
    const again = await roleService.create(fx('MER-0001'), { roleId: id, name: 'Night shift 2', permissions: ['VIEW_CASES'] }, OWNER)
    expect(again.roleId).not.toBe(id) // an ID already used is never reused
    await expect(roleService.draftRoleId(ALI)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('Given Fraud Analyst (nobody holds it), then it can be deactivated and activated again', async () => {
    const id = fx('ROL-2026-0006')
    expect((await roleService.setStatus(id, 'INACTIVE', OWNER)).status).toBe('INACTIVE')
    expect((await roleService.setStatus(id, 'ACTIVE', OWNER)).status).toBe('ACTIVE')
  })

  it('Given a System Default role, then it cannot be edited', async () => {
    await expect(roleService.update(REVIEWER, { name: 'Reviewer', permissions: ['VIEW_CASES'] }, OWNER)).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('Given the Compliance Auditor loses View audit log, then Kavitha loses it at once (role edits apply to every holder)', async () => {
    expect(mayInProject(KAVITHA, 'viewAudit', fx('PRJ-0003'))).toBe(true)
    await roleService.update(fx('ROL-2026-0005'), { name: 'Compliance Auditor', permissions: ['VIEW_CASES', 'VIEW_PROJECT_REPORTS'] }, VANTAGE_OWNER)
    expect(mayInProject(KAVITHA, 'viewAudit', fx('PRJ-0003'))).toBe(false)
    expect(await lastAudit('ROLE_UPDATED')).toMatchObject({ details: { users: 1, changes: [{ to: 'View cases, View project reports' }] } })
  })

  it('Given a role still assigned, then it cannot be deactivated; once unassigned it can', async () => {
    await expect(roleService.setStatus(fx('ROL-2026-0005'), 'INACTIVE', VANTAGE_OWNER)).rejects.toMatchObject({ message: ROLE_IN_USE })
    const r = await roleService.create(fx('MER-0001'), { name: 'Spare', permissions: ['VIEW_CASES'] }, OWNER)
    expect((await roleService.setStatus(r.roleId, 'INACTIVE', OWNER)).status).toBe('INACTIVE')
  })

  it('Given a Custom role held for selected projects, then a merchant-level permission can’t be added', async () => {
    const r = await roleService.create(fx('MER-0001'), { name: 'Desk', permissions: ['VIEW_CASES'] }, OWNER)
    await users.addAssignment(SITI.userId, { roleId: r.roleId, scope: only(fx('PRJ-0001')) }, OWNER)
    await expect(roleService.update(r.roleId, { name: 'Desk', permissions: ['VIEW_CASES', 'MANAGE_BILLING'] }, OWNER)).rejects.toMatchObject({ code: 'VALIDATION' })
  })
})

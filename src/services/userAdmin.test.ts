// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GRANT_TOO_POWERFUL, LAST_OWNER, MERCHANT_LEVEL_SCOPE, OTHER_PROJECT_ROLE, PROJECT_ROLE_ON_USERS, ROLE_IN_USE, ROLE_NEEDS_PERMISSION, SYSTEM_ROLE_IDS } from '@/domain/roles'
import type { AuditAction } from '@/domain/types'
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

const { OWNER: OWNER_ROLE, ADMIN: ADMIN_ROLE, AUDITOR, MEMBER, REVIEWER, VIEWER } = SYSTEM_ROLE_IDS
const FRAUD_CHECKER = fx('ROL-2026-0021') // Custom project role of Default
const account = (userId: string) => db.state().accounts.find((a) => a.userId === userId)!
const caseOf = (ref: string) => db.state().verifications.find((v) => v.referenceId === ref)!
const lastAudit = async (action: AuditAction) => (await auditService.list({ actions: [action] }, ADMIN)).items[0]
const projectRole = (userId: string, projectId: string) => account(userId).assignments.find((x) => x.scope.kind === 'PROJECTS' && x.scope.projectIds.includes(projectId))!
const KAVITHA = { userId: fx('USR-2026-0044'), fullName: 'Kavitha A/P Subramaniam' }
const JIAHUI = { userId: fx('USR-2026-0036'), fullName: 'Lee Jia Hui' } // Admin, Atoz
const USER_DESK = ['VIEW_USERS', 'INVITE_USERS', 'CHANGE_USER_ROLE', 'SUSPEND_USERS'] as const

describe('userAdminService: the Users screen (DEC-74, DEC-104)', () => {
  it('Given the Owner, then their merchant’s users, newest first: the merchant role first, then project roles; no Super admin', async () => {
    const rows = await users.list(OWNER)
    expect(rows.every((r) => r.merchantId === fx('MER-0001'))).toBe(true)
    expect(rows.map((r) => r.createdAt)).toEqual([...rows.map((r) => r.createdAt)].sort().reverse())
    expect(rows.find((r) => r.userId === ALI.userId)!.merchantRoleName).toBe('Member') // project roles are in the details
    expect(rows.find((r) => r.userId === OWNER.userId)!.merchantRoleName).toBe('Owner')
    expect(rows.find((r) => r.userId === JIAHUI.userId)!.merchantRoleName).toBe('Admin')
    expect(rows.some((r) => r.userId === ADMIN.userId)).toBe(false)
  })

  it('Given Super admin, then every merchant’s users; given a Reviewer or a Project Admin, then forbidden', async () => {
    expect(new Set((await users.list(ADMIN)).map((r) => r.merchantId)).size).toBeGreaterThan(2)
    await expect(users.list(ALI)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(users.list(HAFIZ)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('Given an invitation without a role, then the user is Pending as Member (no access until added to a project), audited', async () => {
    const row = await users.invite(fx('MER-0001'), { fullName: 'Aishah Binti Omar', email: 'Aishah@atoz.example' }, OWNER)
    expect(row).toMatchObject({ status: 'PENDING', email: 'aishah@atoz.example', merchantRoleName: 'Member' })
    expect(await lastAudit('USER_INVITED')).toMatchObject({ actorRole: 'Owner', details: { access: 'Member' } })
    expect(mayInProject({ userId: row.userId }, 'viewCases', fx('PRJ-0001'))).toBe(false)
    await expect(users.invite(fx('MER-0001'), { fullName: 'Aishah Again', email: 'aishah@atoz.example' }, OWNER)).rejects.toMatchObject({ code: 'VALIDATION', message: 'A user with this email already exists' })
  })

  it('Given New user, then merchant roles only: a project role is refused; Auditor applies in all projects (DEC-104)', async () => {
    await expect(users.invite(fx('MER-0001'), { fullName: 'Wide Reviewer', email: 'wide@atoz.example', roleId: REVIEWER }, OWNER)).rejects.toMatchObject({ message: PROJECT_ROLE_ON_USERS })
    const row = await users.invite(fx('MER-0001'), { fullName: 'New Auditor', email: 'auditor@atoz.example', roleId: AUDITOR }, OWNER)
    expect(row.merchantRoleName).toBe('Auditor')
    for (const p of [fx('PRJ-0001'), fx('PRJ-0002')]) {
      expect(mayInProject({ userId: row.userId }, 'viewCases', p)).toBe(true)
      expect(mayInProject({ userId: row.userId }, 'viewCaseDetails', p)).toBe(false)
    }
  })

  it('Given Grace (Auditor + Viewer in SME app), then the case list everywhere and case pages in SME app only (DEC-104)', async () => {
    const grace = { userId: fx('USR-2026-0021') }
    expect(mayInProject(grace, 'viewCases', fx('PRJ-0001'))).toBe(true)
    expect(mayInProject(grace, 'viewCaseDetails', fx('PRJ-0001'))).toBe(false)
    expect(mayInProject(grace, 'viewCaseDetails', fx('PRJ-0002'))).toBe(true)
    const detail = await users.get(grace.userId, OWNER)
    expect(detail.merchantRoleName).toBe('Auditor')
    expect(detail.projectRoles.map((r) => `${r.roleName} · ${r.projectName}`)).toEqual(['Viewer · SME app'])
  })

  it('Given the form’s drafted User ID, then the new user keeps it; a used one is never reused (DEC-97)', async () => {
    const id = await users.draftUserId(OWNER)
    expect(id).toMatch(/^usr_[a-z][a-z0-9]{23}$/)
    const row = await users.invite(fx('MER-0001'), { userId: id, fullName: 'Aishah Binti Omar', email: 'aishah@atoz.example' }, OWNER)
    expect(row.userId).toBe(id)
    const again = await users.invite(fx('MER-0001'), { userId: id, fullName: 'Second Person', email: 'second@atoz.example' }, OWNER)
    expect(again.userId).not.toBe(id)
    await expect(users.draftUserId(ALI)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('Given the only Owner, then Change role and Suspend are blocked with the reason; with a second Owner the first can become Admin', async () => {
    const d = await users.get(OWNER.userId, ADMIN)
    expect(d.changeRoleBlocked).toBe(LAST_OWNER)
    expect(d.suspendBlocked).toBe(LAST_OWNER)
    await expect(users.setRole(OWNER.userId, ADMIN_ROLE, ADMIN)).rejects.toMatchObject({ code: 'VALIDATION', message: LAST_OWNER })
    await expect(users.suspend(OWNER.userId, ADMIN)).rejects.toMatchObject({ code: 'VALIDATION' })
    await users.setRole(JIAHUI.userId, OWNER_ROLE, ADMIN)
    const after = await users.setRole(OWNER.userId, ADMIN_ROLE, ADMIN)
    expect(after.merchantRole).toEqual({ roleId: ADMIN_ROLE, roleName: 'Admin' })
    expect(await lastAudit('USER_ACCESS_CHANGED')).toMatchObject({ details: { changes: [{ from: 'Owner', to: 'Admin' }] } })
  })

  it('Given Ali’s details, then his merchant role, his project roles (from Members) and Effective access per project', async () => {
    const d = await users.get(ALI.userId, OWNER)
    expect(d.merchantRole).toEqual({ roleId: MEMBER, roleName: 'Member' })
    expect(d.projectRoles.map((r) => `${r.roleName} · ${r.projectName}`)).toEqual(['Reviewer · Default', 'Viewer · SME app'])
    const sme = d.effective.find((e) => e.projectId === fx('PRJ-0002'))!
    expect(sme.permissions.map((p) => p.permission)).toEqual(['VIEW_CASE_LIST', 'VIEW_CASE_DETAILS', 'VIEW_FLOWS', 'VIEW_PROJECT_REPORTS', 'EXPORT_PROJECT_REPORTS'])
    expect(sme.permissions.every((p) => p.from.join() === 'Viewer · SME app')).toBe(true)
    expect(d.effective.find((e) => e.projectId === fx('PRJ-0001'))!.permissions.find((p) => p.permission === 'CLAIM_CASES')!.from).toEqual(['Reviewer · Default'])
  })

  it('Given anyone, then they cannot change their own role', async () => {
    await expect(users.setRole(OWNER.userId, REVIEWER, OWNER)).rejects.toThrow('You can’t change your own access.')
    expect((await users.get(OWNER.userId, OWNER)).can.changeRole).toBe(false)
  })

  it('Given Ali’s Reviewer role in Default is removed in Members, then his claim there is released and the change is audited', async () => {
    expect(caseOf('KYC-260901-900007').claimedBy?.userId).toBe(ALI.userId)
    await users.removeMember(fx('PRJ-0001'), ALI.userId, projectRole(ALI.userId, fx('PRJ-0001')).assignmentId, OWNER)
    expect(caseOf('KYC-260901-900007').claimedBy).toBeUndefined()
    expect(await lastAudit('USER_ACCESS_REMOVED')).toMatchObject({ projectId: fx('PRJ-0001'), details: { changes: [{ from: 'Reviewer · Default', to: 'Removed' }] } })
    expect(await lastAudit('CASE_RELEASED')).toMatchObject({ details: { reason: 'Access removed' } })
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

  it('Given a user desk merchant role, then its holder gives only roles they hold merchant-wide (DEC-74)', async () => {
    const desk = await roleService.create(fx('MER-0001'), { name: 'User desk', permissions: [...USER_DESK] }, OWNER)
    await users.setRole(SITI.userId, desk.roleId, OWNER)
    // Siti reviews in Default only (a project role), so she can't give the Auditor's case list for the whole merchant.
    await expect(users.invite(fx('MER-0001'), { fullName: 'New Auditor', email: 'r1@atoz.example', roleId: AUDITOR }, SITI)).rejects.toMatchObject({ code: 'FORBIDDEN', message: GRANT_TOO_POWERFUL })
    expect((await users.invite(fx('MER-0001'), { fullName: 'New Member', email: 'm1@atoz.example' }, SITI)).merchantRoleName).toBe('Member')
    expect((await roleService.assignable(fx('MER-0001'), SITI)).map((r) => r.name)).toEqual(['Member', 'User desk'])
  })

  it('Given the role pickers, then New user / Change role offer merchant roles; Members offers that project’s roles (DEC-104)', async () => {
    expect((await roleService.assignable(fx('MER-0001'), OWNER)).map((r) => r.name)).toEqual(['Owner', 'Admin', 'Billing', 'Auditor', 'Member', 'User Coordinator'])
    expect((await roleService.assignable(fx('MER-0001'), HAFIZ, fx('PRJ-0002'))).map((r) => r.name)).toEqual(['Project Admin', 'Reviewer', 'Developer', 'Viewer', 'Release Tester'])
    expect((await roleService.assignable(fx('MER-0001'), OWNER, fx('PRJ-0001'))).map((r) => r.name)).toEqual(['Project Admin', 'Reviewer', 'Developer', 'Viewer', 'Fraud Checker'])
    await expect(roleService.assignable(fx('MER-0001'), HAFIZ, fx('PRJ-0001'))).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('Given a user from another merchant, then "not found"', async () => {
    await expect(users.get(KAVITHA.userId, OWNER)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('Users and Roles: one permission per action (DEC-102)', () => {
  it('Given a merchant role with Invite only, then Siti invites but can’t suspend or change roles; the detail says so', async () => {
    const desk = await roleService.create(fx('MER-0001'), { name: 'Invite desk', permissions: ['INVITE_USERS'] }, OWNER)
    expect(desk.permissions).toEqual(['VIEW_USERS', 'INVITE_USERS']) // the View comes with it
    await users.setRole(SITI.userId, desk.roleId, OWNER)
    await users.invite(fx('MER-0001'), { fullName: 'New Member', email: 'nm@atoz.example' }, SITI)
    await expect(users.suspend(ALI.userId, SITI)).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'You do not have permission to suspend or reactivate users.' })
    expect((await users.get(ALI.userId, SITI)).can).toEqual({ changeRole: false, resendInvitation: true, suspend: false })
    await expect(users.setRole(ALI.userId, VIEWER, SITI)).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'You do not have permission to change user roles.' })
  })

  it('Given a merchant role with View roles only, then the Roles list opens but creating, editing and deactivating are refused', async () => {
    const look = await roleService.create(fx('MER-0001'), { name: 'Role viewer', permissions: ['VIEW_ROLES'] }, OWNER)
    await users.setRole(SITI.userId, look.roleId, OWNER)
    expect((await roleService.list(SITI)).length).toBeGreaterThan(0)
    await expect(roleService.create(fx('MER-0001'), { name: 'Nope', permissions: ['VIEW_CASE_LIST'] }, SITI)).rejects.toMatchObject({ message: 'You do not have permission to create roles.' })
    await expect(roleService.update(look.roleId, { name: 'Renamed', permissions: ['VIEW_ROLES'] }, SITI)).rejects.toMatchObject({ message: 'You do not have permission to edit roles.' })
    await expect(roleService.setStatus(look.roleId, 'INACTIVE', SITI)).rejects.toMatchObject({ message: 'You do not have permission to activate or deactivate roles.' })
  })
})

describe('userAdminService: a project’s Members tab (DEC-77, DEC-104)', () => {
  it('Given SME app, then project roles (removable) and merchant roles that give something there (inherited); Members and Billing are not listed', async () => {
    const rows = await users.listMembers(fx('PRJ-0002'), HAFIZ)
    expect(rows.map((r) => r.userId)).toEqual(expect.arrayContaining([OWNER.userId, JIAHUI.userId, HAFIZ.userId, ALI.userId, fx('USR-2026-0033')]))
    expect(rows.find((r) => r.userId === OWNER.userId)!.roles).toEqual([expect.objectContaining({ roleName: 'Owner', inherited: true, removable: false })])
    expect(rows.find((r) => r.userId === ALI.userId)!.roles).toEqual([expect.objectContaining({ roleName: 'Viewer', inherited: false, removable: true })])
    expect(rows.some((r) => r.userId === SITI.userId)).toBe(false) // Member, with a role in Default only
    expect(rows.some((r) => r.userId === fx('USR-2026-0037'))).toBe(false) // Billing: merchant-wide only
  })

  it('Given Hafiz (Project Admin of SME app), then he adds Siti there; not in Default, not a merchant role, not another project’s role', async () => {
    expect((await users.addMember(fx('PRJ-0002'), SITI.userId, REVIEWER, HAFIZ)).find((r) => r.userId === SITI.userId)!.roles[0].roleName).toBe('Reviewer')
    expect(mayInProject(SITI, 'claimCase', fx('PRJ-0002'))).toBe(true)
    expect(await lastAudit('USER_ACCESS_ADDED')).toMatchObject({ projectId: fx('PRJ-0002'), actorRole: 'Project Admin' })
    await expect(users.listMembers(fx('PRJ-0001'), HAFIZ)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(users.addMember(fx('PRJ-0002'), fx('USR-2026-0035'), OWNER_ROLE, HAFIZ)).rejects.toMatchObject({ message: MERCHANT_LEVEL_SCOPE })
    await expect(users.addMember(fx('PRJ-0002'), fx('USR-2026-0035'), MEMBER, HAFIZ)).rejects.toMatchObject({ message: MERCHANT_LEVEL_SCOPE })
    await expect(users.addMember(fx('PRJ-0002'), fx('USR-2026-0035'), FRAUD_CHECKER, HAFIZ)).rejects.toMatchObject({ message: OTHER_PROJECT_ROLE })
  })

  it('Given a merchant role, then it can’t be removed in Members (it is changed on Users)', async () => {
    const owner = account(OWNER.userId).assignments[0]
    await expect(users.removeMember(fx('PRJ-0002'), OWNER.userId, owner.assignmentId, HAFIZ)).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('Given an archived project, then it takes no new members', async () => {
    await expect(users.addMember(fx('PRJ-0008'), fx('USR-2026-0071'), VIEWER, ADMIN)).rejects.toMatchObject({ code: 'VALIDATION' })
  })
})

describe('userAdminService.inviteMember: a new person from Project › Members (DEC-77, OQ-27)', () => {
  const NEW = { fullName: 'Farah Binti Ismail', email: ' Farah.Ismail@atoz.example ', roleId: REVIEWER }
  const AARON = { userId: fx('USR-2026-0022'), fullName: 'Aaron Teoh' } // User Coordinator: Users View + Invite, no project permissions

  it('Given Hafiz (Members › Add / remove in SME app, no Users permission), then the person becomes a Pending merchant user with Member, plus Reviewer in SME app only', async () => {
    const r = await users.inviteMember(fx('PRJ-0002'), NEW, HAFIZ)
    expect(r.existing).toBe(false)
    const a = account(r.userId)
    expect(a).toMatchObject({ email: 'farah.ismail@atoz.example', fullName: 'Farah Binti Ismail', merchantId: fx('MER-0001'), level: 'MERCHANT_USER', status: 'PENDING' })
    expect(a.assignments.map((x) => [x.roleId, x.scope])).toEqual([
      [MEMBER, { kind: 'ALL_PROJECTS' }],
      [REVIEWER, { kind: 'PROJECTS', projectIds: [fx('PRJ-0002')] }],
    ])
    expect(r.members.find((m) => m.userId === r.userId)).toMatchObject({ status: 'PENDING', roles: [expect.objectContaining({ roleName: 'Reviewer', inherited: false })] })
    // The Users screen shows them as Member, with the project access in the details.
    expect((await users.list(OWNER)).find((u) => u.userId === r.userId)).toMatchObject({ merchantRoleName: 'Member', status: 'PENDING' })
    expect((await users.get(r.userId, OWNER)).projectRoles).toEqual([expect.objectContaining({ projectId: fx('PRJ-0002'), roleName: 'Reviewer' })])
    expect(mayInProject({ userId: r.userId }, 'viewCases', fx('PRJ-0001'))).toBe(false) // nothing in Default
    expect(await lastAudit('USER_INVITED')).toMatchObject({ projectId: fx('PRJ-0002'), details: expect.objectContaining({ access: 'Member', fromProjectId: fx('PRJ-0002') }) })
    expect(await lastAudit('USER_ACCESS_ADDED')).toMatchObject({ projectId: fx('PRJ-0002'), details: expect.objectContaining({ userId: r.userId }) })
  })

  it('Given the email of a user of this merchant, then the project role is added to that user, no second account', async () => {
    const before = db.state().accounts.length
    const r = await users.inviteMember(fx('PRJ-0002'), { fullName: 'whatever', email: 'SITI.YUSOF@atoz.example', roleId: REVIEWER }, HAFIZ)
    expect(r).toMatchObject({ existing: true, userId: SITI.userId })
    expect(db.state().accounts).toHaveLength(before)
    expect(projectRole(SITI.userId, fx('PRJ-0002')).roleId).toBe(REVIEWER)
    await expect(users.inviteMember(fx('PRJ-0002'), { fullName: 'x', email: 'siti.yusof@atoz.example', roleId: REVIEWER }, HAFIZ)).rejects.toMatchObject({ message: 'Siti Aminah Binti Yusof is already Reviewer in this project.' })
  })

  it('Given another merchant’s user or a company staff email, then refused as on New user (one merchant per user)', async () => {
    await expect(users.inviteMember(fx('PRJ-0002'), { ...NEW, email: 'kavitha.s@vantage.example' }, HAFIZ)).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(users.inviteMember(fx('PRJ-0002'), { ...NEW, email: 'someone@ekyc-platform.example' }, HAFIZ)).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(users.inviteMember(fx('PRJ-0002'), { ...NEW, fullName: 'Fa' }, HAFIZ)).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('Given no Members › Add / remove and no Users › Invite (Ali, Viewer in SME app), then refused; Owner (both, merchant-wide) may in every project', async () => {
    await expect(users.inviteMember(fx('PRJ-0002'), NEW, ALI)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect((await users.inviteMember(fx('PRJ-0001'), NEW, OWNER)).existing).toBe(false)
    expect((await users.inviteMember(fx('PRJ-0002'), { ...NEW, email: 'farah.ismail@atoz.example' }, OWNER)).existing).toBe(true)
  })

  it('Given Aaron (Users › Invite only), then Members opens for him in every project, but he holds no project permissions, so no project role can be given (DEC-74)', async () => {
    expect((await users.listMembers(fx('PRJ-0001'), AARON)).length).toBeGreaterThan(0)
    expect(await roleService.assignable(fx('MER-0001'), AARON, fx('PRJ-0001'))).toEqual([])
    await expect(users.inviteMember(fx('PRJ-0001'), NEW, AARON)).rejects.toMatchObject({ code: 'FORBIDDEN', message: GRANT_TOO_POWERFUL })
    await expect(users.addMember(fx('PRJ-0001'), SITI.userId, REVIEWER, AARON)).rejects.toMatchObject({ code: 'FORBIDDEN' }) // existing users: Members › Add / remove only
    // REQ: DEC-77 — the email of an existing user: refused before any role check, with the reason.
    await expect(users.inviteMember(fx('PRJ-0001'), { ...NEW, email: 'siti.yusof@atoz.example' }, AARON)).rejects.toMatchObject({
      code: 'VALIDATION',
      details: [{ field: 'email', message: 'Already a user of this merchant. Adding an existing user to a project needs Members › Add / remove.' }],
    })
  })

  it('Given an archived project or a suspended user’s email, then refused', async () => {
    await expect(users.inviteMember(fx('PRJ-0008'), { ...NEW, roleId: VIEWER }, ADMIN)).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(users.inviteMember(fx('PRJ-0002'), { ...NEW, email: 'liwen.yap@atoz.example' }, HAFIZ)).rejects.toMatchObject({ message: 'Yap Li Wen is suspended. Reactivate them on the Users screen first.' })
  })
})

describe('roleService: the Roles screen (DEC-76, DEC-104)', () => {
  it('Given the Owner, then the merchant role table: System Default merchant roles first, then their Custom merchant roles, with user counts', async () => {
    const rows = await roleService.list(OWNER)
    expect(rows.map((r) => r.name)).toEqual(['Owner', 'Admin', 'Billing', 'Auditor', 'Member', 'User Coordinator'])
    expect(rows.find((r) => r.name === 'Member')!.users).toBe(8) // Ali, Hafiz, Siti, Nurul, Chong, Yap, Kenneth, Zainab
    await roleService.create(fx('MER-0001'), { name: 'Night shift', permissions: ['VIEW_CASE_LIST'] }, OWNER)
    expect((await roleService.list(OWNER)).at(-1)).toMatchObject({ name: 'Night shift', type: 'CUSTOM', level: 'MERCHANT', users: 0 })
  })

  it('Given a project, then its own role table: the System Default project roles and its Custom ones, with holders in that project', async () => {
    const def = await roleService.listProjectRoles(fx('PRJ-0001'), OWNER)
    expect(def.map((r) => r.name)).toEqual(['Project Admin', 'Reviewer', 'Developer', 'Viewer', 'Fraud Checker'])
    expect(def.find((r) => r.name === 'Reviewer')!.users).toBe(3) // Ali, Siti, Yap in Default
    expect((await roleService.listProjectRoles(fx('PRJ-0002'), OWNER)).map((r) => r.name)).toEqual(['Project Admin', 'Reviewer', 'Developer', 'Viewer', 'Release Tester'])
    await expect(roleService.listProjectRoles(fx('PRJ-0001'), ALI)).rejects.toMatchObject({ code: 'FORBIDDEN' }) // Reviewer: no Project roles View
  })

  it('Given Hafiz (Project Admin of SME app), then he creates a project role there, not in Default, and not with merchant-wide permissions', async () => {
    const r = await roleService.create(fx('MER-0001'), { name: 'Night reviewer', permissions: ['CLAIM_CASES'], projectId: fx('PRJ-0002') }, HAFIZ)
    expect(r).toMatchObject({ level: 'PROJECT', projectId: fx('PRJ-0002'), permissions: ['VIEW_CASE_LIST', 'VIEW_CASE_DETAILS', 'CLAIM_CASES'] })
    expect(await lastAudit('ROLE_CREATED')).toMatchObject({ projectId: fx('PRJ-0002'), actorRole: 'Project Admin' })
    await expect(roleService.create(fx('MER-0001'), { name: 'Elsewhere', permissions: ['VIEW_CASE_LIST'], projectId: fx('PRJ-0001') }, HAFIZ)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(roleService.create(fx('MER-0001'), { name: 'Billing desk', permissions: ['VIEW_BILLING'], projectId: fx('PRJ-0002') }, HAFIZ)).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(roleService.create(fx('MER-0001'), { name: 'Merchant role', permissions: ['VIEW_CASE_LIST'] }, HAFIZ)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('Given a new role, then at least one permission; Approve ticks Claim, View details and View list; audited', async () => {
    await expect(roleService.create(fx('MER-0001'), { name: 'Empty', permissions: [] }, OWNER)).rejects.toMatchObject({ message: ROLE_NEEDS_PERMISSION })
    const r = await roleService.create(fx('MER-0001'), { name: 'Decider', permissions: ['DECIDE_CASES'] }, OWNER)
    expect(r).toMatchObject({ roleId: expect.stringMatching(/^rol_/), type: 'CUSTOM', status: 'ACTIVE', permissions: ['VIEW_CASE_LIST', 'VIEW_CASE_DETAILS', 'CLAIM_CASES', 'DECIDE_CASES'] })
    expect(await lastAudit('ROLE_CREATED')).toMatchObject({ merchantId: fx('MER-0001'), actorRole: 'Owner' })
    await expect(roleService.create(fx('MER-0001'), { name: 'Mine', permissions: ['VIEW_CASE_LIST'] }, ALI)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('Given the dialog’s drafted Role ID, then the new role keeps it; it can start Inactive (DEC-76)', async () => {
    const id = await roleService.draftRoleId(OWNER)
    expect(id).toMatch(/^rol_[a-z][a-z0-9]{23}$/)
    const r = await roleService.create(fx('MER-0001'), { roleId: id, name: 'Night shift', permissions: ['VIEW_CASE_LIST'], status: 'INACTIVE' }, OWNER)
    expect(r).toMatchObject({ roleId: id, status: 'INACTIVE' })
    expect((await roleService.assignable(fx('MER-0001'), OWNER)).some((x) => x.roleId === id)).toBe(false) // inactive: can't be given
    const again = await roleService.create(fx('MER-0001'), { roleId: id, name: 'Night shift 2', permissions: ['VIEW_CASE_LIST'] }, OWNER)
    expect(again.roleId).not.toBe(id) // an ID already used is never reused
    await expect(roleService.draftRoleId(ALI)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('Given a Custom role nobody holds, then it can be deactivated and activated again', async () => {
    const id = (await roleService.create(fx('MER-0001'), { name: 'Spare', permissions: ['VIEW_CASE_LIST'] }, OWNER)).roleId
    expect((await roleService.setStatus(id, 'INACTIVE', OWNER)).status).toBe('INACTIVE')
    expect((await roleService.setStatus(id, 'ACTIVE', OWNER)).status).toBe('ACTIVE')
  })

  it('Given a System Default role, then it cannot be edited', async () => {
    await expect(roleService.update(REVIEWER, { name: 'Reviewer', permissions: ['VIEW_CASE_LIST'] }, OWNER)).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('Given a Custom role given to Siti in SME app loses View audit log, then she loses it at once; while held it can’t be deactivated', async () => {
    const id = (await roleService.create(fx('MER-0001'), { name: 'Fraud Analyst', permissions: ['VIEW_CASE_DETAILS', 'VIEW_AUDIT_LOG'], projectId: fx('PRJ-0002') }, OWNER)).roleId
    await users.addMember(fx('PRJ-0002'), SITI.userId, id, OWNER)
    expect(mayInProject(SITI, 'viewAudit', fx('PRJ-0002'))).toBe(true)
    await roleService.update(id, { name: 'Fraud Analyst', permissions: ['VIEW_CASE_LIST', 'VIEW_CASE_DETAILS'] }, OWNER)
    expect(mayInProject(SITI, 'viewAudit', fx('PRJ-0002'))).toBe(false)
    expect(await lastAudit('ROLE_UPDATED')).toMatchObject({ details: { users: 1, changes: [{ to: 'View the case list, View case details' }] } })
    await expect(roleService.setStatus(id, 'INACTIVE', OWNER)).rejects.toMatchObject({ message: ROLE_IN_USE })
  })

  it('Given a Custom project role, then a merchant-wide permission can’t be added', async () => {
    const r = await roleService.create(fx('MER-0001'), { name: 'Desk', permissions: ['VIEW_CASE_LIST'], projectId: fx('PRJ-0001') }, OWNER)
    await users.addMember(fx('PRJ-0001'), SITI.userId, r.roleId, OWNER)
    await expect(roleService.update(r.roleId, { name: 'Desk', permissions: ['VIEW_CASE_LIST', 'MANAGE_BILLING'] }, OWNER)).rejects.toMatchObject({ code: 'VALIDATION' })
  })
})

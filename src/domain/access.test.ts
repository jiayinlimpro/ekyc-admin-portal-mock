import { describe, expect, it } from 'vitest'
import { canInMerchant, canInProject, canOnPlatform, hasProject, PROJECT_ACTIONS, projectsWhere, roleNamesInProject, type ProjectAction } from './access'
import { PLATFORM_DEFAULT_ROLES, PLATFORM_ROLE_IDS, SYSTEM_DEFAULT_ROLES, SYSTEM_ROLE_IDS } from './roles'
import type { AssignmentScope, Grant, Permission, Project, UserAccess } from './types'
import { fx } from '@/lib/ids'

const project = (projectId: string, merchantId = fx('MER-0001')): Pick<Project, 'projectId' | 'merchantId'> => ({ projectId, merchantId })
const RETAIL = project(fx('PRJ-0001'))
const SME = project(fx('PRJ-0002'))
const OTHER_MERCHANT = project(fx('PRJ-0009'), fx('MER-0002'))

const ALL: AssignmentScope = { kind: 'ALL_PROJECTS' }
const only = (...projectIds: string[]): AssignmentScope => ({ kind: 'PROJECTS', projectIds })
const grant = (roleId: string, scope: AssignmentScope): Grant => {
  const r = SYSTEM_DEFAULT_ROLES.find((x) => x.roleId === roleId)!
  return { roleId, roleName: r.name, permissions: r.permissions, scope }
}
const custom = (name: string, permissions: Permission[], scope: AssignmentScope): Grant => ({ roleId: fx('ROL-2026-0100'), roleName: name, permissions, scope })
const member = (userId: string, ...grants: Grant[]): UserAccess => ({ userId, level: 'MERCHANT_USER', merchantId: fx('MER-0001'), grants })

const PLATFORM: UserAccess = { userId: fx('USR-2026-0001'), level: 'SUPER_ADMIN', grants: [] }
const OWNER = member(fx('USR-2026-0002'), grant(SYSTEM_ROLE_IDS.OWNER, ALL))
const PROJECT_ADMIN = member(fx('USR-2026-0003'), grant(SYSTEM_ROLE_IDS.PROJECT_ADMIN, only(fx('PRJ-0001'))))
// One user, different roles in different projects (DEC-70).
const REVIEWER = member(fx('USR-2026-0012'), grant(SYSTEM_ROLE_IDS.REVIEWER, only(fx('PRJ-0001'))), grant(SYSTEM_ROLE_IDS.VIEWER, only(fx('PRJ-0002'))))

const can = (u: UserAccess, a: ProjectAction, p = RETAIL) => canInProject(u, a, p)

describe('access: one permission per action (DEC-102)', () => {
  it('Given a role that may only invite users, then it sees and invites but neither changes access nor suspends', () => {
    const desk = member(fx('USR-2026-0040'), custom('Invite desk', ['VIEW_USERS', 'INVITE_USERS'], ALL))
    expect(canInMerchant(desk, 'viewUsers', fx('MER-0001'))).toBe(true)
    expect(canInMerchant(desk, 'inviteUsers', fx('MER-0001'))).toBe(true)
    expect(canInMerchant(desk, 'changeUserRole', fx('MER-0001'))).toBe(false)
    expect(canInMerchant(desk, 'suspendUsers', fx('MER-0001'))).toBe(false)
    expect(canInMerchant(desk, 'viewRoles', fx('MER-0001'))).toBe(false)
  })

  it('Given flow permissions split, then Edit doesn’t activate and View is read-only', () => {
    const editor = member(fx('USR-2026-0040'), custom('Flow editor', ['VIEW_FLOWS', 'EDIT_FLOWS'], only(fx('PRJ-0001'))))
    expect(can(editor, 'viewFlows')).toBe(true)
    expect(can(editor, 'editFlows')).toBe(true)
    expect(can(editor, 'activateFlows')).toBe(false)
    expect(can(editor, 'createFlows')).toBe(false)
  })

  it('Given a Owner and a Project Admin, then today’s access is unchanged by the split', () => {
    for (const a of ['createProjects', 'renameProjects', 'archiveProjects', 'viewUsers', 'inviteUsers', 'changeUserRole', 'suspendUsers', 'viewRoles', 'createRoles', 'editRoles', 'changeRoleStatus', 'manageBilling', 'exportReports'] as const) {
      expect(canInMerchant(OWNER, a, fx('MER-0001'))).toBe(true)
    }
    for (const a of ['viewFlows', 'createFlows', 'editFlows', 'activateFlows', 'viewMembers', 'manageMembers', 'viewProjectSettings', 'manageProjectSettings', 'viewIntegration', 'manageIntegration', 'exportReports'] as const) {
      expect(can(PROJECT_ADMIN, a)).toBe(true)
    }
    expect(can(PROJECT_ADMIN, 'viewUsers')).toBe(false)
  })
})

describe('access: roles by scoped assignment (DEC-70)', () => {
  it('Given a member with different roles per project, then each project uses its own role', () => {
    expect(roleNamesInProject(REVIEWER, RETAIL)).toEqual(['Reviewer'])
    expect(roleNamesInProject(REVIEWER, SME)).toEqual(['Viewer'])
    expect(can(REVIEWER, 'claimCase', RETAIL)).toBe(true)
    expect(can(REVIEWER, 'claimCase', SME)).toBe(false)
    expect(can(REVIEWER, 'viewCases', SME)).toBe(true)
  })

  it('Given a Owner (All projects), then they act in every project of their merchant, new ones too, and none of another merchant', () => {
    expect(roleNamesInProject(OWNER, SME)).toEqual(['Owner'])
    expect(hasProject(OWNER, project(fx('PRJ-0099')))).toBe(true)
    expect(hasProject(OWNER, OTHER_MERCHANT)).toBe(false)
    expect(can(OWNER, 'manageIntegration', SME)).toBe(true)
    expect(can(OWNER, 'viewCases', OTHER_MERCHANT)).toBe(false)
  })

  it('Given a Project Admin, then they manage only their own project', () => {
    expect(can(PROJECT_ADMIN, 'editFlows', RETAIL)).toBe(true)
    expect(can(PROJECT_ADMIN, 'manageMembers', RETAIL)).toBe(true)
    expect(can(PROJECT_ADMIN, 'editFlows', SME)).toBe(false)
    expect(can(PROJECT_ADMIN, 'createProjects', RETAIL)).toBe(false)
  })

  it('Given two overlapping assignments, then the project gets the union of both roles', () => {
    const both = member(fx('USR-2026-0040'), grant(SYSTEM_ROLE_IDS.VIEWER, ALL), custom('Flow Editor', ['EDIT_FLOWS'], only(fx('PRJ-0002'))))
    expect(can(both, 'editFlows', SME)).toBe(true)
    expect(can(both, 'viewCases', SME)).toBe(true)
    expect(can(both, 'editFlows', RETAIL)).toBe(false)
    expect(roleNamesInProject(both, SME)).toEqual(['Viewer', 'Flow Editor'])
  })

  it('Given a custom role with Change verification level only, then thresholds but not the rest of the flow', () => {
    const tuner = member(fx('USR-2026-0041'), custom('Risk Tuner', ['CHANGE_VERIFICATION_LEVEL'], only(fx('PRJ-0001'))))
    expect(can(tuner, 'changeVerificationLevel')).toBe(true)
    expect(can(tuner, 'editFlows')).toBe(false)
  })

  it('Given no assignment for a project, then the user does not reach it at all', () => {
    expect(hasProject(PROJECT_ADMIN, SME)).toBe(false)
    expect(hasProject(member(fx('USR-2026-0042')), RETAIL)).toBe(false)
  })

  it('Given a Viewer, then they see cases and dashboards but cannot claim, decide or see the audit log', () => {
    expect(can(REVIEWER, 'viewDashboards', SME)).toBe(true)
    for (const a of ['claimCase', 'decideCase', 'viewAudit', 'editFlows'] as const) expect(can(REVIEWER, a, SME)).toBe(false)
  })

  it('Given a Reviewer, then no audit log and no settings; flows read-only (DEC-104)', () => {
    for (const a of ['viewAudit', 'editFlows', 'manageIntegration', 'manageMembers', 'viewProjectSettings'] as const) expect(can(REVIEWER, a)).toBe(false)
    expect(can(REVIEWER, 'viewFlows')).toBe(true)
  })
})

describe('access: merchant role on Users + project roles in Members (DEC-104)', () => {
  const role = (id: string) => SYSTEM_DEFAULT_ROLES.find((r) => r.roleId === id)!
  const g = (id: string, scope: AssignmentScope): Grant => ({ roleId: id, roleName: role(id).name, permissions: role(id).permissions, scope })

  it('Given a Member with a Reviewer role in Default only, then Default and nothing else (Member opens no project)', () => {
    const u = member(fx('USR-2026-0050'), g(SYSTEM_ROLE_IDS.MEMBER, ALL), g(SYSTEM_ROLE_IDS.REVIEWER, only(fx('PRJ-0001'))))
    expect(hasProject(u, RETAIL)).toBe(true)
    expect(hasProject(u, SME)).toBe(false)
    expect(roleNamesInProject(u, RETAIL)).toEqual(['Reviewer'])
    expect(hasProject(member(fx('USR-2026-0051'), g(SYSTEM_ROLE_IDS.MEMBER, ALL)), RETAIL)).toBe(false)
  })

  it('Given a Reviewer given on Users, then it applies in every project, new ones too', () => {
    const u = member(fx('USR-2026-0052'), g(SYSTEM_ROLE_IDS.REVIEWER, ALL))
    for (const p of [RETAIL, SME, project(fx('PRJ-0099'))]) expect(can(u, 'decideCase', p)).toBe(true)
  })

  it('Given an Auditor, then the case list but no case pages; audit log and merchant reports', () => {
    const u = member(fx('USR-2026-0053'), g(SYSTEM_ROLE_IDS.AUDITOR, ALL))
    expect(can(u, 'viewCases')).toBe(true)
    expect(can(u, 'viewCaseDetails')).toBe(false)
    expect(can(u, 'viewAudit')).toBe(true)
    expect(canInMerchant(u, 'viewMerchantReports', fx('MER-0001'))).toBe(true)
  })

  it('Given an Auditor who is also a Reviewer in Default, then the union: case pages and decisions there only', () => {
    const u = member(fx('USR-2026-0054'), g(SYSTEM_ROLE_IDS.AUDITOR, ALL), g(SYSTEM_ROLE_IDS.REVIEWER, only(fx('PRJ-0001'))))
    expect(can(u, 'viewCaseDetails', RETAIL)).toBe(true)
    expect(can(u, 'decideCase', RETAIL)).toBe(true)
    expect(can(u, 'viewCaseDetails', SME)).toBe(false)
  })

  it('Given a Developer, then API keys and flows read-only, and no case access', () => {
    const u = member(fx('USR-2026-0055'), g(SYSTEM_ROLE_IDS.MEMBER, ALL), g(SYSTEM_ROLE_IDS.DEVELOPER, only(fx('PRJ-0002'))))
    expect(can(u, 'manageIntegration', SME)).toBe(true)
    expect(can(u, 'viewFlows', SME)).toBe(true)
    expect(can(u, 'editFlows', SME)).toBe(false)
    expect(can(u, 'viewCases', SME)).toBe(false)
  })

  it('Given Billing, then billing for the whole merchant and nothing about cases', () => {
    const u = member(fx('USR-2026-0056'), g(SYSTEM_ROLE_IDS.BILLING, ALL))
    expect(canInMerchant(u, 'manageBilling', fx('MER-0001'))).toBe(true)
    expect(can(u, 'viewBilling')).toBe(true)
    expect(can(u, 'viewCases')).toBe(false)
  })

  it('Given merchant-wide permissions in a project role, then they don’t count (only the merchant role carries them)', () => {
    const u = member(fx('USR-2026-0057'), custom('Odd', ['CREATE_PROJECTS', 'VIEW_CASE_LIST'], only(fx('PRJ-0001'))))
    expect(canInMerchant(u, 'createProjects', fx('MER-0001'))).toBe(false)
    expect(can(u, 'viewCases')).toBe(true)
  })
})

describe('access: Super admin (DEC-70, DEC-75)', () => {
  it('Given a Super admin, then they manage flows in any merchant and set Advanced thresholds', () => {
    expect(can(PLATFORM, 'editFlows', OTHER_MERCHANT)).toBe(true)
    expect(can(PLATFORM, 'setAdvancedThresholds', OTHER_MERCHANT)).toBe(true)
    expect(can(OWNER, 'setAdvancedThresholds')).toBe(false)
  })

  it('Given a Super admin, then every action in every merchant: cases, claim, decide, API keys and webhooks (DEC-75)', () => {
    for (const a of PROJECT_ACTIONS) expect(can(PLATFORM, a, OTHER_MERCHANT), a).toBe(true)
    expect(canInMerchant(PLATFORM, 'manageBilling', fx('MER-0002'))).toBe(true)
  })

  it('Given the registry and merchants screens, then only Super admin', () => {
    expect(canOnPlatform(PLATFORM, 'manageRegistry')).toBe(true)
    expect(canOnPlatform(OWNER, 'viewMerchants')).toBe(false)
  })
})

describe('access: merchant-wide actions and scope (DEC-86, DEC-72)', () => {
  it('Given creating a project, then only Super admin or a holder of the permission for All projects', () => {
    expect(canInMerchant(OWNER, 'createProjects', fx('MER-0001'))).toBe(true)
    expect(canInMerchant(OWNER, 'createProjects', fx('MER-0002'))).toBe(false)
    expect(canInMerchant(PROJECT_ADMIN, 'createProjects', fx('MER-0001'))).toBe(false)
    expect(canInMerchant(PLATFORM, 'createProjects', fx('MER-0002'))).toBe(true)
    expect(canInMerchant(member(fx('USR-2026-0043'), custom('Admin desk', ['VIEW_USERS'], ALL)), 'viewUsers', fx('MER-0001'))).toBe(true)
  })

  it('Given a project-wide permission held only for some projects, then it does not count merchant-wide', () => {
    expect(canInMerchant(PROJECT_ADMIN, 'viewAudit', fx('MER-0001'))).toBe(false)
    expect(canInMerchant(OWNER, 'viewAudit', fx('MER-0001'))).toBe(true)
  })

  it('Given dashboards, then everyone sees them, scoped: Super admin all, owner their merchant, members their projects', () => {
    const all = [RETAIL, SME, project(fx('PRJ-0003')), OTHER_MERCHANT]
    expect(projectsWhere(PLATFORM, 'viewDashboards', all)).toHaveLength(4)
    expect(projectsWhere(OWNER, 'viewDashboards', all).map((p) => p.projectId)).toEqual([fx('PRJ-0001'), fx('PRJ-0002'), fx('PRJ-0003')])
    expect(projectsWhere(REVIEWER, 'viewDashboards', all).map((p) => p.projectId)).toEqual([fx('PRJ-0001'), fx('PRJ-0002')])
  })

  it('Given a case list, then only projects where the user may view cases (others are "not found")', () => {
    expect(projectsWhere(PROJECT_ADMIN, 'viewCases', [RETAIL, SME]).map((p) => p.projectId)).toEqual([fx('PRJ-0001')])
    expect(projectsWhere(PLATFORM, 'viewCases', [RETAIL, SME, OTHER_MERCHANT])).toHaveLength(3)
  })
})

describe('access: platform staff, one role and no scope (DEC-99, DEC-104)', () => {
  const platformGrant = (roleId: string): Grant => {
    const r = PLATFORM_DEFAULT_ROLES.find((x) => x.roleId === roleId)!
    return { roleId, roleName: r.name, permissions: r.permissions, scope: { kind: 'ALL_MERCHANTS' } }
  }
  const staff = (roleId: string): UserAccess => ({ userId: 'USR-STAFF', level: 'PLATFORM_STAFF', grants: [platformGrant(roleId)] })
  const SUPPORT = staff(PLATFORM_ROLE_IDS.SUPPORT)
  const IMPLEMENTATION = staff(PLATFORM_ROLE_IDS.IMPLEMENTATION)
  const FINANCE = staff(PLATFORM_ROLE_IDS.FINANCE)
  const PLATFORM_ADMIN = staff(PLATFORM_ROLE_IDS.PLATFORM_ADMIN)

  it('Given Support, then case list and details, read-only flows and keys, audit log — in every merchant; no decisions, no changes', () => {
    for (const p of [RETAIL, OTHER_MERCHANT]) {
      expect(can(SUPPORT, 'viewCases', p)).toBe(true)
      expect(can(SUPPORT, 'viewCaseDetails', p)).toBe(true)
      expect(can(SUPPORT, 'claimCase', p)).toBe(false)
      expect(can(SUPPORT, 'viewFlows', p)).toBe(true)
      expect(can(SUPPORT, 'editFlows', p)).toBe(false)
      expect(can(SUPPORT, 'viewIntegration', p)).toBe(true)
      expect(can(SUPPORT, 'manageIntegration', p)).toBe(false)
      expect(can(SUPPORT, 'viewAudit', p)).toBe(true)
    }
    expect(canOnPlatform(SUPPORT, 'createMerchants')).toBe(false)
  })

  it('Given Implementation, then merchants, flows, keys, registry and Advanced thresholds; no cases', () => {
    expect(canOnPlatform(IMPLEMENTATION, 'createMerchants')).toBe(true)
    expect(canOnPlatform(IMPLEMENTATION, 'changeMerchantStatus')).toBe(false)
    expect(canOnPlatform(IMPLEMENTATION, 'manageRegistry')).toBe(true)
    for (const a of ['createFlows', 'editFlows', 'activateFlows', 'changeVerificationLevel', 'manageIntegration', 'setAdvancedThresholds'] as const) expect(can(IMPLEMENTATION, a, OTHER_MERCHANT), a).toBe(true)
    expect(can(IMPLEMENTATION, 'viewCases')).toBe(false)
  })

  it('Given Finance, then billing and reports everywhere but no customer data', () => {
    expect(can(FINANCE, 'viewBilling', OTHER_MERCHANT)).toBe(true)
    expect(can(FINANCE, 'exportReports', RETAIL)).toBe(true)
    expect(can(FINANCE, 'viewCases', RETAIL)).toBe(false)
    expect(can(FINANCE, 'viewAudit', RETAIL)).toBe(false)
  })

  it('Given Platform Admin, then every platform-wide permission and all merchant data and actions', () => {
    expect(canOnPlatform(PLATFORM_ADMIN, 'changeMerchantStatus')).toBe(true)
    for (const a of ['viewCaseDetails', 'decideCase', 'activateFlows', 'manageIntegration', 'viewAudit'] as const) expect(can(PLATFORM_ADMIN, a, OTHER_MERCHANT), a).toBe(true)
  })

  it('Given Platform Admin, then merchants’ users, roles, projects, members and project roles in every merchant (DEC-104)', () => {
    for (const a of ['viewUsers', 'inviteUsers', 'changeUserRole', 'suspendUsers', 'createRoles', 'editRoles', 'createProjects', 'archiveProjects', 'manageMembers', 'createProjectRoles', 'manageProjectSettings', 'manageBilling'] as const) {
      expect(canInMerchant(PLATFORM_ADMIN, a, fx('MER-0002')), a).toBe(true)
    }
  })

  it('Given Support, Implementation or Finance, then no Users, Roles or merchant settings; nobody on staff manages staff', () => {
    for (const s of [SUPPORT, IMPLEMENTATION, FINANCE]) {
      for (const a of ['changeUserRole', 'manageMembers', 'createProjects', 'manageProjectSettings'] as const) expect(can(s, a)).toBe(false)
    }
    for (const s of [SUPPORT, IMPLEMENTATION, FINANCE, PLATFORM_ADMIN]) {
      expect(canOnPlatform(s, 'manageStaff')).toBe(false)
    }
  })
})

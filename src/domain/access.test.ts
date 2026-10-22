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
const OWNER = member(fx('USR-2026-0002'), grant(SYSTEM_ROLE_IDS.MERCHANT_OWNER, ALL))
const PROJECT_ADMIN = member(fx('USR-2026-0003'), grant(SYSTEM_ROLE_IDS.PROJECT_ADMIN, only(fx('PRJ-0001'))))
// One user, different roles in different projects (DEC-70).
const REVIEWER = member(fx('USR-2026-0012'), grant(SYSTEM_ROLE_IDS.REVIEWER, only(fx('PRJ-0001'))), grant(SYSTEM_ROLE_IDS.VIEWER, only(fx('PRJ-0002'))))

const can = (u: UserAccess, a: ProjectAction, p = RETAIL) => canInProject(u, a, p)

describe('access: one permission per action (DEC-102)', () => {
  it('Given a role that may only invite users, then it sees and invites but neither changes access nor suspends', () => {
    const desk = member(fx('USR-2026-0040'), custom('Invite desk', ['VIEW_USERS', 'INVITE_USERS'], ALL))
    expect(canInMerchant(desk, 'viewUsers', fx('MER-0001'))).toBe(true)
    expect(canInMerchant(desk, 'inviteUsers', fx('MER-0001'))).toBe(true)
    expect(canInMerchant(desk, 'changeUserAccess', fx('MER-0001'))).toBe(false)
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

  it('Given a Merchant Owner and a Project Admin, then today’s access is unchanged by the split', () => {
    for (const a of ['createProjects', 'renameProjects', 'archiveProjects', 'viewUsers', 'inviteUsers', 'changeUserAccess', 'suspendUsers', 'viewRoles', 'createRoles', 'editRoles', 'changeRoleStatus', 'manageBilling', 'exportReports'] as const) {
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

  it('Given a Merchant Owner (All projects), then they act in every project of their merchant, new ones too, and none of another merchant', () => {
    expect(roleNamesInProject(OWNER, SME)).toEqual(['Merchant Owner'])
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

  it('Given a Reviewer, then no audit log and no settings', () => {
    for (const a of ['viewAudit', 'editFlows', 'manageIntegration', 'manageMembers', 'viewRouting'] as const) expect(can(REVIEWER, a)).toBe(false)
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

describe('access: platform staff (DEC-99)', () => {
  const platformGrant = (roleId: string, scope: AssignmentScope): Grant => {
    const r = PLATFORM_DEFAULT_ROLES.find((x) => x.roleId === roleId)!
    return { roleId, roleName: r.name, permissions: r.permissions, scope }
  }
  const staff = (...grants: Grant[]): UserAccess => ({ userId: 'USR-STAFF', level: 'PLATFORM_STAFF', grants })
  const SUPPORT = staff(platformGrant(PLATFORM_ROLE_IDS.SUPPORT, { kind: 'ALL_MERCHANTS' }))
  const SPECIALIST = staff(platformGrant(PLATFORM_ROLE_IDS.VERIFICATION_SPECIALIST, { kind: 'MERCHANTS', merchantIds: [fx('MER-0002')] }))
  const FINANCE = staff(platformGrant(PLATFORM_ROLE_IDS.FINANCE, { kind: 'ALL_MERCHANTS' }))
  const ENGINEER = staff(platformGrant(PLATFORM_ROLE_IDS.WORKFLOW_ENGINEER, { kind: 'ALL_MERCHANTS' }))

  it('Given Support for All merchants, then masked cases, read-only flows and keys, audit log — in every merchant; no decisions', () => {
    for (const p of [RETAIL, OTHER_MERCHANT]) {
      expect(can(SUPPORT, 'viewCases', p)).toBe(true)
      expect(can(SUPPORT, 'viewUnmaskedPii', p)).toBe(false)
      expect(can(SUPPORT, 'viewFlows', p)).toBe(true)
      expect(can(SUPPORT, 'editFlows', p)).toBe(false)
      expect(can(SUPPORT, 'viewIntegration', p)).toBe(true)
      expect(can(SUPPORT, 'manageIntegration', p)).toBe(false)
      expect(can(SUPPORT, 'viewAudit', p)).toBe(true)
      expect(can(SUPPORT, 'claimCase', p)).toBe(false)
    }
    expect(canOnPlatform(SUPPORT, 'viewMerchants')).toBe(true)
    expect(canOnPlatform(SUPPORT, 'createMerchants')).toBe(false)
  })

  it('Given a Verification Specialist for Vantage only, then unmasked review there and nothing elsewhere', () => {
    expect(can(SPECIALIST, 'decideCase', OTHER_MERCHANT)).toBe(true)
    expect(can(SPECIALIST, 'viewUnmaskedPii', OTHER_MERCHANT)).toBe(true)
    expect(hasProject(SPECIALIST, RETAIL)).toBe(false)
    expect(can(SPECIALIST, 'viewCases', RETAIL)).toBe(false)
  })

  it('Given Finance (no merchant access), then billing and reports everywhere but no customer data', () => {
    expect(can(FINANCE, 'viewBilling', OTHER_MERCHANT)).toBe(true)
    expect(can(FINANCE, 'exportReports', RETAIL)).toBe(true)
    expect(can(FINANCE, 'viewCases', RETAIL)).toBe(false)
    expect(can(FINANCE, 'viewAudit', RETAIL)).toBe(false)
  })

  it('Given a Workflow Engineer, then the registry and Advanced thresholds, but flows only read-only', () => {
    expect(canOnPlatform(ENGINEER, 'manageRegistry')).toBe(true)
    expect(can(ENGINEER, 'setAdvancedThresholds')).toBe(true)
    expect(can(ENGINEER, 'editFlows')).toBe(false)
    expect(can(ENGINEER, 'viewFlows')).toBe(true)
  })

  it('Given any staff, then never Users, Roles, Super admins or merchant settings', () => {
    for (const s of [SUPPORT, SPECIALIST, FINANCE, ENGINEER]) {
      for (const a of ['changeUserAccess', 'manageMembers', 'createProjects', 'manageProjectSettings'] as const) expect(can(s, a)).toBe(false)
      expect(canOnPlatform(s, 'manageStaff')).toBe(false)
      expect(canOnPlatform(s, 'manageAdmins')).toBe(false)
    }
  })
})

import { describe, expect, it } from 'vitest'
import { canInMerchant, canInProject, canOnPlatform, hasProject, PROJECT_ACTIONS, projectsWhere, roleNamesInProject, type ProjectAction } from './access'
import { SYSTEM_DEFAULT_ROLES, SYSTEM_ROLE_IDS } from './roles'
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
    expect(can(PROJECT_ADMIN, 'manageFlows', RETAIL)).toBe(true)
    expect(can(PROJECT_ADMIN, 'manageMembers', RETAIL)).toBe(true)
    expect(can(PROJECT_ADMIN, 'manageFlows', SME)).toBe(false)
    expect(can(PROJECT_ADMIN, 'manageProjects', RETAIL)).toBe(false)
  })

  it('Given two overlapping assignments, then the project gets the union of both roles', () => {
    const both = member(fx('USR-2026-0040'), grant(SYSTEM_ROLE_IDS.VIEWER, ALL), custom('Flow Editor', ['MANAGE_FLOWS'], only(fx('PRJ-0002'))))
    expect(can(both, 'manageFlows', SME)).toBe(true)
    expect(can(both, 'viewCases', SME)).toBe(true)
    expect(can(both, 'manageFlows', RETAIL)).toBe(false)
    expect(roleNamesInProject(both, SME)).toEqual(['Viewer', 'Flow Editor'])
  })

  it('Given a custom role with Change verification level only, then thresholds but not the rest of the flow', () => {
    const tuner = member(fx('USR-2026-0041'), custom('Risk Tuner', ['CHANGE_VERIFICATION_LEVEL'], only(fx('PRJ-0001'))))
    expect(can(tuner, 'changeVerificationLevel')).toBe(true)
    expect(can(tuner, 'manageFlows')).toBe(false)
  })

  it('Given no assignment for a project, then the user does not reach it at all', () => {
    expect(hasProject(PROJECT_ADMIN, SME)).toBe(false)
    expect(hasProject(member(fx('USR-2026-0042')), RETAIL)).toBe(false)
  })

  it('Given a Viewer, then they see cases and dashboards but cannot claim, decide or see the audit log', () => {
    expect(can(REVIEWER, 'viewDashboards', SME)).toBe(true)
    for (const a of ['claimCase', 'decideCase', 'viewAudit', 'manageFlows'] as const) expect(can(REVIEWER, a, SME)).toBe(false)
  })

  it('Given a Reviewer, then no audit log and no settings', () => {
    for (const a of ['viewAudit', 'manageFlows', 'manageIntegration', 'manageMembers', 'viewRouting'] as const) expect(can(REVIEWER, a)).toBe(false)
  })
})

describe('access: Super admin (DEC-70, DEC-75)', () => {
  it('Given a Super admin, then they manage flows in any merchant and set Advanced thresholds', () => {
    expect(can(PLATFORM, 'manageFlows', OTHER_MERCHANT)).toBe(true)
    expect(can(PLATFORM, 'setAdvancedThresholds', OTHER_MERCHANT)).toBe(true)
    expect(can(OWNER, 'setAdvancedThresholds')).toBe(false)
  })

  it('Given a Super admin, then every action in every merchant: cases, claim, decide, API keys and webhooks (DEC-75)', () => {
    for (const a of PROJECT_ACTIONS) expect(can(PLATFORM, a, OTHER_MERCHANT), a).toBe(true)
    expect(canInMerchant(PLATFORM, 'manageBilling', fx('MER-0002'))).toBe(true)
  })

  it('Given the registry and merchants screens, then only Super admin', () => {
    expect(canOnPlatform(PLATFORM, 'manageRegistry')).toBe(true)
    expect(canOnPlatform(OWNER, 'manageMerchants')).toBe(false)
  })
})

describe('access: merchant-wide actions and scope (DEC-86, DEC-72)', () => {
  it('Given creating a project, then only Super admin or a holder of the permission for All projects', () => {
    expect(canInMerchant(OWNER, 'manageProjects', fx('MER-0001'))).toBe(true)
    expect(canInMerchant(OWNER, 'manageProjects', fx('MER-0002'))).toBe(false)
    expect(canInMerchant(PROJECT_ADMIN, 'manageProjects', fx('MER-0001'))).toBe(false)
    expect(canInMerchant(PLATFORM, 'manageProjects', fx('MER-0002'))).toBe(true)
    expect(canInMerchant(member(fx('USR-2026-0043'), custom('Admin desk', ['MANAGE_USERS_ROLES'], ALL)), 'manageUsersRoles', fx('MER-0001'))).toBe(true)
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

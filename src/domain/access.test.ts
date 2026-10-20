import { describe, expect, it } from 'vitest'
import { canInMerchant, canInProject, canOnPlatform, projectsWhere, roleInProject, type ProjectAction } from './access'
import type { Project, UserAccess } from './types'

const project = (projectId: string, merchantId = 'MER-0001'): Pick<Project, 'projectId' | 'merchantId'> => ({ projectId, merchantId })
const RETAIL = project('PRJ-0001')
const SME = project('PRJ-0002')
const OTHER_MERCHANT = project('PRJ-0009', 'MER-0002')

const PLATFORM: UserAccess = { userId: 'USR-2026-0001', level: 'PLATFORM_ADMIN', memberships: [] }
const OWNER: UserAccess = { userId: 'USR-2026-0002', level: 'MERCHANT_OWNER', merchantId: 'MER-0001', memberships: [] }
const PROJECT_ADMIN: UserAccess = { userId: 'USR-2026-0003', level: 'MEMBER', merchantId: 'MER-0001', memberships: [{ projectId: 'PRJ-0001', role: 'PROJECT_ADMIN' }] }
// One user, different roles in different projects (DEC-74).
const REVIEWER: UserAccess = {
  userId: 'USR-2026-0012',
  level: 'MEMBER',
  merchantId: 'MER-0001',
  memberships: [
    { projectId: 'PRJ-0001', role: 'REVIEWER' },
    { projectId: 'PRJ-0002', role: 'VIEWER' },
  ],
}

const can = (u: UserAccess, a: ProjectAction, p = RETAIL) => canInProject(u, a, p)

describe('access: roles per project (DEC-70)', () => {
  it('Given a member with different roles per project, then each project uses its own role', () => {
    expect(roleInProject(REVIEWER, RETAIL)).toBe('REVIEWER')
    expect(roleInProject(REVIEWER, SME)).toBe('VIEWER')
    expect(can(REVIEWER, 'claimCase', RETAIL)).toBe(true)
    expect(can(REVIEWER, 'claimCase', SME)).toBe(false)
    expect(can(REVIEWER, 'viewCases', SME)).toBe(true)
  })

  it('Given a Merchant Owner, then they act in every project of their merchant and none of another merchant', () => {
    expect(roleInProject(OWNER, SME)).toBe('MERCHANT_OWNER')
    expect(can(OWNER, 'manageIntegration', SME)).toBe(true)
    expect(can(OWNER, 'viewCases', OTHER_MERCHANT)).toBe(false)
  })

  it('Given a Project Admin, then they manage only their own project', () => {
    expect(can(PROJECT_ADMIN, 'manageFlows', RETAIL)).toBe(true)
    expect(can(PROJECT_ADMIN, 'manageMembers', RETAIL)).toBe(true)
    expect(can(PROJECT_ADMIN, 'manageFlows', SME)).toBe(false)
    expect(can(PROJECT_ADMIN, 'manageProjects', RETAIL)).toBe(false)
  })

  it('Given a Viewer, then they see cases and dashboards but cannot claim, decide or see the audit log', () => {
    expect(can(REVIEWER, 'viewDashboards', SME)).toBe(true)
    for (const a of ['claimCase', 'decideCase', 'viewAudit', 'manageFlows'] as const) expect(can(REVIEWER, a, SME)).toBe(false)
  })

  it('Given a Reviewer, then no audit log and no settings', () => {
    for (const a of ['viewAudit', 'manageFlows', 'manageIntegration', 'manageMembers', 'viewRouting'] as const) expect(can(REVIEWER, a)).toBe(false)
  })
})

describe('access: Platform Admin (DEC-70, DEC-75)', () => {
  it('Given a Platform Admin, then they manage flows in any merchant and set Advanced thresholds', () => {
    expect(can(PLATFORM, 'manageFlows', OTHER_MERCHANT)).toBe(true)
    expect(can(PLATFORM, 'setAdvancedThresholds', OTHER_MERCHANT)).toBe(true)
    expect(can(OWNER, 'setAdvancedThresholds')).toBe(false)
  })

  it('Given a Platform Admin, then never API keys or webhooks (merchant secrets), and never claim or decide', () => {
    for (const a of ['manageIntegration', 'claimCase', 'decideCase'] as const) expect(can(PLATFORM, a)).toBe(false)
  })

  it('Given OQ-20 = no (default), then Platform Admin cannot view cases; when yes, they can', () => {
    expect(can(PLATFORM, 'viewCases')).toBe(false)
    expect(canInProject(PLATFORM, 'viewCases', RETAIL, { platformAdminCaseAccess: true })).toBe(true)
  })

  it('Given the registry and merchants screens, then only Platform Admin', () => {
    expect(canOnPlatform(PLATFORM, 'manageRegistry')).toBe(true)
    expect(canOnPlatform(OWNER, 'manageMerchants')).toBe(false)
  })
})

describe('access: merchant-wide actions and scope (DEC-86, DEC-72)', () => {
  it('Given creating a project, then only Platform Admin or that merchant’s owner', () => {
    expect(canInMerchant(OWNER, 'manageProjects', 'MER-0001')).toBe(true)
    expect(canInMerchant(OWNER, 'manageProjects', 'MER-0002')).toBe(false)
    expect(canInMerchant(PROJECT_ADMIN, 'manageProjects', 'MER-0001')).toBe(false)
    expect(canInMerchant(PLATFORM, 'manageProjects', 'MER-0002')).toBe(true)
  })

  it('Given dashboards, then everyone sees them, scoped: Platform Admin all, owner their merchant, members their projects', () => {
    const all = [RETAIL, SME, project('PRJ-0003'), OTHER_MERCHANT]
    expect(projectsWhere(PLATFORM, 'viewDashboards', all)).toHaveLength(4)
    expect(projectsWhere(OWNER, 'viewDashboards', all).map((p) => p.projectId)).toEqual(['PRJ-0001', 'PRJ-0002', 'PRJ-0003'])
    expect(projectsWhere(REVIEWER, 'viewDashboards', all).map((p) => p.projectId)).toEqual(['PRJ-0001', 'PRJ-0002'])
  })

  it('Given a case list, then only projects where the user may view cases (others are "not found")', () => {
    expect(projectsWhere(PROJECT_ADMIN, 'viewCases', [RETAIL, SME]).map((p) => p.projectId)).toEqual(['PRJ-0001'])
    expect(projectsWhere(PLATFORM, 'viewCases', [RETAIL, SME])).toEqual([])
  })
})

// Per-project access (DEC-70, DEC-72, DEC-75, DEC-86). Replaces the two-role permissions.ts once services move over (Phase 4).
// REQ: DEC-71 — UI-only checks. The real backend must enforce the same table.
import { POLICY, type Policy } from './openQuestions'
import type { EffectiveRole, Project, UserAccess } from './types'

/** Platform-wide actions: no project involved. */
export const PLATFORM_ACTIONS = ['manageRegistry', 'manageMerchants'] as const
export type PlatformAction = (typeof PLATFORM_ACTIONS)[number]

/** Actions checked against one project (or, for merchant-wide ones, one merchant). */
export const PROJECT_ACTIONS = [
  'viewDashboards', // Overview, System Intelligence, Billing — data scoped (DEC-86)
  'manageProjects', // create, rename, archive
  'manageMembers', // invite users, assign project roles
  'manageIntegration', // API keys, webhook, redirect URLs, IP allowlist
  'manageProjectSettings', // General and Review operations (DEC-54); not in the DEC-70 table: same roles as flows
  'manageFlows', // create, edit, activate, retire
  'setAdvancedThresholds', // DEC-19
  'viewRouting',
  'viewCases',
  'claimCase',
  'decideCase', // only on the user's own claim (claimRules)
  'viewAudit',
] as const
export type ProjectAction = (typeof PROJECT_ACTIONS)[number]

export type { EffectiveRole }

const ALL: readonly EffectiveRole[] = ['PLATFORM_ADMIN', 'MERCHANT_OWNER', 'PROJECT_ADMIN', 'REVIEWER', 'VIEWER']

// REQ: DEC-70 / DEC-75
const ALLOWED: Record<ProjectAction, readonly EffectiveRole[]> = {
  viewDashboards: ALL,
  manageProjects: ['PLATFORM_ADMIN', 'MERCHANT_OWNER'],
  manageMembers: ['PLATFORM_ADMIN', 'MERCHANT_OWNER', 'PROJECT_ADMIN'],
  manageIntegration: ['MERCHANT_OWNER', 'PROJECT_ADMIN'], // merchant secrets: never Platform Admin
  manageProjectSettings: ['PLATFORM_ADMIN', 'MERCHANT_OWNER', 'PROJECT_ADMIN'],
  manageFlows: ['PLATFORM_ADMIN', 'MERCHANT_OWNER', 'PROJECT_ADMIN'],
  setAdvancedThresholds: ['PLATFORM_ADMIN'],
  viewRouting: ['PLATFORM_ADMIN', 'MERCHANT_OWNER', 'PROJECT_ADMIN'],
  viewCases: ['MERCHANT_OWNER', 'PROJECT_ADMIN', 'REVIEWER', 'VIEWER'], // Platform Admin: OQ-20
  claimCase: ['MERCHANT_OWNER', 'PROJECT_ADMIN', 'REVIEWER'],
  decideCase: ['MERCHANT_OWNER', 'PROJECT_ADMIN', 'REVIEWER'],
  viewAudit: ['PLATFORM_ADMIN', 'MERCHANT_OWNER', 'PROJECT_ADMIN'],
}

/** The user's role in a project: Platform Admin everywhere, Merchant Owner across their merchant, otherwise their membership. */
export function roleInProject(user: UserAccess, project: Pick<Project, 'projectId' | 'merchantId'>): EffectiveRole | undefined {
  if (user.level === 'PLATFORM_ADMIN') return 'PLATFORM_ADMIN'
  if (user.merchantId !== project.merchantId) return undefined
  if (user.level === 'MERCHANT_OWNER') return 'MERCHANT_OWNER'
  return user.memberships.find((m) => m.projectId === project.projectId)?.role
}

function allowed(role: EffectiveRole | undefined, action: ProjectAction, policy: Pick<Policy, 'platformAdminCaseAccess'>): boolean {
  if (!role) return false
  if (action === 'viewCases' && role === 'PLATFORM_ADMIN') return policy.platformAdminCaseAccess // OQ-20
  return ALLOWED[action].includes(role)
}

export function canInProject(
  user: UserAccess,
  action: ProjectAction,
  project: Pick<Project, 'projectId' | 'merchantId'>,
  policy: Pick<Policy, 'platformAdminCaseAccess'> = POLICY,
): boolean {
  return allowed(roleInProject(user, project), action, policy)
}

/** Merchant-wide actions (e.g. create a project, merchant totals): only Platform Admin or that merchant's owner. */
export function canInMerchant(user: UserAccess, action: ProjectAction, merchantId: string, policy: Pick<Policy, 'platformAdminCaseAccess'> = POLICY): boolean {
  const role = user.level === 'PLATFORM_ADMIN' ? 'PLATFORM_ADMIN' : user.level === 'MERCHANT_OWNER' && user.merchantId === merchantId ? 'MERCHANT_OWNER' : undefined
  return allowed(role, action, policy)
}

export function canOnPlatform(user: UserAccess, _action: PlatformAction): boolean {
  return user.level === 'PLATFORM_ADMIN'
}

/**
 * Projects where the user may do `action`: the project switcher, "All my projects" case lists and dashboard scope (DEC-86).
 * REQ: DEC-72 — services return "not found" for a case whose project is not in this list.
 */
export function projectsWhere<P extends Pick<Project, 'projectId' | 'merchantId'>>(
  user: UserAccess,
  action: ProjectAction,
  projects: readonly P[],
  policy: Pick<Policy, 'platformAdminCaseAccess'> = POLICY,
): P[] {
  return projects.filter((p) => canInProject(user, action, p, policy))
}

// Access checks from scoped role assignments (DEC-70, DEC-72, DEC-75, DEC-86): permissions are the union of the grants
// covering a project. REQ: DEC-71 — UI-only checks. The real backend must enforce the same rules.
import { coversProject, merchantWidePermissions, permissionsIn, PLATFORM_ADMIN_PERMISSIONS, roleNamesIn } from './roles'
import type { Permission, Project, UserAccess } from './types'

/** Platform-wide actions: no project involved. */
export const PLATFORM_ACTIONS = ['manageRegistry', 'manageMerchants', 'manageAdmins'] as const
export type PlatformAction = (typeof PLATFORM_ACTIONS)[number]

/** Actions checked against one project; the merchant-level ones hold only through an All projects assignment. */
export const PROJECT_ACTIONS = [
  'viewDashboards', // Overview, System Intelligence, Billing — data scoped (DEC-86)
  'manageProjects', // create, rename, archive
  'manageUsersRoles', // Users and Roles screens
  'manageBilling',
  'viewMerchantReports',
  'manageMembers', // Members tab of a project (DEC-77)
  'manageIntegration', // API keys, webhook, redirect URLs, IP allowlist
  'manageProjectSettings', // General and Review operations (DEC-54)
  'manageFlows', // create, edit, activate, retire
  'changeVerificationLevel', // thresholds, retries allowed, risk level
  'setAdvancedThresholds', // DEC-19: Platform Admin only
  'viewRouting',
  'viewCases',
  'claimCase',
  'decideCase', // only on the user's own claim (claimRules)
  'viewAudit',
] as const
export type ProjectAction = (typeof PROJECT_ACTIONS)[number]

// REQ: DEC-70 — the permission behind each action (any one of them is enough). Empty = Platform Admin only.
const NEEDS: Record<ProjectAction, readonly Permission[]> = {
  viewDashboards: ['VIEW_PROJECT_REPORTS', 'VIEW_MERCHANT_REPORTS'],
  manageProjects: ['MANAGE_PROJECTS'],
  manageUsersRoles: ['MANAGE_USERS_ROLES'],
  manageBilling: ['MANAGE_BILLING'],
  viewMerchantReports: ['VIEW_MERCHANT_REPORTS'],
  manageMembers: ['MANAGE_MEMBERS'],
  manageIntegration: ['MANAGE_INTEGRATION'],
  manageProjectSettings: ['MANAGE_PROJECT_SETTINGS'],
  manageFlows: ['MANAGE_FLOWS'],
  changeVerificationLevel: ['CHANGE_VERIFICATION_LEVEL'],
  setAdvancedThresholds: [],
  viewRouting: ['MANAGE_FLOWS', 'MANAGE_PROJECT_SETTINGS'],
  viewCases: ['VIEW_CASES'],
  claimCase: ['CLAIM_CASES'],
  decideCase: ['DECIDE_CASES'],
  viewAudit: ['VIEW_AUDIT_LOG'],
}

/** REQ: DEC-70 / DEC-75 — Platform Admin's rights: every permission, in any merchant. */
const platformAdminPermissions = () => new Set<Permission>(PLATFORM_ADMIN_PERMISSIONS)

function allows(have: Set<Permission>, action: ProjectAction, isPlatformAdmin: boolean): boolean {
  if (action === 'setAdvancedThresholds') return isPlatformAdmin
  return NEEDS[action].some((p) => have.has(p))
}

/** REQ: DEC-72 — the user reaches the project at all: Platform Admin everywhere, others where an assignment covers it. */
export function hasProject(user: UserAccess, project: Pick<Project, 'projectId' | 'merchantId'>): boolean {
  if (user.level === 'PLATFORM_ADMIN') return true
  return user.merchantId === project.merchantId && coversProject(user.grants, project.projectId)
}

/** The user's permissions in one project (union of the grants covering it). */
export function permissionsInProject(user: UserAccess, project: Pick<Project, 'projectId' | 'merchantId'>): Set<Permission> {
  if (user.level === 'PLATFORM_ADMIN') return platformAdminPermissions()
  if (user.merchantId !== project.merchantId) return new Set()
  return permissionsIn(user.grants, project.projectId)
}

/** Role names in a project, e.g. ["Reviewer"], or ["Platform Admin"]: header, Projects screen and audit entries (DEC-42, DEC-73). */
export function roleNamesInProject(user: UserAccess, project: Pick<Project, 'projectId' | 'merchantId'>): string[] {
  if (user.level === 'PLATFORM_ADMIN') return ['Platform Admin']
  return user.merchantId === project.merchantId ? roleNamesIn(user.grants, project.projectId) : []
}

export function canInProject(user: UserAccess, action: ProjectAction, project: Pick<Project, 'projectId' | 'merchantId'>): boolean {
  return allows(permissionsInProject(user, project), action, user.level === 'PLATFORM_ADMIN')
}

/**
 * Merchant-wide actions (create a project, manage users and roles, merchant-level audit entries): Platform Admin, or a
 * user holding the permission through an All projects assignment in that merchant.
 */
export function canInMerchant(user: UserAccess, action: ProjectAction, merchantId: string): boolean {
  if (user.level === 'PLATFORM_ADMIN') return allows(platformAdminPermissions(), action, true)
  return user.merchantId === merchantId && allows(merchantWidePermissions(user.grants), action, false)
}

export function canOnPlatform(user: UserAccess, _action: PlatformAction): boolean {
  return user.level === 'PLATFORM_ADMIN'
}

/**
 * Projects where the user may do `action`: the project switcher, "All my projects" case lists and dashboard scope (DEC-86).
 * REQ: DEC-72 — services return "not found" for a case whose project is not in this list.
 */
export function projectsWhere<P extends Pick<Project, 'projectId' | 'merchantId'>>(user: UserAccess, action: ProjectAction, projects: readonly P[]): P[] {
  return projects.filter((p) => canInProject(user, action, p))
}

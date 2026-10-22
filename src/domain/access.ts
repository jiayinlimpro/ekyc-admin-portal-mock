// Access checks (DEC-70, DEC-72, DEC-75, DEC-86, DEC-99). Three account types:
// - Super admin: everything, everywhere (outside the role system).
// - Platform staff: platform-level permissions anywhere, merchant-access permissions in the merchants their grants cover.
// - Merchant user: the union of the grants covering a project, inside their own merchant.
// REQ: DEC-71 — UI-only checks. The real backend must enforce the same rules.
import { coversMerchant, coversProject, merchantWidePermissions, permissionsIn, roleNamesIn, staffMerchantPermissions, staffPlatformPermissions } from './roles'
import type { Permission, Project, UserAccess } from './types'

/** Platform-wide actions: no project involved. */
export const PLATFORM_ACTIONS = [
  'viewMerchants',
  'createMerchants', // add, edit details, resend invitation
  'changeMerchantStatus', // go live, suspend, terminate (DEC-98)
  'viewRegistry',
  'manageRegistry',
  'manageAdmins', // Super admins screen: super admin only
  'manageStaff', // platform roles and platform staff: super admin only (DEC-99)
] as const
export type PlatformAction = (typeof PLATFORM_ACTIONS)[number]

/** Actions checked against one project; the merchant-level ones hold only through an All projects assignment. */
export const PROJECT_ACTIONS = [
  'viewDashboards', // Overview, System Intelligence — data scoped (DEC-86)
  'viewBilling', // Billing — data scoped (DEC-86)
  'exportReports', // CSV exports of the dashboards and Billing
  'manageProjects', // create, rename, archive
  'manageUsersRoles', // Users and Roles screens
  'manageBilling',
  'viewMerchantReports',
  'manageMembers', // Members tab of a project (DEC-77)
  'viewIntegration', // Integration tab, read-only
  'manageIntegration', // API keys, webhook, redirect URLs, IP allowlist
  'manageProjectSettings', // General and Review operations (DEC-54)
  'viewFlows', // Flows List / Detail, read-only
  'manageFlows', // create, edit, activate, retire
  'changeVerificationLevel', // thresholds, retries allowed, risk level
  'setAdvancedThresholds', // DEC-19: Super admin, or platform staff who may calibrate (DEC-99)
  'viewRouting',
  'viewCases',
  'viewUnmaskedPii', // Verification Detail unmasked (DEC-41); otherwise masked (DEC-99)
  'claimCase',
  'decideCase', // only on the user's own claim (claimRules)
  'viewAudit',
] as const
export type ProjectAction = (typeof PROJECT_ACTIONS)[number]

// REQ: DEC-70 — the merchant permission behind each action (any one is enough). Empty = not for merchant users.
const NEEDS: Record<ProjectAction, readonly Permission[]> = {
  viewDashboards: ['VIEW_PROJECT_REPORTS', 'VIEW_MERCHANT_REPORTS'],
  viewBilling: ['VIEW_PROJECT_REPORTS', 'VIEW_MERCHANT_REPORTS'],
  exportReports: ['VIEW_PROJECT_REPORTS', 'VIEW_MERCHANT_REPORTS'],
  manageProjects: ['MANAGE_PROJECTS'],
  manageUsersRoles: ['MANAGE_USERS_ROLES'],
  manageBilling: ['MANAGE_BILLING'],
  viewMerchantReports: ['VIEW_MERCHANT_REPORTS'],
  manageMembers: ['MANAGE_MEMBERS'],
  viewIntegration: ['MANAGE_INTEGRATION'],
  manageIntegration: ['MANAGE_INTEGRATION'],
  manageProjectSettings: ['MANAGE_PROJECT_SETTINGS'],
  viewFlows: ['MANAGE_FLOWS'],
  manageFlows: ['MANAGE_FLOWS'],
  changeVerificationLevel: ['CHANGE_VERIFICATION_LEVEL'],
  setAdvancedThresholds: [],
  viewRouting: ['MANAGE_FLOWS', 'MANAGE_PROJECT_SETTINGS'],
  viewCases: ['VIEW_CASES'],
  viewUnmaskedPii: ['VIEW_CASES'], // merchant users always see their own cases in full (DEC-41)
  claimCase: ['CLAIM_CASES'],
  decideCase: ['DECIDE_CASES'],
  viewAudit: ['VIEW_AUDIT_LOG'],
}

// REQ: DEC-99 — what platform staff need: a platform-level permission (anywhere) or a merchant-access one (in that merchant).
const STAFF_NEEDS: Partial<Record<ProjectAction, { platform?: readonly Permission[]; merchant?: readonly Permission[] }>> = {
  viewDashboards: { platform: ['P_REPORTS_VIEW'] },
  viewBilling: { platform: ['P_BILLING_VIEW'] },
  exportReports: { platform: ['P_REPORTS_EXPORT'] },
  viewCases: { merchant: ['P_CASES_VIEW_MASKED', 'P_CASES_VIEW_UNMASKED', 'P_CASES_DECIDE'] },
  viewUnmaskedPii: { merchant: ['P_CASES_VIEW_UNMASKED'] },
  claimCase: { merchant: ['P_CASES_DECIDE'] },
  decideCase: { merchant: ['P_CASES_DECIDE'] },
  viewFlows: { merchant: ['P_FLOWS_VIEW', 'P_FLOWS_EDIT'] },
  manageFlows: { merchant: ['P_FLOWS_EDIT'] },
  changeVerificationLevel: { merchant: ['P_FLOWS_EDIT'] },
  setAdvancedThresholds: { platform: ['P_LEVELS_CALIBRATE'] },
  viewIntegration: { merchant: ['P_INTEGRATION_VIEW', 'P_INTEGRATION_MANAGE'] },
  manageIntegration: { merchant: ['P_INTEGRATION_MANAGE'] },
  viewAudit: { merchant: ['P_AUDIT_VIEW'] },
}

const STAFF_PLATFORM_NEEDS: Partial<Record<PlatformAction, readonly Permission[]>> = {
  viewMerchants: ['P_MERCHANTS_VIEW', 'P_MERCHANTS_CREATE', 'P_MERCHANTS_SUSPEND'],
  createMerchants: ['P_MERCHANTS_CREATE'],
  changeMerchantStatus: ['P_MERCHANTS_SUSPEND'],
  viewRegistry: ['P_REGISTRY_VIEW', 'P_REGISTRY_MANAGE'],
  manageRegistry: ['P_REGISTRY_MANAGE'],
}

type Where = Pick<Project, 'projectId' | 'merchantId'>
const any = (have: Set<Permission>, need: readonly Permission[] | undefined) => !!need && need.some((p) => have.has(p))

/** Super admins and platform staff: internal accounts with no merchant (DEC-99). */
export const isInternal = (user: Pick<UserAccess, 'level'>) => user.level === 'SUPER_ADMIN' || user.level === 'PLATFORM_STAFF'

function staffCan(user: UserAccess, action: ProjectAction, merchantId: string): boolean {
  const need = STAFF_NEEDS[action]
  if (!need) return false
  return any(staffPlatformPermissions(user.grants), need.platform) || any(staffMerchantPermissions(user.grants, merchantId), need.merchant)
}

/** REQ: DEC-72 — the user reaches the project at all; outside it, the project and its cases are "not found". */
export function hasProject(user: UserAccess, project: Where): boolean {
  if (user.level === 'SUPER_ADMIN') return true
  if (user.level === 'PLATFORM_STAFF') return PROJECT_ACTIONS.some((a) => staffCan(user, a, project.merchantId))
  return user.merchantId === project.merchantId && coversProject(user.grants, project.projectId)
}

/** A merchant user's permissions in one project (union of the grants covering it). Not for internal accounts. */
export function permissionsInProject(user: UserAccess, project: Where): Set<Permission> {
  if (user.level !== 'MERCHANT_USER' || user.merchantId !== project.merchantId) return new Set()
  return permissionsIn(user.grants, project.projectId)
}

/** Role names in a project, e.g. ["Reviewer"], or ["Super admin"]: header, Projects screen and audit entries (DEC-42, DEC-73). */
export function roleNamesInProject(user: UserAccess, project: Where): string[] {
  if (user.level === 'SUPER_ADMIN') return ['Super admin']
  if (user.level === 'PLATFORM_STAFF') return [...new Set(user.grants.filter((g) => coversMerchant(g.scope, project.merchantId)).map((g) => g.roleName))]
  return user.merchantId === project.merchantId ? roleNamesIn(user.grants, project.projectId) : []
}

export function canInProject(user: UserAccess, action: ProjectAction, project: Where): boolean {
  if (user.level === 'SUPER_ADMIN') return true
  if (user.level === 'PLATFORM_STAFF') return staffCan(user, action, project.merchantId)
  return any(permissionsInProject(user, project), NEEDS[action])
}

/**
 * Merchant-wide actions (create a project, manage users and roles, merchant-level audit entries): Super admin, platform
 * staff for the audit log of merchants they cover, or a user holding the permission through an All projects assignment.
 */
export function canInMerchant(user: UserAccess, action: ProjectAction, merchantId: string): boolean {
  if (user.level === 'SUPER_ADMIN') return true
  if (user.level === 'PLATFORM_STAFF') return action === 'viewAudit' && staffCan(user, 'viewAudit', merchantId)
  return user.merchantId === merchantId && any(merchantWidePermissions(user.grants), NEEDS[action])
}

export function canOnPlatform(user: UserAccess, action: PlatformAction): boolean {
  if (user.level === 'SUPER_ADMIN') return true
  return user.level === 'PLATFORM_STAFF' && any(staffPlatformPermissions(user.grants), STAFF_PLATFORM_NEEDS[action])
}

/**
 * Projects where the user may do `action`: the project switcher, "All my projects" case lists and dashboard scope (DEC-86).
 * REQ: DEC-72 — services return "not found" for a case whose project is not in this list.
 */
export function projectsWhere<P extends Where>(user: UserAccess, action: ProjectAction, projects: readonly P[]): P[] {
  return projects.filter((p) => canInProject(user, action, p))
}

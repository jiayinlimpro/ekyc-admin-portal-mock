// Access checks (DEC-70, DEC-72, DEC-75, DEC-86, DEC-99, DEC-104). Three account types:
// - Super admin: everything, everywhere (outside the role system).
// - Platform staff: one platform role, no scope: platform-wide permissions and merchant-data permissions everywhere.
// - Merchant user: their merchant role (whole merchant) plus their project roles (Members), inside their own merchant.
// REQ: DEC-71 — UI-only checks. The real backend must enforce the same rules.
import { coversProject, merchantWidePermissions, permissionsIn, roleNamesIn, staffMerchantPermissions, staffPlatformPermissions } from './roles'
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
  // REQ: DEC-102 — merchant-level, one per action.
  'createProjects',
  'renameProjects',
  'archiveProjects',
  'viewUsers',
  'inviteUsers', // and resend the invitation
  'changeUserRole', // the user's merchant role (DEC-104)
  'suspendUsers', // and reactivate
  'viewRoles',
  'createRoles', // and duplicate
  'editRoles',
  'changeRoleStatus', // activate, deactivate
  'manageBilling',
  'viewMerchantReports',
  // Project-level.
  'viewMembers', // Members tab of a project (DEC-77)
  'manageMembers',
  // REQ: DEC-104 — the project's own role table (Project Settings › Roles).
  'viewProjectRoles',
  'createProjectRoles',
  'editProjectRoles',
  'changeProjectRoleStatus',
  'viewIntegration', // Integration tab, read-only
  'manageIntegration', // API keys, webhook, redirect URLs, IP allowlist
  'viewProjectSettings', // General and Review operations, read-only
  'manageProjectSettings', // General and Review operations (DEC-54)
  'viewFlows', // Flows List / Detail, read-only
  'createFlows', // and duplicate
  'editFlows',
  'activateFlows', // activate, retire, set default
  'changeVerificationLevel', // thresholds, retries allowed, risk level
  'setAdvancedThresholds', // DEC-19: Super admin, or platform staff who may calibrate (DEC-99)
  'viewRouting',
  'viewCases', // the Verifications list (DEC-104: View list)
  'viewCaseDetails', // the case page with personal data (View details); every open audited (DEC-41)
  'claimCase', // claim and release
  'decideCase', // only on the user's own claim (claimRules)
  'viewAudit',
] as const
export type ProjectAction = (typeof PROJECT_ACTIONS)[number]

const FLOWS: readonly Permission[] = ['VIEW_FLOWS', 'CREATE_FLOWS', 'EDIT_FLOWS', 'ACTIVATE_FLOWS', 'CHANGE_VERIFICATION_LEVEL']
const SETTINGS: readonly Permission[] = ['VIEW_PROJECT_SETTINGS', 'MANAGE_PROJECT_SETTINGS']

// REQ: DEC-70 / DEC-102 — the merchant permission behind each action (any one is enough). A View action is also met by
// any action of its module (the Roles screen ticks the View with it anyway). Empty = not for merchant users.
const NEEDS: Record<ProjectAction, readonly Permission[]> = {
  viewDashboards: ['VIEW_PROJECT_REPORTS', 'VIEW_MERCHANT_REPORTS'],
  viewBilling: ['VIEW_PROJECT_REPORTS', 'VIEW_MERCHANT_REPORTS', 'VIEW_BILLING', 'MANAGE_BILLING'],
  exportReports: ['EXPORT_PROJECT_REPORTS', 'EXPORT_MERCHANT_REPORTS'],
  createProjects: ['CREATE_PROJECTS'],
  renameProjects: ['RENAME_PROJECTS'],
  archiveProjects: ['ARCHIVE_PROJECTS'],
  viewUsers: ['VIEW_USERS', 'INVITE_USERS', 'CHANGE_USER_ROLE', 'SUSPEND_USERS'],
  inviteUsers: ['INVITE_USERS'],
  changeUserRole: ['CHANGE_USER_ROLE'],
  suspendUsers: ['SUSPEND_USERS'],
  viewRoles: ['VIEW_ROLES', 'CREATE_ROLES', 'EDIT_ROLES', 'CHANGE_ROLE_STATUS'],
  createRoles: ['CREATE_ROLES'],
  editRoles: ['EDIT_ROLES'],
  changeRoleStatus: ['CHANGE_ROLE_STATUS'],
  manageBilling: ['MANAGE_BILLING'],
  viewMerchantReports: ['VIEW_MERCHANT_REPORTS'],
  viewMembers: ['VIEW_MEMBERS', 'MANAGE_MEMBERS'],
  manageMembers: ['MANAGE_MEMBERS'],
  viewProjectRoles: ['VIEW_PROJECT_ROLES', 'CREATE_PROJECT_ROLES', 'EDIT_PROJECT_ROLES', 'CHANGE_PROJECT_ROLE_STATUS'],
  createProjectRoles: ['CREATE_PROJECT_ROLES'],
  editProjectRoles: ['EDIT_PROJECT_ROLES'],
  changeProjectRoleStatus: ['CHANGE_PROJECT_ROLE_STATUS'],
  viewIntegration: ['VIEW_INTEGRATION', 'MANAGE_INTEGRATION'],
  manageIntegration: ['MANAGE_INTEGRATION'],
  viewProjectSettings: SETTINGS,
  manageProjectSettings: ['MANAGE_PROJECT_SETTINGS'],
  viewFlows: FLOWS,
  createFlows: ['CREATE_FLOWS'],
  editFlows: ['EDIT_FLOWS'],
  activateFlows: ['ACTIVATE_FLOWS'],
  changeVerificationLevel: ['CHANGE_VERIFICATION_LEVEL'],
  setAdvancedThresholds: [],
  viewRouting: [...FLOWS, ...SETTINGS],
  viewCases: ['VIEW_CASE_LIST', 'VIEW_CASE_DETAILS', 'CLAIM_CASES', 'DECIDE_CASES'],
  viewCaseDetails: ['VIEW_CASE_DETAILS', 'CLAIM_CASES', 'DECIDE_CASES'],
  claimCase: ['CLAIM_CASES', 'DECIDE_CASES'],
  decideCase: ['DECIDE_CASES'],
  viewAudit: ['VIEW_AUDIT_LOG'],
}

// REQ: DEC-99 / DEC-104 — what platform staff need: a platform-wide permission or a merchant-data one (both everywhere).
const STAFF_NEEDS: Partial<Record<ProjectAction, { platform?: readonly Permission[]; merchant?: readonly Permission[] }>> = {
  viewDashboards: { platform: ['P_REPORTS_VIEW'] },
  viewBilling: { platform: ['P_BILLING_VIEW'] },
  exportReports: { platform: ['P_REPORTS_EXPORT'] },
  viewCases: { merchant: ['P_CASES_LIST', 'P_CASES_DETAILS', 'P_CASES_CLAIM', 'P_CASES_DECIDE'] },
  viewCaseDetails: { merchant: ['P_CASES_DETAILS', 'P_CASES_CLAIM', 'P_CASES_DECIDE'] },
  claimCase: { merchant: ['P_CASES_CLAIM', 'P_CASES_DECIDE'] },
  decideCase: { merchant: ['P_CASES_DECIDE'] },
  viewFlows: { merchant: ['P_FLOWS_VIEW', 'P_FLOWS_CREATE', 'P_FLOWS_EDIT', 'P_FLOWS_ACTIVATE', 'P_FLOWS_LEVEL'] },
  createFlows: { merchant: ['P_FLOWS_CREATE'] },
  editFlows: { merchant: ['P_FLOWS_EDIT'] },
  activateFlows: { merchant: ['P_FLOWS_ACTIVATE'] },
  changeVerificationLevel: { merchant: ['P_FLOWS_LEVEL'] },
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

function staffCan(user: UserAccess, action: ProjectAction): boolean {
  const need = STAFF_NEEDS[action]
  if (!need) return false
  return any(staffPlatformPermissions(user.grants), need.platform) || any(staffMerchantPermissions(user.grants), need.merchant)
}

/** REQ: DEC-72 — the user reaches the project at all; outside it, the project and its cases are "not found". */
export function hasProject(user: UserAccess, project: Where): boolean {
  if (user.level === 'SUPER_ADMIN') return true
  if (user.level === 'PLATFORM_STAFF') return PROJECT_ACTIONS.some((a) => staffCan(user, a))
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
  if (user.level === 'PLATFORM_STAFF') return [...new Set(user.grants.map((g) => g.roleName))]
  return user.merchantId === project.merchantId ? roleNamesIn(user.grants, project.projectId) : []
}

export function canInProject(user: UserAccess, action: ProjectAction, project: Where): boolean {
  if (user.level === 'SUPER_ADMIN') return true
  if (user.level === 'PLATFORM_STAFF') return staffCan(user, action)
  return any(permissionsInProject(user, project), NEEDS[action])
}

/**
 * Merchant-wide actions (create a project, manage users and roles, merchant-level audit entries): Super admin, platform
 * staff for the audit log of merchants they cover, or a user holding the permission through an All projects assignment.
 */
export function canInMerchant(user: UserAccess, action: ProjectAction, merchantId: string): boolean {
  if (user.level === 'SUPER_ADMIN') return true
  if (user.level === 'PLATFORM_STAFF') return action === 'viewAudit' && staffCan(user, 'viewAudit')
  return user.merchantId === merchantId && any(merchantWidePermissions(user.grants), NEEDS[action])
}

export function canOnPlatform(user: UserAccess, action: PlatformAction): boolean {
  if (user.level === 'SUPER_ADMIN') return true
  return user.level === 'PLATFORM_STAFF' && any(staffPlatformPermissions(user.grants), STAFF_PLATFORM_NEEDS[action])
}

/** Any of several actions (a screen whose tabs need different permissions, e.g. Project Settings). */
export function canAnyInProject(user: UserAccess, actions: ProjectAction | readonly ProjectAction[], project: Where): boolean {
  return (typeof actions === 'string' ? [actions] : actions).some((a) => canInProject(user, a, project))
}

/**
 * Projects where the user may do `action`: the project switcher, "All my projects" case lists and dashboard scope (DEC-86).
 * REQ: DEC-72 — services return "not found" for a case whose project is not in this list.
 */
export function projectsWhere<P extends Where>(user: UserAccess, action: ProjectAction, projects: readonly P[]): P[] {
  return projects.filter((p) => canInProject(user, action, p))
}

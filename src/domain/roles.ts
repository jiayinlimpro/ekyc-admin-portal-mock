// Roles, permissions and scoped assignments (DEC-70, DEC-74, DEC-76, DEC-77). Pure rules; the services apply them.
// REQ: DEC-71 — UI-only checks. The real backend must enforce the same rules.
import {
  MERCHANT_PERMISSIONS,
  PERMISSIONS,
  PROJECT_PERMISSIONS,
  type AssignmentScope,
  type Grant,
  type Permission,
  type Role,
  type RoleAssignment,
  type RuleError,
} from './types'

// REQ: DEC-70 — the System Default roles. Names and permissions are OQ-09 (the FRS access matrix is not available).
export const SYSTEM_ROLE_IDS = {
  MERCHANT_OWNER: 'ROL-2026-0001',
  PROJECT_ADMIN: 'ROL-2026-0002',
  REVIEWER: 'ROL-2026-0003',
  VIEWER: 'ROL-2026-0004',
} as const

export const SYSTEM_DEFAULT_ROLES: readonly Pick<Role, 'roleId' | 'name' | 'permissions'>[] = [
  { roleId: SYSTEM_ROLE_IDS.MERCHANT_OWNER, name: 'Merchant Owner', permissions: [...PERMISSIONS] },
  { roleId: SYSTEM_ROLE_IDS.PROJECT_ADMIN, name: 'Project Admin', permissions: [...PROJECT_PERMISSIONS] },
  { roleId: SYSTEM_ROLE_IDS.REVIEWER, name: 'Reviewer', permissions: ['VIEW_CASES', 'CLAIM_CASES', 'DECIDE_CASES', 'VIEW_PROJECT_REPORTS'] },
  { roleId: SYSTEM_ROLE_IDS.VIEWER, name: 'Viewer', permissions: ['VIEW_CASES', 'VIEW_PROJECT_REPORTS'] },
]

/** REQ: DEC-70 / DEC-75 — Platform Admin (internal) in any merchant: never API keys / webhooks, never claim or decide. Cases: OQ-20. */
export const PLATFORM_ADMIN_PERMISSIONS: readonly Permission[] = [
  'MANAGE_USERS_ROLES',
  'MANAGE_PROJECTS',
  'VIEW_MERCHANT_REPORTS',
  'MANAGE_PROJECT_SETTINGS',
  'MANAGE_FLOWS',
  'CHANGE_VERIFICATION_LEVEL',
  'MANAGE_MEMBERS',
  'VIEW_PROJECT_REPORTS',
  'VIEW_AUDIT_LOG',
]

const MERCHANT_LEVEL: ReadonlySet<Permission> = new Set(MERCHANT_PERMISSIONS)

export const isMerchantLevel = (permissions: readonly Permission[]) => permissions.some((p) => MERCHANT_LEVEL.has(p))

/** REQ: DEC-70 — Claim and Approve / reject need View cases, so it is ticked with them. Returns the catalogue order. */
export function withImpliedPermissions(permissions: readonly Permission[]): Permission[] {
  const set = new Set(permissions)
  if (set.has('CLAIM_CASES') || set.has('DECIDE_CASES')) set.add('VIEW_CASES')
  return PERMISSIONS.filter((p) => set.has(p))
}

export type { Grant }

/** Assignments with their roles; an inactive or unknown role grants nothing. */
export function grantsOf(assignments: readonly RoleAssignment[], roles: readonly Role[]): Grant[] {
  return assignments.flatMap((a) => {
    const role = roles.find((r) => r.roleId === a.roleId && r.status === 'ACTIVE')
    return role ? [{ roleId: role.roleId, roleName: role.name, permissions: role.permissions, scope: a.scope }] : []
  })
}

export const covers = (scope: AssignmentScope, projectId: string) => scope.kind === 'ALL_PROJECTS' || scope.projectIds.includes(projectId)

/** REQ: DEC-70 — the union of every grant covering the project; merchant-level permissions only count from All projects. */
export function permissionsIn(grants: readonly Grant[], projectId: string): Set<Permission> {
  return new Set(grants.filter((g) => covers(g.scope, projectId)).flatMap((g) => g.permissions.filter((p) => g.scope.kind === 'ALL_PROJECTS' || !MERCHANT_LEVEL.has(p))))
}

/** Permissions that hold in every project, current and future: the union of the All projects grants. */
export function merchantWidePermissions(grants: readonly Grant[]): Set<Permission> {
  return new Set(grants.filter((g) => g.scope.kind === 'ALL_PROJECTS').flatMap((g) => g.permissions))
}

/** Role names the user holds in a project, e.g. ["Reviewer"]; for the header, Members tab and audit entries. */
export function roleNamesIn(grants: readonly Grant[], projectId: string): string[] {
  return [...new Set(grants.filter((g) => covers(g.scope, projectId)).map((g) => g.roleName))]
}

/** True when the grants cover the project at all (DEC-72: otherwise the project and its cases are "not found"). */
export const coversProject = (grants: readonly Grant[], projectId: string) => grants.some((g) => covers(g.scope, projectId))

/** REQ: DEC-74 — one access chip, written the same on every screen: "Reviewer · SME app", "Merchant Owner · All projects". */
export const chipLabel = (roleName: string, scope: AssignmentScope, projectName: (projectId: string) => string) => `${roleName} · ${scopeLabel(scope, projectName)}`

export interface AccessChip {
  label: string
  /** Every project in the scope is archived: the row is read-only (DEC-77). */
  archived: boolean
}

export const allArchived = (scope: AssignmentScope, isArchived: (projectId: string) => boolean) => scope.kind === 'PROJECTS' && scope.projectIds.length > 0 && scope.projectIds.every(isArchived)

/** The Users list Access column (DEC-74). */
export function accessChips(grants: readonly Pick<Grant, 'roleName' | 'scope'>[], projectName: (projectId: string) => string, isArchived: (projectId: string) => boolean): AccessChip[] {
  return grants.map((g) => ({ label: chipLabel(g.roleName, g.scope, projectName), archived: allArchived(g.scope, isArchived) }))
}

/** The chips as one line, e.g. for the mock login: "Reviewer · Default; Viewer · SME app". */
export function accessSummary(grants: readonly Grant[], projectName: (projectId: string) => string): string {
  return grants.map((g) => chipLabel(g.roleName, g.scope, projectName)).join('; ')
}

export function scopeLabel(scope: AssignmentScope, projectName: (projectId: string) => string): string {
  return scope.kind === 'ALL_PROJECTS' ? 'All projects' : scope.projectIds.map(projectName).join(', ')
}

/**
 * REQ: DEC-74 — nobody grants permissions they don't have: for All projects the granter needs them in every project
 * (an All projects grant); for selected projects, in each of those projects. Platform Admin sets up merchants and their
 * first owner, so this rule does not limit them.
 */
export function canGrant(granter: 'PLATFORM_ADMIN' | readonly Grant[], permissions: readonly Permission[], scope: AssignmentScope): boolean {
  if (granter === 'PLATFORM_ADMIN') return true
  const holds = (have: Set<Permission>) => permissions.every((p) => have.has(p))
  if (scope.kind === 'ALL_PROJECTS') return holds(merchantWidePermissions(granter))
  return scope.projectIds.every((id) => holds(permissionsIn(granter, id)))
}

export const GRANT_TOO_POWERFUL = 'You can only give access you have yourself.'
export const MERCHANT_LEVEL_SCOPE = 'This role includes merchant-level permissions, so it can only be given for All projects.'

/** REQ: DEC-70 / DEC-77 — scope rules for a new or edited assignment. `openProjectIds`: the merchant's non-archived projects. */
export function validateAssignment(role: Pick<Role, 'permissions' | 'status'>, scope: AssignmentScope, openProjectIds: readonly string[]): RuleError[] {
  if (role.status !== 'ACTIVE') return [{ field: 'roleId', message: 'This role is inactive.' }]
  if (scope.kind === 'ALL_PROJECTS') return []
  if (isMerchantLevel(role.permissions)) return [{ field: 'scope', message: MERCHANT_LEVEL_SCOPE }]
  if (!scope.projectIds.length) return [{ field: 'scope', message: 'Choose at least one project.' }]
  if (scope.projectIds.some((id) => !openProjectIds.includes(id))) return [{ field: 'scope', message: 'Archived projects keep their members but take no new ones.' }]
  return []
}

export const ROLE_NEEDS_PERMISSION = 'Roles require at least one action permission flag'
export const ROLE_IN_USE = 'Operation rejected. This role is currently assigned to active records inside the system.'

/**
 * REQ: DEC-76 — create or edit a Custom role. `others`: the roles the merchant sees (System Default + its own);
 * `heldForSelectedProjects`: whether any assignment of this role is scoped to selected projects.
 */
export function validateRole(
  input: { name: string; permissions: readonly Permission[] },
  others: readonly Pick<Role, 'roleId' | 'name'>[],
  current?: Pick<Role, 'roleId' | 'type'> & { heldForSelectedProjects: boolean },
): RuleError[] {
  if (current?.type === 'SYSTEM_DEFAULT') return [{ field: 'name', message: 'System Default roles can’t be changed.' }]
  const errors: RuleError[] = []
  const name = input.name.trim()
  if (!name) errors.push({ field: 'name', message: 'Enter a role name.' })
  else if (others.some((r) => r.roleId !== current?.roleId && r.name.trim().toLowerCase() === name.toLowerCase())) {
    errors.push({ field: 'name', message: 'A role with this name already exists.' })
  }
  if (!input.permissions.length) errors.push({ field: 'permissions', message: ROLE_NEEDS_PERMISSION })
  else if (current?.heldForSelectedProjects && isMerchantLevel(input.permissions)) {
    errors.push({ field: 'permissions', message: 'This role is given for selected projects, so it can’t include merchant-level permissions.' })
  }
  return errors
}

/** REQ: DEC-76 — System Default roles are locked; a role still assigned can't be deactivated. */
export function validateRoleStatus(role: Pick<Role, 'type'>, to: Role['status'], holders: number): RuleError[] {
  if (role.type === 'SYSTEM_DEFAULT') return [{ field: 'status', message: 'System Default roles can’t be changed.' }]
  if (to === 'INACTIVE' && holders > 0) return [{ field: 'status', message: ROLE_IN_USE }]
  return []
}

/** Users holding a role in any assignment: the Roles list "Users" column and "Affects N users" (DEC-76). */
export function holdersOf<U extends { assignments: readonly RoleAssignment[] }>(roleId: string, users: readonly U[]): U[] {
  return users.filter((u) => u.assignments.some((a) => a.roleId === roleId))
}

const isOwnerAssignment = (a: RoleAssignment) => a.roleId === SYSTEM_ROLE_IDS.MERCHANT_OWNER && a.scope.kind === 'ALL_PROJECTS'

/**
 * REQ: DEC-74 — at least one Merchant Owner (All projects) must remain. Pass the merchant's users that are not suspended,
 * before and after the change. A merchant that had none (e.g. its owner is still Pending) is not blocked.
 */
export function lastOwnerError(before: readonly { assignments: readonly RoleAssignment[] }[], after: readonly { assignments: readonly RoleAssignment[] }[]): RuleError[] {
  const owners = (us: typeof before) => us.filter((u) => u.assignments.some(isOwnerAssignment)).length
  return owners(before) > 0 && owners(after) === 0 ? [{ field: 'roleId', message: 'This merchant needs at least one Merchant Owner with All projects access.' }] : []
}

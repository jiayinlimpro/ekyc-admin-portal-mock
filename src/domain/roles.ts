// Roles, permissions and where they apply (DEC-70, DEC-74, DEC-76, DEC-77, DEC-104). Pure rules; the services apply them.
// REQ: DEC-71 — UI-only checks. The real backend must enforce the same rules.
import {
  MERCHANT_DATA_PERMISSIONS,
  MERCHANT_PERMISSIONS,
  MERCHANT_ROLE_PERMISSIONS,
  PERMISSIONS,
  PLATFORM_LEVEL_PERMISSIONS,
  PLATFORM_ROLE_PERMISSIONS,
  PROJECT_PERMISSIONS,
  type RoleAudience,
  type RoleLevel,
  type AssignmentScope,
  type Grant,
  type Permission,
  type Role,
  type RoleAssignment,
  type RuleError,
} from './types'
import { IMPLIES } from './permissionMatrix'
import { fx } from '@/lib/ids'

// REQ: DEC-104 — the System Default merchant roles (locked; duplicate to adapt). Names and permissions are OQ-09.
export const SYSTEM_ROLE_IDS = {
  OWNER: fx('ROL-2026-0001'),
  PROJECT_ADMIN: fx('ROL-2026-0002'),
  REVIEWER: fx('ROL-2026-0003'),
  VIEWER: fx('ROL-2026-0004'),
  ADMIN: fx('ROL-2026-0010'),
  BILLING: fx('ROL-2026-0011'),
  AUDITOR: fx('ROL-2026-0012'),
  MEMBER: fx('ROL-2026-0013'),
  DEVELOPER: fx('ROL-2026-0014'),
} as const

const PROJECT_ALL: Permission[] = [...PROJECT_PERMISSIONS]
const REPORTS: Permission[] = ['VIEW_PROJECT_REPORTS', 'EXPORT_PROJECT_REPORTS']

// Usually given on Users (whole merchant), then those usually given in Project › Members.
// REQ: DEC-104 — merchant roles (Users) first, then project roles (Project › Members, in every project).
export const SYSTEM_DEFAULT_ROLES: readonly Pick<Role, 'roleId' | 'name' | 'permissions' | 'level'>[] = [
  { roleId: SYSTEM_ROLE_IDS.OWNER, name: 'Owner', level: 'MERCHANT', permissions: [...MERCHANT_ROLE_PERMISSIONS] },
  {
    roleId: SYSTEM_ROLE_IDS.ADMIN,
    name: 'Admin',
    level: 'MERCHANT',
    permissions: [...MERCHANT_PERMISSIONS.filter((p) => p !== 'VIEW_BILLING' && p !== 'MANAGE_BILLING'), ...PROJECT_ALL],
  },
  { roleId: SYSTEM_ROLE_IDS.BILLING, name: 'Billing', level: 'MERCHANT', permissions: ['VIEW_BILLING', 'MANAGE_BILLING'] },
  { roleId: SYSTEM_ROLE_IDS.AUDITOR, name: 'Auditor', level: 'MERCHANT', permissions: ['VIEW_MERCHANT_REPORTS', 'EXPORT_MERCHANT_REPORTS', 'VIEW_CASE_LIST', 'VIEW_AUDIT_LOG'] },
  { roleId: SYSTEM_ROLE_IDS.MEMBER, name: 'Member', level: 'MERCHANT', permissions: [] }, // the default on New user: access only through Members
  { roleId: SYSTEM_ROLE_IDS.PROJECT_ADMIN, name: 'Project Admin', level: 'PROJECT', permissions: [...PROJECT_ALL] },
  { roleId: SYSTEM_ROLE_IDS.REVIEWER, name: 'Reviewer', level: 'PROJECT', permissions: ['VIEW_CASE_LIST', 'VIEW_CASE_DETAILS', 'CLAIM_CASES', 'DECIDE_CASES', 'VIEW_FLOWS', ...REPORTS] },
  { roleId: SYSTEM_ROLE_IDS.DEVELOPER, name: 'Developer', level: 'PROJECT', permissions: ['VIEW_FLOWS', 'VIEW_INTEGRATION', 'MANAGE_INTEGRATION'] },
  { roleId: SYSTEM_ROLE_IDS.VIEWER, name: 'Viewer', level: 'PROJECT', permissions: ['VIEW_CASE_LIST', 'VIEW_CASE_DETAILS', 'VIEW_FLOWS', ...REPORTS] },
]

/** REQ: DEC-104 — the merchant role a New user starts with. */
export const DEFAULT_MERCHANT_ROLE_ID = SYSTEM_ROLE_IDS.MEMBER

// REQ: DEC-104 — System Default platform roles; staff have one role and no scope (every merchant).
export const PLATFORM_ROLE_IDS = {
  PLATFORM_ADMIN: fx('ROL-2026-0106'),
  SUPPORT: fx('ROL-2026-0102'),
  IMPLEMENTATION: fx('ROL-2026-0101'),
  FINANCE: fx('ROL-2026-0104'),
} as const

export const PLATFORM_DEFAULT_ROLES: readonly Pick<Role, 'roleId' | 'name' | 'permissions'>[] = [
  { roleId: PLATFORM_ROLE_IDS.PLATFORM_ADMIN, name: 'Platform Admin', permissions: [...PLATFORM_ROLE_PERMISSIONS] },
  // No decisions, no changes; the audit log is the oversight for case pages (DEC-104).
  { roleId: PLATFORM_ROLE_IDS.SUPPORT, name: 'Support', permissions: ['P_CASES_LIST', 'P_CASES_DETAILS', 'P_FLOWS_VIEW', 'P_INTEGRATION_VIEW', 'P_AUDIT_VIEW'] },
  {
    roleId: PLATFORM_ROLE_IDS.IMPLEMENTATION,
    name: 'Implementation',
    permissions: [
      'P_MERCHANTS_VIEW',
      'P_MERCHANTS_CREATE',
      'P_REGISTRY_VIEW',
      'P_REGISTRY_MANAGE',
      'P_LEVELS_VIEW',
      'P_LEVELS_CALIBRATE',
      'P_FLOWS_VIEW',
      'P_FLOWS_CREATE',
      'P_FLOWS_EDIT',
      'P_FLOWS_ACTIVATE',
      'P_FLOWS_LEVEL',
      'P_INTEGRATION_VIEW',
      'P_INTEGRATION_MANAGE',
    ],
  },
  { roleId: PLATFORM_ROLE_IDS.FINANCE, name: 'Finance', permissions: ['P_BILLING_VIEW', 'P_BILLING_MANAGE', 'P_REPORTS_VIEW', 'P_REPORTS_EXPORT'] },
]

/** REQ: DEC-99 / DEC-104 — the permissions a role may hold: platform; merchant role (every module); project role (project modules). */
export const permissionsFor = (audience: RoleAudience, level: RoleLevel = 'MERCHANT'): readonly Permission[] =>
  audience === 'PLATFORM' ? PLATFORM_ROLE_PERMISSIONS : level === 'PROJECT' ? PROJECT_PERMISSIONS : MERCHANT_ROLE_PERMISSIONS

const PLATFORM_LEVEL: ReadonlySet<Permission> = new Set(PLATFORM_LEVEL_PERMISSIONS)
const MERCHANT_DATA: ReadonlySet<Permission> = new Set(MERCHANT_DATA_PERMISSIONS)

/** REQ: DEC-70 / DEC-75 — Super admin (internal): every permission, in every merchant. */
export const SUPER_ADMIN_PERMISSIONS: readonly Permission[] = [...PERMISSIONS]

const MERCHANT_LEVEL: ReadonlySet<Permission> = new Set(MERCHANT_PERMISSIONS)

/** REQ: DEC-104 — a role with merchant-wide permissions: only given on Users, never in Project › Members. */
export const isMerchantLevel = (permissions: readonly Permission[]) => permissions.some((p) => MERCHANT_LEVEL.has(p))

/**
 * REQ: DEC-70 / DEC-102 — every action ticks its module's View (Claim ticks View cases), plus the few actions that need
 * another one (permissionMatrix.IMPLIES). Returns the catalogue order.
 */
export function withImpliedPermissions(permissions: readonly Permission[]): Permission[] {
  const set = new Set(permissions)
  const add = (p: Permission) => IMPLIES.get(p)?.forEach((q) => !set.has(q) && (set.add(q), add(q)))
  for (const p of permissions) add(p)
  return PERMISSIONS.filter((p) => set.has(p))
}

/** The permissions that `permission` ticks (shown locked while it is ticked, DEC-70 / DEC-99). */
export function impliedBy(permissions: readonly Permission[]): Set<Permission> {
  const out = new Set<Permission>()
  for (const p of permissions) for (const q of withImpliedPermissions([p])) if (q !== p) out.add(q)
  return out
}

export type { Grant }

/** REQ: DEC-99 / OQ-31 — whether an email is on the company staff domain. */
export const isStaffEmail = (email: string, domain: string) => email.trim().toLowerCase().endsWith(`@${domain.toLowerCase()}`)

/** Assignments with their roles; an inactive or unknown role grants nothing. */
export function grantsOf(assignments: readonly RoleAssignment[], roles: readonly Role[]): Grant[] {
  return assignments.flatMap((a) => {
    const role = roles.find((r) => r.roleId === a.roleId && r.status === 'ACTIVE')
    return role ? [{ roleId: role.roleId, roleName: role.name, permissions: role.permissions, scope: a.scope }] : []
  })
}

export const covers = (scope: AssignmentScope, projectId: string) => scope.kind === 'ALL_PROJECTS' || (scope.kind === 'PROJECTS' && scope.projectIds.includes(projectId))


/** Platform staff: their platform-level permissions (from any grant; they don't depend on merchants). */
export function staffPlatformPermissions(grants: readonly Grant[]): Set<Permission> {
  return new Set(grants.flatMap((g) => g.permissions.filter((p) => PLATFORM_LEVEL.has(p))))
}

/** REQ: DEC-104 — platform staff: their merchant-data permissions, the same in every merchant (no scope). */
export function staffMerchantPermissions(grants: readonly Grant[]): Set<Permission> {
  return new Set(grants.flatMap((g) => g.permissions.filter((p) => MERCHANT_DATA.has(p))))
}

/** REQ: DEC-104 — the union of the merchant role and the project roles covering the project; merchant-wide permissions only count from the merchant role. */
export function permissionsIn(grants: readonly Grant[], projectId: string): Set<Permission> {
  return new Set(grants.filter((g) => covers(g.scope, projectId)).flatMap((g) => g.permissions.filter((p) => g.scope.kind === 'ALL_PROJECTS' || !MERCHANT_LEVEL.has(p))))
}

/**
 * REQ: DEC-74 — Effective access: each permission the user has in a project and every grant it comes from, in catalogue
 * order. Merchant-level permissions only come from All projects grants (as in `permissionsIn`).
 */
export function effectivePermissions<G extends Grant>(grants: readonly G[], projectId: string): { permission: Permission; from: G[] }[] {
  const counts = (g: G, p: Permission) => covers(g.scope, projectId) && g.permissions.includes(p) && (g.scope.kind === 'ALL_PROJECTS' || !MERCHANT_LEVEL.has(p))
  return PERMISSIONS.map((permission) => ({ permission, from: grants.filter((g) => counts(g, permission)) })).filter((x) => x.from.length > 0)
}

/** Permissions that hold in every project, current and future: the union of the All projects grants. */
export function merchantWidePermissions(grants: readonly Grant[]): Set<Permission> {
  return new Set(grants.filter((g) => g.scope.kind === 'ALL_PROJECTS').flatMap((g) => g.permissions))
}

/** Role names the user holds in a project, e.g. ["Reviewer"]; for the header, Members tab and audit entries. */
export function roleNamesIn(grants: readonly Grant[], projectId: string): string[] {
  return [...new Set(grants.filter((g) => reaches(g, projectId)).map((g) => g.roleName))]
}

/** REQ: DEC-104 — a grant opens a project only if it gives something there: Member (no permissions) opens nothing. */
const reaches = (g: Grant, projectId: string) => covers(g.scope, projectId) && g.permissions.length > 0

/** True when the grants cover the project at all (DEC-72: otherwise the project and its cases are "not found"). */
export const coversProject = (grants: readonly Grant[], projectId: string) => grants.some((g) => reaches(g, projectId))

/** REQ: DEC-74 — one access chip, written the same on every screen: "Reviewer · SME app", "Owner · All projects". */
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
  switch (scope.kind) {
    case 'ALL_PROJECTS':
      return 'All projects'
    case 'PROJECTS':
      return scope.projectIds.map(projectName).join(', ')
    case 'ALL_MERCHANTS':
      return 'All merchants'
  }
}

/**
 * REQ: DEC-74 — nobody grants permissions they don't have: for All projects the granter needs them in every project
 * (an All projects grant); for selected projects, in each of those projects. Super admin sets up merchants and their
 * first owner, so this rule does not limit them.
 */
export function canGrant(granter: 'SUPER_ADMIN' | readonly Grant[], permissions: readonly Permission[], scope: AssignmentScope): boolean {
  if (granter === 'SUPER_ADMIN') return true
  // REQ: DEC-99 — only super admins give platform access.
  if (scope.kind === 'ALL_MERCHANTS') return false
  const holds = (have: Set<Permission>) => permissions.every((p) => have.has(p))
  if (scope.kind === 'ALL_PROJECTS') return holds(merchantWidePermissions(granter))
  return scope.projectIds.every((id) => holds(permissionsIn(granter, id)))
}

export const GRANT_TOO_POWERFUL = 'You can only give access you have yourself.'
export const MERCHANT_LEVEL_SCOPE = 'Merchant roles are given on Users, not in Project › Members.'
export const PROJECT_ROLE_ON_USERS = 'Project roles are given in Project › Members, not on Users.'
export const OTHER_PROJECT_ROLE = 'This role belongs to another project.'

export const WRONG_ROLE_TYPE = 'Platform roles are for platform users; merchant roles are for that merchant’s users.'

/**
 * REQ: DEC-104 — rules for giving a role. Platform roles: platform staff only, for every merchant (`ALL_MERCHANTS`).
 * Merchant roles: on Users only, for the whole merchant (`ALL_PROJECTS`). Project roles: in Project › Members only, for
 * one open project (a Custom project role only in its own project). `openProjectIds`: the merchant's non-archived projects.
 */
export function validateAssignment(role: Pick<Role, 'status' | 'audience' | 'level' | 'projectId'>, scope: AssignmentScope, openProjectIds: readonly string[]): RuleError[] {
  if (role.status !== 'ACTIVE') return [{ field: 'roleId', message: 'This role is inactive.' }]
  if ((role.audience === 'PLATFORM') !== (scope.kind === 'ALL_MERCHANTS')) return [{ field: 'roleId', message: WRONG_ROLE_TYPE }]
  if (scope.kind === 'ALL_MERCHANTS') return []
  if (scope.kind === 'ALL_PROJECTS') return role.level === 'PROJECT' ? [{ field: 'roleId', message: PROJECT_ROLE_ON_USERS }] : []
  if (role.level !== 'PROJECT') return [{ field: 'roleId', message: MERCHANT_LEVEL_SCOPE }]
  if (scope.projectIds.length !== 1) return [{ field: 'scope', message: 'A project role is for one project.' }]
  if (role.projectId && role.projectId !== scope.projectIds[0]) return [{ field: 'roleId', message: OTHER_PROJECT_ROLE }]
  if (!openProjectIds.includes(scope.projectIds[0])) return [{ field: 'scope', message: 'Archived projects keep their members but take no new ones.' }]
  return []
}

export const ROLE_NEEDS_PERMISSION = 'Roles require at least one action permission flag'
export const ROLE_IN_USE = 'Operation rejected. This role is currently assigned to active records inside the system.'

/**
 * REQ: DEC-76 / DEC-104 — create or edit a Custom role. `others`: the roles of the same table (merchant roles of the
 * merchant, or the project roles of the project); names are unique within it.
 */
export function validateRole(
  input: { name: string; permissions: readonly Permission[]; audience?: RoleAudience; level?: RoleLevel },
  others: readonly Pick<Role, 'roleId' | 'name'>[],
  current?: Pick<Role, 'roleId' | 'type'>,
): RuleError[] {
  if (current?.type === 'SYSTEM_DEFAULT') return [{ field: 'name', message: 'System Default roles can’t be changed.' }]
  const errors: RuleError[] = []
  const name = input.name.trim()
  if (!name) errors.push({ field: 'name', message: 'Enter a role name.' })
  else if (others.some((r) => r.roleId !== current?.roleId && r.name.trim().toLowerCase() === name.toLowerCase())) {
    errors.push({ field: 'name', message: 'A role with this name already exists.' })
  }
  if (!input.permissions.length) errors.push({ field: 'permissions', message: ROLE_NEEDS_PERMISSION })
  else if (input.audience && input.permissions.some((p) => !permissionsFor(input.audience!, input.level).includes(p))) {
    errors.push({ field: 'permissions', message: input.level === 'PROJECT' ? 'Project roles hold project permissions only.' : 'These permissions don’t belong to this role type.' })
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

export const LAST_OWNER = 'At least one active Owner is required.'

const isOwnerAssignment = (a: RoleAssignment) => a.roleId === SYSTEM_ROLE_IDS.OWNER && a.scope.kind === 'ALL_PROJECTS'

/**
 * REQ: DEC-74 / DEC-104 — at least one Owner must remain. Pass the merchant's users that are not suspended,
 * before and after the change. A merchant that had none (e.g. its owner is still Pending) is not blocked.
 */
export function lastOwnerError(before: readonly { assignments: readonly RoleAssignment[] }[], after: readonly { assignments: readonly RoleAssignment[] }[]): RuleError[] {
  const owners = (us: typeof before) => us.filter((u) => u.assignments.some(isOwnerAssignment)).length
  return owners(before) > 0 && owners(after) === 0 ? [{ field: 'roleId', message: LAST_OWNER }] : []
}

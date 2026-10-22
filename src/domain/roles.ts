// Roles, permissions and scoped assignments (DEC-70, DEC-74, DEC-76, DEC-77). Pure rules; the services apply them.
// REQ: DEC-71 — UI-only checks. The real backend must enforce the same rules.
import {
  MERCHANT_ACCESS_PERMISSIONS,
  MERCHANT_PERMISSIONS,
  MERCHANT_ROLE_PERMISSIONS,
  PERMISSIONS,
  PLATFORM_LEVEL_PERMISSIONS,
  PLATFORM_ROLE_PERMISSIONS,
  PROJECT_PERMISSIONS,
  type RoleAudience,
  type AssignmentScope,
  type Grant,
  type Permission,
  type Role,
  type RoleAssignment,
  type RuleError,
} from './types'
import { fx } from '@/lib/ids'

// REQ: DEC-70 — the System Default roles. Names and permissions are OQ-09 (the FRS access matrix is not available).
export const SYSTEM_ROLE_IDS = {
  MERCHANT_OWNER: fx('ROL-2026-0001'),
  PROJECT_ADMIN: fx('ROL-2026-0002'),
  REVIEWER: fx('ROL-2026-0003'),
  VIEWER: fx('ROL-2026-0004'),
} as const

export const SYSTEM_DEFAULT_ROLES: readonly Pick<Role, 'roleId' | 'name' | 'permissions'>[] = [
  { roleId: SYSTEM_ROLE_IDS.MERCHANT_OWNER, name: 'Merchant Owner', permissions: [...MERCHANT_ROLE_PERMISSIONS] },
  { roleId: SYSTEM_ROLE_IDS.PROJECT_ADMIN, name: 'Project Admin', permissions: [...PROJECT_PERMISSIONS] },
  { roleId: SYSTEM_ROLE_IDS.REVIEWER, name: 'Reviewer', permissions: ['VIEW_CASES', 'CLAIM_CASES', 'DECIDE_CASES', 'VIEW_PROJECT_REPORTS'] },
  { roleId: SYSTEM_ROLE_IDS.VIEWER, name: 'Viewer', permissions: ['VIEW_CASES', 'VIEW_PROJECT_REPORTS'] },
]

// REQ: DEC-99 — System Default platform roles, chosen on least privilege: unmasked ID data and decisions only for case
// review; Finance sees no customer data; only Operations changes API keys.
export const PLATFORM_ROLE_IDS = {
  OPERATIONS: fx('ROL-2026-0101'),
  SUPPORT: fx('ROL-2026-0102'),
  VERIFICATION_SPECIALIST: fx('ROL-2026-0103'),
  FINANCE: fx('ROL-2026-0104'),
  WORKFLOW_ENGINEER: fx('ROL-2026-0105'),
} as const

export const PLATFORM_DEFAULT_ROLES: readonly Pick<Role, 'roleId' | 'name' | 'permissions'>[] = [
  {
    roleId: PLATFORM_ROLE_IDS.OPERATIONS,
    name: 'Platform Operations',
    permissions: ['P_MERCHANTS_VIEW', 'P_MERCHANTS_CREATE', 'P_MERCHANTS_SUSPEND', 'P_REGISTRY_VIEW', 'P_LEVELS_VIEW', 'P_REPORTS_VIEW', 'P_CASES_VIEW_MASKED', 'P_FLOWS_VIEW', 'P_FLOWS_EDIT', 'P_INTEGRATION_VIEW', 'P_INTEGRATION_MANAGE', 'P_AUDIT_VIEW'],
  },
  { roleId: PLATFORM_ROLE_IDS.SUPPORT, name: 'Support', permissions: ['P_MERCHANTS_VIEW', 'P_REPORTS_VIEW', 'P_CASES_VIEW_MASKED', 'P_FLOWS_VIEW', 'P_INTEGRATION_VIEW', 'P_AUDIT_VIEW'] },
  { roleId: PLATFORM_ROLE_IDS.VERIFICATION_SPECIALIST, name: 'Verification Specialist', permissions: ['P_CASES_VIEW_MASKED', 'P_CASES_VIEW_UNMASKED', 'P_CASES_DECIDE', 'P_AUDIT_VIEW'] },
  { roleId: PLATFORM_ROLE_IDS.FINANCE, name: 'Finance', permissions: ['P_MERCHANTS_VIEW', 'P_BILLING_VIEW', 'P_BILLING_MANAGE', 'P_REPORTS_VIEW', 'P_REPORTS_EXPORT'] },
  { roleId: PLATFORM_ROLE_IDS.WORKFLOW_ENGINEER, name: 'Workflow Engineer', permissions: ['P_REGISTRY_VIEW', 'P_REGISTRY_MANAGE', 'P_LEVELS_VIEW', 'P_LEVELS_CALIBRATE', 'P_REPORTS_VIEW', 'P_FLOWS_VIEW'] },
]

/** REQ: DEC-99 — the permissions a role of each Type may hold. */
export const permissionsFor = (audience: RoleAudience): readonly Permission[] => (audience === 'PLATFORM' ? PLATFORM_ROLE_PERMISSIONS : MERCHANT_ROLE_PERMISSIONS)

const PLATFORM_LEVEL: ReadonlySet<Permission> = new Set(PLATFORM_LEVEL_PERMISSIONS)
const MERCHANT_ACCESS: ReadonlySet<Permission> = new Set(MERCHANT_ACCESS_PERMISSIONS)

/** A platform role with no merchant-access permission needs no merchant scope ("This role has no merchant access permissions"). */
export const hasMerchantAccess = (permissions: readonly Permission[]) => permissions.some((p) => MERCHANT_ACCESS.has(p))

/** REQ: DEC-70 / DEC-75 — Super admin (internal): every permission, in every merchant. */
export const SUPER_ADMIN_PERMISSIONS: readonly Permission[] = [...PERMISSIONS]

const MERCHANT_LEVEL: ReadonlySet<Permission> = new Set(MERCHANT_PERMISSIONS)

export const isMerchantLevel = (permissions: readonly Permission[]) => permissions.some((p) => MERCHANT_LEVEL.has(p))

/** REQ: DEC-70 — Claim and Approve / reject need View cases, so it is ticked with them. Returns the catalogue order. */
export function withImpliedPermissions(permissions: readonly Permission[]): Permission[] {
  const set = new Set(permissions)
  if (set.has('CLAIM_CASES') || set.has('DECIDE_CASES')) set.add('VIEW_CASES')
  // REQ: DEC-99 — platform: each action ticks its View; a reviewer must see the documents.
  const implies: [Permission, Permission[]][] = [
    ['P_MERCHANTS_CREATE', ['P_MERCHANTS_VIEW']],
    ['P_MERCHANTS_SUSPEND', ['P_MERCHANTS_VIEW']],
    ['P_REGISTRY_MANAGE', ['P_REGISTRY_VIEW']],
    ['P_LEVELS_CALIBRATE', ['P_LEVELS_VIEW']],
    ['P_BILLING_MANAGE', ['P_BILLING_VIEW']],
    ['P_REPORTS_EXPORT', ['P_REPORTS_VIEW']],
    ['P_CASES_DECIDE', ['P_CASES_VIEW_UNMASKED', 'P_CASES_VIEW_MASKED']],
    ['P_CASES_VIEW_UNMASKED', ['P_CASES_VIEW_MASKED']],
    ['P_FLOWS_EDIT', ['P_FLOWS_VIEW']],
    ['P_INTEGRATION_MANAGE', ['P_INTEGRATION_VIEW']],
  ]
  for (const [p, adds] of implies) if (set.has(p)) adds.forEach((x) => set.add(x))
  return PERMISSIONS.filter((p) => set.has(p))
}

/** The permissions that `permission` ticks (shown locked while it is ticked, DEC-70 / DEC-99). */
export function impliedBy(permissions: readonly Permission[]): Set<Permission> {
  const out = new Set<Permission>()
  for (const p of permissions) for (const q of withImpliedPermissions([p])) if (q !== p) out.add(q)
  return out
}

export type { Grant }

/** REQ: DEC-99 — "Access ends" on a day means at the end of that day in Malaysia (MYT, UTC+8). */
export function accessEndsAt(day: Date | string): string {
  const ymd = typeof day === 'string' ? day : new Date(day.getTime() + 8 * 3_600_000).toISOString().slice(0, 10)
  return `${ymd}T15:59:59.999Z` // 23:59:59.999 MYT
}

/** REQ: DEC-99 / OQ-31 — whether an email is on the company staff domain. */
export const isStaffEmail = (email: string, domain: string) => email.trim().toLowerCase().endsWith(`@${domain.toLowerCase()}`)

/** REQ: DEC-99 — an end date must be later than now; no end date means "Never". */
export const endsAtError = (endsAt: string | undefined, now: Date): RuleError[] =>
  endsAt && new Date(endsAt).getTime() <= now.getTime() ? [{ field: 'endsAt', message: 'The end date must be in the future.' }] : []

/** REQ: DEC-99 — an access row whose end time has passed grants nothing. */
export const hasEnded = (a: Pick<RoleAssignment, 'endsAt'>, now: Date) => !!a.endsAt && now.getTime() >= new Date(a.endsAt).getTime()

/**
 * Assignments with their roles; an inactive or unknown role grants nothing, nor does an ended row when `now` is given
 * (every access check passes it).
 */
export function grantsOf(assignments: readonly RoleAssignment[], roles: readonly Role[], now?: Date): Grant[] {
  return assignments.flatMap((a) => {
    if (now && hasEnded(a, now)) return []
    const role = roles.find((r) => r.roleId === a.roleId && r.status === 'ACTIVE')
    return role ? [{ roleId: role.roleId, roleName: role.name, permissions: role.permissions, scope: a.scope }] : []
  })
}

export const covers = (scope: AssignmentScope, projectId: string) => scope.kind === 'ALL_PROJECTS' || (scope.kind === 'PROJECTS' && scope.projectIds.includes(projectId))

/** REQ: DEC-99 — a platform grant covers a merchant: All merchants (including future ones) or the listed ones. */
export const coversMerchant = (scope: AssignmentScope, merchantId: string) => scope.kind === 'ALL_MERCHANTS' || (scope.kind === 'MERCHANTS' && scope.merchantIds.includes(merchantId))

/** Platform staff: their platform-level permissions (from any grant; they don't depend on merchants). */
export function staffPlatformPermissions(grants: readonly Grant[]): Set<Permission> {
  return new Set(grants.flatMap((g) => g.permissions.filter((p) => PLATFORM_LEVEL.has(p))))
}

/** Platform staff: their merchant-access permissions in one merchant. */
export function staffMerchantPermissions(grants: readonly Grant[], merchantId: string): Set<Permission> {
  return new Set(grants.filter((g) => coversMerchant(g.scope, merchantId)).flatMap((g) => g.permissions.filter((p) => MERCHANT_ACCESS.has(p))))
}

/** REQ: DEC-70 — the union of every grant covering the project; merchant-level permissions only count from All projects. */
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
  return [...new Set(grants.filter((g) => covers(g.scope, projectId)).map((g) => g.roleName))]
}

/** True when the grants cover the project at all (DEC-72: otherwise the project and its cases are "not found"). */
export const coversProject = (grants: readonly Grant[], projectId: string) => grants.some((g) => covers(g.scope, projectId))

/** REQ: DEC-74 — one access chip, written the same on every screen: "Reviewer · SME app", "Merchant Owner · All projects". */
export const chipLabel = (roleName: string, scope: AssignmentScope, projectName: (projectId: string) => string, merchantName: (merchantId: string) => string = (id) => id) =>
  `${roleName} · ${scopeLabel(scope, projectName, merchantName)}`

export interface AccessChip {
  label: string
  /** Every project in the scope is archived: the row is read-only (DEC-77). */
  archived: boolean
}

export const allArchived = (scope: AssignmentScope, isArchived: (projectId: string) => boolean) => scope.kind === 'PROJECTS' && scope.projectIds.length > 0 && scope.projectIds.every(isArchived)

/** The Users list Access column (DEC-74). */
export function accessChips(grants: readonly Pick<Grant, 'roleName' | 'scope'>[], projectName: (projectId: string) => string, isArchived: (projectId: string) => boolean, merchantName?: (merchantId: string) => string): AccessChip[] {
  return grants.map((g) => ({ label: chipLabel(g.roleName, g.scope, projectName, merchantName), archived: allArchived(g.scope, isArchived) }))
}

/** The chips as one line, e.g. for the mock login: "Reviewer · Default; Viewer · SME app". */
export function accessSummary(grants: readonly Grant[], projectName: (projectId: string) => string, merchantName?: (merchantId: string) => string): string {
  return grants.map((g) => chipLabel(g.roleName, g.scope, projectName, merchantName)).join('; ')
}

export function scopeLabel(scope: AssignmentScope, projectName: (projectId: string) => string, merchantName: (merchantId: string) => string = (id) => id): string {
  switch (scope.kind) {
    case 'ALL_PROJECTS':
      return 'All projects'
    case 'PROJECTS':
      return scope.projectIds.map(projectName).join(', ')
    case 'ALL_MERCHANTS':
      return 'All merchants'
    case 'MERCHANTS':
      return scope.merchantIds.map(merchantName).join(', ')
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
  if (scope.kind === 'ALL_MERCHANTS' || scope.kind === 'MERCHANTS') return false
  const holds = (have: Set<Permission>) => permissions.every((p) => have.has(p))
  if (scope.kind === 'ALL_PROJECTS') return holds(merchantWidePermissions(granter))
  return scope.projectIds.every((id) => holds(permissionsIn(granter, id)))
}

export const GRANT_TOO_POWERFUL = 'You can only give access you have yourself.'
export const MERCHANT_LEVEL_SCOPE = 'This role includes merchant-level permissions, so it can only be given for All projects.'

export const WRONG_ROLE_TYPE = 'Platform roles are for platform staff; merchant roles are for that merchant’s users.'

/**
 * REQ: DEC-70 / DEC-77 / DEC-99 — scope rules for a new or edited assignment. Merchant roles: `openProjectIds` are the
 * merchant's non-archived projects. Platform roles: `merchantIds` are the merchants that exist.
 */
export function validateAssignment(
  role: Pick<Role, 'permissions' | 'status' | 'audience'>,
  scope: AssignmentScope,
  openProjectIds: readonly string[],
  merchantIds: readonly string[] = [],
): RuleError[] {
  if (role.status !== 'ACTIVE') return [{ field: 'roleId', message: 'This role is inactive.' }]
  const platformScope = scope.kind === 'ALL_MERCHANTS' || scope.kind === 'MERCHANTS'
  if ((role.audience === 'PLATFORM') !== platformScope) return [{ field: 'roleId', message: WRONG_ROLE_TYPE }]
  if (scope.kind === 'ALL_MERCHANTS') return []
  if (scope.kind === 'MERCHANTS') {
    if (!scope.merchantIds.length) return [{ field: 'scope', message: 'Choose at least one merchant.' }]
    if (scope.merchantIds.some((id) => !merchantIds.includes(id))) return [{ field: 'scope', message: 'Choose existing merchants.' }]
    return []
  }
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
  input: { name: string; permissions: readonly Permission[]; audience?: RoleAudience },
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
  else if (input.audience && input.permissions.some((p) => !permissionsFor(input.audience!).includes(p))) {
    errors.push({ field: 'permissions', message: 'These permissions don’t belong to this role type.' })
  }
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

export const LAST_OWNER = 'At least one Merchant Owner (All projects) is required.'

const isOwnerAssignment = (a: RoleAssignment) => a.roleId === SYSTEM_ROLE_IDS.MERCHANT_OWNER && a.scope.kind === 'ALL_PROJECTS'

/**
 * REQ: DEC-74 — at least one Merchant Owner (All projects) must remain. Pass the merchant's users that are not suspended,
 * before and after the change. A merchant that had none (e.g. its owner is still Pending) is not blocked.
 */
export function lastOwnerError(before: readonly { assignments: readonly RoleAssignment[] }[], after: readonly { assignments: readonly RoleAssignment[] }[]): RuleError[] {
  const owners = (us: typeof before) => us.filter((u) => u.assignments.some(isOwnerAssignment)).length
  return owners(before) > 0 && owners(after) === 0 ? [{ field: 'roleId', message: LAST_OWNER }] : []
}

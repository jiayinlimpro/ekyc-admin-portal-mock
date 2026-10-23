// REQ: DEC-102 / DEC-104 — the permission matrix: every permission is a module's View or one of its actions. The Roles
// screen shows one table per role Type: rows (module) × View × Actions, no sections (where a role applies is decided by
// where it is given, DEC-104). Ticking a permission ticks what it needs; unticking one clears what depends on it.
import type { Permission, RoleAudience } from './types'

export interface PermissionModule {
  module: string
  /** The module's View permission; none when everyone who reaches the module sees it (Projects). */
  view?: Permission
  /** The View column's label when it is not just "View" (Verifications: "View list"). */
  viewLabel?: string
  actions: readonly { permission: Permission; label: string }[]
}

const a = (permission: Permission, label: string) => ({ permission, label })

// The same action has the same wording in both Types (DEC-104).
const CASES = ['View details', 'Claim / release', 'Approve / reject'] as const
const FLOWS = ['Create', 'Edit', 'Activate / retire', 'Change verification level'] as const

/** REQ: DEC-104 — the modules of a Merchant role, in the order of the Roles form. */
const MERCHANT_MODULES: readonly PermissionModule[] = [
  // Everyone sees the projects they work in, so Projects has no View.
  { module: 'Projects', actions: [a('CREATE_PROJECTS', 'Create'), a('RENAME_PROJECTS', 'Rename'), a('ARCHIVE_PROJECTS', 'Archive')] },
  // Users are never deleted, only suspended (DEC-74).
  { module: 'Users', view: 'VIEW_USERS', actions: [a('INVITE_USERS', 'Invite'), a('CHANGE_USER_ROLE', 'Change role'), a('SUSPEND_USERS', 'Suspend')] },
  // Roles are never deleted, only deactivated (DEC-76).
  { module: 'Roles', view: 'VIEW_ROLES', actions: [a('CREATE_ROLES', 'Create'), a('EDIT_ROLES', 'Edit'), a('CHANGE_ROLE_STATUS', 'Deactivate')] },
  { module: 'Billing and contract', view: 'VIEW_BILLING', actions: [a('MANAGE_BILLING', 'Manage')] },
  { module: 'Merchant reports', view: 'VIEW_MERCHANT_REPORTS', actions: [a('EXPORT_MERCHANT_REPORTS', 'Export')] },
  {
    module: 'Verifications',
    view: 'VIEW_CASE_LIST',
    viewLabel: 'View list',
    actions: [a('VIEW_CASE_DETAILS', CASES[0]), a('CLAIM_CASES', CASES[1]), a('DECIDE_CASES', CASES[2])],
  },
  {
    module: 'Flows',
    view: 'VIEW_FLOWS',
    actions: [a('CREATE_FLOWS', FLOWS[0]), a('EDIT_FLOWS', FLOWS[1]), a('ACTIVATE_FLOWS', FLOWS[2]), a('CHANGE_VERIFICATION_LEVEL', FLOWS[3])],
  },
  { module: 'Project settings', view: 'VIEW_PROJECT_SETTINGS', actions: [a('MANAGE_PROJECT_SETTINGS', 'Edit')] },
  { module: 'API keys and webhook', view: 'VIEW_INTEGRATION', actions: [a('MANAGE_INTEGRATION', 'Manage')] },
  { module: 'Members', view: 'VIEW_MEMBERS', actions: [a('MANAGE_MEMBERS', 'Add / remove')] },
  { module: 'Project reports', view: 'VIEW_PROJECT_REPORTS', actions: [a('EXPORT_PROJECT_REPORTS', 'Export')] },
  { module: 'Audit log', view: 'VIEW_AUDIT_LOG', actions: [] },
]

/** REQ: DEC-104 — the modules of a Platform role (staff have one role and no scope: every module applies everywhere). */
const PLATFORM_MODULES: readonly PermissionModule[] = [
  { module: 'Merchants', view: 'P_MERCHANTS_VIEW', actions: [a('P_MERCHANTS_CREATE', 'Create / edit'), a('P_MERCHANTS_SUSPEND', 'Change status')] },
  { module: 'Workflow Registry', view: 'P_REGISTRY_VIEW', actions: [a('P_REGISTRY_MANAGE', 'Manage')] },
  { module: 'Verification levels', view: 'P_LEVELS_VIEW', actions: [a('P_LEVELS_CALIBRATE', 'Calibrate')] },
  { module: 'Platform billing', view: 'P_BILLING_VIEW', actions: [a('P_BILLING_MANAGE', 'Manage')] },
  { module: 'Usage reports', view: 'P_REPORTS_VIEW', actions: [a('P_REPORTS_EXPORT', 'Export')] },
  {
    module: 'Verifications',
    view: 'P_CASES_LIST',
    viewLabel: 'View list',
    actions: [a('P_CASES_DETAILS', CASES[0]), a('P_CASES_CLAIM', CASES[1]), a('P_CASES_DECIDE', CASES[2])],
  },
  {
    module: 'Flows',
    view: 'P_FLOWS_VIEW',
    actions: [a('P_FLOWS_CREATE', FLOWS[0]), a('P_FLOWS_EDIT', FLOWS[1]), a('P_FLOWS_ACTIVATE', FLOWS[2]), a('P_FLOWS_LEVEL', FLOWS[3])],
  },
  { module: 'API keys and webhook', view: 'P_INTEGRATION_VIEW', actions: [a('P_INTEGRATION_MANAGE', 'Manage')] },
  { module: 'Audit log', view: 'P_AUDIT_VIEW', actions: [] },
]

/** The rows of the Roles form for a role of this Type. */
export const modulesFor = (audience: RoleAudience): readonly PermissionModule[] => (audience === 'PLATFORM' ? PLATFORM_MODULES : MERCHANT_MODULES)

/** Every permission of a module: its View and its actions (the module checkbox ticks them all). */
export const modulePermissions = (m: PermissionModule): Permission[] => [...(m.view ? [m.view] : []), ...m.actions.map((x) => x.permission)]

/**
 * REQ: DEC-102 / DEC-104 — what each permission needs: an action its module's View; Verifications in a chain (View
 * details → Claim / release → Approve / reject); changing the verification level happens in the flow editor (DEC-70).
 */
export const IMPLIES: ReadonlyMap<Permission, readonly Permission[]> = (() => {
  const out = new Map<Permission, Permission[]>()
  for (const m of [...MERCHANT_MODULES, ...PLATFORM_MODULES]) for (const x of m.actions) if (m.view) out.set(x.permission, [m.view])
  const plus = (p: Permission, more: Permission[]) => out.set(p, [...(out.get(p) ?? []), ...more])
  plus('CLAIM_CASES', ['VIEW_CASE_DETAILS'])
  plus('DECIDE_CASES', ['CLAIM_CASES'])
  plus('P_CASES_CLAIM', ['P_CASES_DETAILS'])
  plus('P_CASES_DECIDE', ['P_CASES_CLAIM'])
  plus('CHANGE_VERIFICATION_LEVEL', ['EDIT_FLOWS'])
  plus('P_FLOWS_LEVEL', ['P_FLOWS_EDIT'])
  return out
})()

/** Everything that needs `permission`, directly or through others: unticking it clears them (DEC-104). */
export function dependentsOf(permission: Permission): Set<Permission> {
  const out = new Set<Permission>()
  const walk = (p: Permission) => {
    for (const [q, needs] of IMPLIES) {
      if (needs.includes(p) && !out.has(q)) {
        out.add(q)
        walk(q)
      }
    }
  }
  walk(permission)
  return out
}

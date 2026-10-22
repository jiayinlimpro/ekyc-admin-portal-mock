// REQ: DEC-102 — the permission matrix: every permission is a module's View or one of its actions. The Roles screen shows
// it as rows (module) × View × Actions, and ticking an action ticks the module's View. Pure data, no React.
import type { Permission, RoleAudience } from './types'

export interface PermissionModule {
  module: string
  /** The module's View permission; none when everyone who reaches the module sees it (Projects). */
  view?: Permission
  /** The View column's label when it is not just "View" (platform Verifications: masked). */
  viewLabel?: string
  actions: readonly { permission: Permission; label: string }[]
}

export interface PermissionGroup {
  key: 'MERCHANT_LEVEL' | 'PROJECT_LEVEL' | 'PLATFORM_LEVEL' | 'MERCHANT_ACCESS'
  audience: RoleAudience
  title: string
  hint: string
  modules: readonly PermissionModule[]
}

const a = (permission: Permission, label: string) => ({ permission, label })

export const PERMISSION_MATRIX: readonly PermissionGroup[] = [
  {
    key: 'MERCHANT_LEVEL',
    audience: 'MERCHANT',
    title: 'Merchant-level',
    hint: 'A role with any of these can only be given for All projects.',
    modules: [
      // Everyone sees the projects they work in, so Projects has no View.
      { module: 'Projects', actions: [a('CREATE_PROJECTS', 'Create'), a('RENAME_PROJECTS', 'Rename'), a('ARCHIVE_PROJECTS', 'Archive')] },
      // Users are never deleted, only suspended (DEC-74).
      { module: 'Users', view: 'VIEW_USERS', actions: [a('INVITE_USERS', 'Invite'), a('CHANGE_USER_ACCESS', 'Change access'), a('SUSPEND_USERS', 'Suspend')] },
      // Roles are never deleted, only deactivated (DEC-76).
      { module: 'Roles', view: 'VIEW_ROLES', actions: [a('CREATE_ROLES', 'Create'), a('EDIT_ROLES', 'Edit'), a('CHANGE_ROLE_STATUS', 'Deactivate')] },
      { module: 'Billing and contract', view: 'VIEW_BILLING', actions: [a('MANAGE_BILLING', 'Manage')] },
      { module: 'Merchant reports', view: 'VIEW_MERCHANT_REPORTS', actions: [a('EXPORT_MERCHANT_REPORTS', 'Export')] },
    ],
  },
  {
    key: 'PROJECT_LEVEL',
    audience: 'MERCHANT',
    title: 'Project-level',
    hint: 'Apply in the projects the role is given for.',
    modules: [
      { module: 'Verifications', view: 'VIEW_CASES', actions: [a('CLAIM_CASES', 'Claim'), a('DECIDE_CASES', 'Approve / reject')] },
      {
        module: 'Flows',
        view: 'VIEW_FLOWS',
        actions: [a('CREATE_FLOWS', 'Create'), a('EDIT_FLOWS', 'Edit'), a('ACTIVATE_FLOWS', 'Activate / retire'), a('CHANGE_VERIFICATION_LEVEL', 'Change verification level')],
      },
      { module: 'Project settings', view: 'VIEW_PROJECT_SETTINGS', actions: [a('MANAGE_PROJECT_SETTINGS', 'Edit')] },
      { module: 'API keys and webhook', view: 'VIEW_INTEGRATION', actions: [a('MANAGE_INTEGRATION', 'Manage')] },
      { module: 'Members', view: 'VIEW_MEMBERS', actions: [a('MANAGE_MEMBERS', 'Add / remove')] },
      { module: 'Project reports', view: 'VIEW_PROJECT_REPORTS', actions: [a('EXPORT_PROJECT_REPORTS', 'Export')] },
      { module: 'Audit log', view: 'VIEW_AUDIT_LOG', actions: [] },
    ],
  },
  {
    key: 'PLATFORM_LEVEL',
    audience: 'PLATFORM',
    title: 'Platform-level',
    hint: 'Apply across the platform.',
    modules: [
      { module: 'Merchants', view: 'P_MERCHANTS_VIEW', actions: [a('P_MERCHANTS_CREATE', 'Create / edit'), a('P_MERCHANTS_SUSPEND', 'Change status')] },
      { module: 'Workflow Registry', view: 'P_REGISTRY_VIEW', actions: [a('P_REGISTRY_MANAGE', 'Manage')] },
      { module: 'Verification levels', view: 'P_LEVELS_VIEW', actions: [a('P_LEVELS_CALIBRATE', 'Calibrate')] },
      { module: 'Platform billing', view: 'P_BILLING_VIEW', actions: [a('P_BILLING_MANAGE', 'Manage')] },
      { module: 'Usage reports', view: 'P_REPORTS_VIEW', actions: [a('P_REPORTS_EXPORT', 'Export')] },
    ],
  },
  {
    key: 'MERCHANT_ACCESS',
    audience: 'PLATFORM',
    title: 'Merchant access',
    hint: 'Apply in the merchants the user is given.',
    modules: [
      {
        module: 'Verifications',
        view: 'P_CASES_VIEW_MASKED',
        viewLabel: 'View (masked)',
        actions: [a('P_CASES_VIEW_UNMASKED', 'See unmasked ID data'), a('P_CASES_DECIDE', 'Claim / approve / reject')],
      },
      { module: 'Flows', view: 'P_FLOWS_VIEW', actions: [a('P_FLOWS_EDIT', 'Edit')] },
      { module: 'API keys and webhook', view: 'P_INTEGRATION_VIEW', actions: [a('P_INTEGRATION_MANAGE', 'Manage')] },
      { module: 'Audit log', view: 'P_AUDIT_VIEW', actions: [] },
    ],
  },
]

/** The groups a role of this Type shows (Merchant: merchant-level and project-level; Platform: platform-level and merchant access). */
export const groupsFor = (audience: RoleAudience) => PERMISSION_MATRIX.filter((g) => g.audience === audience)

/** Every permission of a module: its View and its actions (the module checkbox ticks them all). */
export const modulePermissions = (m: PermissionModule): Permission[] => [...(m.view ? [m.view] : []), ...m.actions.map((x) => x.permission)]

/**
 * REQ: DEC-102 — what each permission brings with it: an action its module's View; and a few actions need another one
 * to work (DEC-70: changing the verification level happens in the flow editor; DEC-99: a reviewer sees the documents).
 */
export const IMPLIES: ReadonlyMap<Permission, readonly Permission[]> = (() => {
  const out = new Map<Permission, Permission[]>()
  for (const g of PERMISSION_MATRIX) for (const m of g.modules) for (const x of m.actions) if (m.view) out.set(x.permission, [m.view])
  const plus = (p: Permission, more: Permission[]) => out.set(p, [...(out.get(p) ?? []), ...more])
  plus('CHANGE_VERIFICATION_LEVEL', ['EDIT_FLOWS'])
  plus('P_CASES_DECIDE', ['P_CASES_VIEW_UNMASKED'])
  return out
})()

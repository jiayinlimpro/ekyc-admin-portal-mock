// Roles API (mock): two role tables (DEC-76, DEC-104). **Merchant roles** (Roles screen; given on Users; the whole
// merchant) and **project roles** (Project Settings › Roles of each project; given in Project › Members; that project
// only). System Default roles are shared and locked; Custom roles belong to a merchant (merchant roles) or to one
// project (project roles). Editing a role applies at once to everyone holding it.
//   GET  /roles?merchantId=…                  list              → 200 RoleRow[] (merchant roles; platform roles for super admins)
//   GET  /projects/{id}/roles                 listProjectRoles  → 200 RoleRow[] (System Default project roles + the project's own)
//   GET  /merchants/{id}/roles/assignable     assignable        → 200 Role[] (merchant roles; with ?projectId: that project's roles)
//   POST /merchants/{id}/roles                create            → 201 Role | 403 | 422 (with projectId: a project role)
//   PUT  /roles/{id}                          update            → 200 Role | 403 | 422
//   POST /roles/{id}/status                   setStatus         → 200 Role | 422 (still assigned)
import { canAnyInProject, canInMerchant, canInProject, canOnPlatform, hasProject, isInternal } from '@/domain/access'
import { canGrant, GRANT_TOO_POWERFUL, holdersOf, PLATFORM_DEFAULT_ROLES, SYSTEM_DEFAULT_ROLES, validateRole, validateRoleStatus, withImpliedPermissions } from '@/domain/roles'
import type { Actor, AssignmentScope, Permission, Project, Role, RoleAudience, RoleStatus } from '@/domain/types'
import { now } from '@/lib/clock'
import { permissionList } from '@/lib/labels'
import { db } from '@/mocks/mockDb'
import { accountOf, requireActive, type AccountAccess } from './accessGuard'
import { ServiceError } from './errors'
import { simulateNetwork, wire } from './network'
import { validation } from './projectService'
import { auditAccess, releaseLostClaims } from './userAdminService'
import { adoptDraftId, newId } from '@/lib/ids'

export interface RoleInput {
  name: string
  permissions: Permission[]
}

/**
 * A new role: the Role ID shown in the dialog (from `draftRoleId`), its starting status (DEC-76), Type (DEC-99) and,
 * for a project role, its project (DEC-104).
 */
export type NewRoleInput = RoleInput & { roleId?: string; status?: RoleStatus; audience?: RoleAudience; projectId?: string }

/** A row of a role table. `users` / `projects`: holders in the viewer's scope; "Affects N users in M projects" (DEC-76). */
export type RoleRow = Role & { merchantName?: string; projectName?: string; users: number; projects: number }

export interface RoleService {
  /** REQ: DEC-104 — the merchant role table (and, for super admins, the platform roles). */
  list(actor: Actor, merchantId?: string): Promise<RoleRow[]>
  /** REQ: DEC-104 — a project's role table: the System Default project roles and the project's own. */
  listProjectRoles(projectId: string, actor: Actor): Promise<RoleRow[]>
  /**
   * REQ: DEC-74 / DEC-104 — active roles the actor may give: merchant roles (New user, Change role), or with `projectId`
   * that project's roles (Members).
   */
  assignable(merchantId: string, actor: Actor, projectId?: string): Promise<Role[]>
  /** REQ: DEC-76 — the Role ID shown read-only when the create dialog opens; `create` keeps it. */
  draftRoleId(actor: Actor): Promise<string>
  /** A merchant role for `merchantId`; with `input.projectId` a project role; or (super admin, Type = Platform) a platform role. */
  create(merchantId: string | undefined, input: NewRoleInput, actor: Actor): Promise<Role>
  update(roleId: string, input: RoleInput, actor: Actor): Promise<Role>
  setStatus(roleId: string, status: RoleStatus, actor: Actor): Promise<Role>
}

// System Default roles first, in catalogue order; then Custom roles by created time (DEC-97: never by ID).
const SYSTEM_ORDER = [...SYSTEM_DEFAULT_ROLES, ...PLATFORM_DEFAULT_ROLES].map((r) => r.roleId)
const systemOrder = (r: Role) => (r.type === 'SYSTEM_DEFAULT' ? SYSTEM_ORDER.indexOf(r.roleId) : SYSTEM_ORDER.length)
const byOrder = (a: Role, b: Role) => systemOrder(a) - systemOrder(b) || a.createdAt.localeCompare(b.createdAt)
const merchantName = (id?: string) => db.state().merchants.find((m) => m.merchantId === id)?.name
const projectOf = (id?: string) => db.state().projects.find((p) => p.projectId === id)
const by = (actor: Actor): Actor => ({ userId: actor.userId, fullName: actor.fullName })

const ROLE_ACTION_TEXT = {
  viewRoles: 'view roles',
  createRoles: 'create roles',
  editRoles: 'edit roles',
  changeRoleStatus: 'activate or deactivate roles',
  viewProjectRoles: 'view this project’s roles',
  createProjectRoles: 'create project roles',
  editProjectRoles: 'edit project roles',
  changeProjectRoleStatus: 'activate or deactivate project roles',
} as const

// REQ: DEC-102 — each operation needs its own permission: merchant roles merchant-wide, project roles in their project.
function requireRoles(me: AccountAccess, merchantId: string, action: 'viewRoles' | 'createRoles' | 'editRoles' | 'changeRoleStatus' = 'viewRoles') {
  if (!canInMerchant(me, action, merchantId)) throw new ServiceError('FORBIDDEN', `You do not have permission to ${ROLE_ACTION_TEXT[action]}.`)
}
function requireProjectRoles(me: AccountAccess, p: Project, action: 'viewProjectRoles' | 'createProjectRoles' | 'editProjectRoles' | 'changeProjectRoleStatus') {
  if (!canInProject(me, action, p)) throw new ServiceError('FORBIDDEN', `You do not have permission to ${ROLE_ACTION_TEXT[action]}.`)
}

/** REQ: DEC-104 — the merchant role table of a merchant: System Default and its Custom merchant roles. */
const merchantRolesOf = (merchantId: string) => db.state().roles.filter((r) => r.audience === 'MERCHANT' && r.level === 'MERCHANT' && (!r.merchantId || r.merchantId === merchantId))
/** REQ: DEC-104 — a project's role table: System Default project roles and the project's own Custom ones. */
const projectRolesOf = (projectId: string) => db.state().roles.filter((r) => r.audience === 'MERCHANT' && r.level === 'PROJECT' && (!r.projectId || r.projectId === projectId))
const platformRoles = () => db.state().roles.filter((r) => r.audience === 'PLATFORM')

const accountsIn = (merchantId?: string) => db.state().accounts.filter((a) => !merchantId || a.merchantId === merchantId)

/** A project the actor reaches (DEC-72: otherwise "not found"). */
function loadProject(me: AccountAccess, projectId: string): Project {
  const p = projectOf(projectId)
  if (!p || !hasProject(me, p)) throw new ServiceError('NOT_FOUND', `Project ${projectId} not found.`)
  return p
}

/** A role the actor may change, with the permission its table needs (System Default roles: validateRole refuses). */
function loadRole(me: AccountAccess, roleId: string, change: 'edit' | 'status'): Role {
  const r = db.state().roles.find((x) => x.roleId === roleId)
  if (!r || (r.merchantId && !isInternal(me) && r.merchantId !== me.merchantId)) throw new ServiceError('NOT_FOUND', `Role ${roleId} not found.`)
  // REQ: DEC-99 — platform roles exist only for super admins.
  if (r.audience === 'PLATFORM') {
    if (!canOnPlatform(me, 'manageStaff')) throw new ServiceError('NOT_FOUND', `Role ${roleId} not found.`)
    return r
  }
  if (r.type === 'SYSTEM_DEFAULT') return r
  if (r.level === 'PROJECT') requireProjectRoles(me, loadProject(me, r.projectId!), change === 'edit' ? 'editProjectRoles' : 'changeProjectRoleStatus')
  else requireRoles(me, r.merchantId!, change === 'edit' ? 'editRoles' : 'changeRoleStatus')
  return r
}

const putRole = (r: Role) => db.setState((st) => ({ roles: st.roles.map((x) => (x.roleId === r.roleId ? r : x)) }))
// REQ: DEC-104 — staff hold platform permissions, so like super admins they aren't limited by "give only what you hold".
const granter = (me: AccountAccess) => (isInternal(me) ? ('SUPER_ADMIN' as const) : me.grants)

/** Users and projects a role affects, among `people` (optionally within one project). */
function rowOf(r: Role, people: ReturnType<typeof accountsIn>, onlyProject?: string): RoleRow {
  const holds = (x: { roleId: string; scope: AssignmentScope }) => x.roleId === r.roleId && (!onlyProject || (x.scope.kind === 'PROJECTS' && x.scope.projectIds.includes(onlyProject)))
  const holders = people.filter((a) => a.assignments.some(holds))
  return {
    ...r,
    merchantName: merchantName(r.merchantId),
    projectName: projectOf(r.projectId)?.name,
    users: holders.length,
    projects: new Set(
      holders.flatMap((a) =>
        a.assignments.filter(holds).flatMap((x) => (x.scope.kind === 'PROJECTS' ? x.scope.projectIds : db.state().projects.filter((p) => p.merchantId === a.merchantId).map((p) => p.projectId))),
      ),
    ).size,
  }
}

function newRole(input: NewRoleInput, actor: Actor, fields: Pick<Role, 'audience' | 'level' | 'merchantId' | 'projectId' | 'permissions'>): Role {
  const at = now().toISOString()
  return {
    roleId: adoptDraftId('rol', input.roleId, (id) => db.state().roles.some((r) => r.roleId === id)), // DEC-76
    ...fields,
    name: input.name.trim(),
    type: 'CUSTOM',
    status: input.status ?? 'ACTIVE',
    createdAt: at,
    createdBy: by(actor),
    updatedAt: at,
    updatedBy: by(actor),
  }
}

/** REQ: DEC-99 — Type = Platform: super admin only; no merchant; platform permissions only. */
function createPlatformRole(me: AccountAccess, input: NewRoleInput, actor: Actor): Role {
  if (!canOnPlatform(me, 'manageStaff')) throw new ServiceError('FORBIDDEN', 'Only super admins create platform roles.')
  const permissions = withImpliedPermissions(input.permissions)
  const errors = validateRole({ name: input.name, permissions, audience: 'PLATFORM' }, platformRoles())
  if (errors.length) throw validation(errors)
  const role = newRole(input, actor, { audience: 'PLATFORM', permissions })
  db.setState((st) => ({ roles: [...st.roles, role] }))
  auditAccess(actor, 'ROLE_CREATED', undefined, { roleId: role.roleId, name: role.name, type: 'Platform (internal)', permissions, status: role.status, summary: `Platform role ${role.name} created` })
  return role
}

/** REQ: DEC-104 — a Custom project role: Project roles · Create in that project; project permissions only. */
function createProjectRole(me: AccountAccess, merchantId: string, input: NewRoleInput, actor: Actor): Role {
  const p = loadProject(me, input.projectId!)
  if (p.merchantId !== merchantId) throw new ServiceError('NOT_FOUND', `Project ${input.projectId} not found.`)
  requireProjectRoles(me, p, 'createProjectRoles')
  const permissions = withImpliedPermissions(input.permissions)
  const errors = validateRole({ name: input.name, permissions, audience: 'MERCHANT', level: 'PROJECT' }, projectRolesOf(p.projectId))
  if (errors.length) throw validation(errors)
  // REQ: DEC-74 — nobody defines a role more powerful than their own access in that project.
  if (!canGrant(granter(me), permissions, { kind: 'PROJECTS', projectIds: [p.projectId] })) throw new ServiceError('FORBIDDEN', GRANT_TOO_POWERFUL)
  const role = newRole(input, actor, { audience: 'MERCHANT', level: 'PROJECT', merchantId, projectId: p.projectId, permissions })
  db.setState((st) => ({ roles: [...st.roles, role] }))
  auditAccess(actor, 'ROLE_CREATED', merchantId, { roleId: role.roleId, name: role.name, type: 'Project role', permissions, status: role.status, summary: `Project role ${role.name} created in ${p.name}` }, p.projectId)
  return role
}

export const mockRoleService: RoleService = {
  async list(actor, merchantId) {
    await simulateNetwork('list roles')
    const me = accountOf(actor)
    const scope = isInternal(me) ? merchantId : me.merchantId!
    if (me.level !== 'SUPER_ADMIN') requireRoles(me, scope ?? '')
    // REQ: DEC-104 — merchant roles only; project roles live in each project's settings. Platform roles for super admins.
    const roles = scope ? merchantRolesOf(scope) : db.state().roles.filter((r) => (r.audience === 'PLATFORM' && canOnPlatform(me, 'manageStaff')) || r.level === 'MERCHANT')
    const people = accountsIn(scope)
    return wire(roles.map((r) => rowOf(r, people)).sort(byOrder))
  },

  async listProjectRoles(projectId, actor) {
    await simulateNetwork('list project roles')
    const me = accountOf(actor)
    const p = loadProject(me, projectId)
    requireProjectRoles(me, p, 'viewProjectRoles')
    return wire(projectRolesOf(projectId).map((r) => rowOf(r, accountsIn(p.merchantId), projectId)).sort(byOrder))
  },

  async assignable(merchantId, actor, projectId) {
    await simulateNetwork('assignable roles')
    const me = accountOf(actor)
    const g = granter(me)
    if (projectId) {
      // REQ: DEC-77 / DEC-104 — Members: that project's roles the actor may give there.
      const p = loadProject(me, projectId)
      // REQ: DEC-77 / OQ-27 — Users › Invite may invite a new person from Members too.
      if (p.merchantId !== merchantId || !canAnyInProject(me, ['manageMembers', 'inviteUsers'], p)) throw new ServiceError('FORBIDDEN', 'You do not manage members in this project.')
      return wire(projectRolesOf(projectId).filter((r) => r.status === 'ACTIVE' && canGrant(g, r.permissions, { kind: 'PROJECTS', projectIds: [projectId] })).sort(byOrder))
    }
    // REQ: DEC-104 — New user and Change role: merchant roles (the whole merchant).
    if (!canInMerchant(me, 'inviteUsers', merchantId) && !canInMerchant(me, 'changeUserRole', merchantId)) throw new ServiceError('FORBIDDEN', 'You do not manage users in this merchant.')
    return wire(merchantRolesOf(merchantId).filter((r) => r.status === 'ACTIVE' && canGrant(g, r.permissions, { kind: 'ALL_PROJECTS' })).sort(byOrder))
  },

  async draftRoleId(actor) {
    await simulateNetwork('draft role id')
    const me = accountOf(actor)
    const may = me.level === 'SUPER_ADMIN' || canInMerchant(me, 'createRoles', me.merchantId ?? '') || db.state().projects.some((p) => (isInternal(me) || p.merchantId === me.merchantId) && canInProject(me, 'createProjectRoles', p))
    if (!may) throw new ServiceError('FORBIDDEN', 'You do not have permission to create roles.')
    return newId('rol')
  },

  async create(merchantId, input, actor) {
    await simulateNetwork('create role')
    const me = requireActive(actor)
    if (input.audience === 'PLATFORM') return wire(createPlatformRole(me, input, actor))
    if (!merchantId || !db.state().merchants.some((m) => m.merchantId === merchantId) || (!isInternal(me) && me.merchantId !== merchantId)) throw new ServiceError('NOT_FOUND', `Merchant ${merchantId} not found.`)
    if (input.projectId) return wire(createProjectRole(me, merchantId, input, actor))
    requireRoles(me, merchantId, 'createRoles')
    const permissions = withImpliedPermissions(input.permissions)
    const errors = validateRole({ name: input.name, permissions, audience: 'MERCHANT', level: 'MERCHANT' }, merchantRolesOf(merchantId))
    if (errors.length) throw validation(errors)
    // REQ: DEC-74 — a role is a grant waiting to happen: nobody defines one more powerful than their own access.
    if (!canGrant(granter(me), permissions, { kind: 'ALL_PROJECTS' })) throw new ServiceError('FORBIDDEN', GRANT_TOO_POWERFUL)
    const role = newRole(input, actor, { audience: 'MERCHANT', level: 'MERCHANT', merchantId, permissions })
    db.setState((st) => ({ roles: [...st.roles, role] }))
    auditAccess(actor, 'ROLE_CREATED', merchantId, { roleId: role.roleId, name: role.name, permissions, status: role.status, summary: `Role ${role.name} created${role.status === 'INACTIVE' ? ' (inactive)' : ''}` })
    return wire(role)
  },

  async update(roleId, input, actor) {
    await simulateNetwork('update role')
    const me = requireActive(actor)
    const r = loadRole(me, roleId, 'edit')
    const holders = holdersOf(roleId, db.state().accounts)
    const permissions = withImpliedPermissions(input.permissions)
    const others = r.audience === 'PLATFORM' ? platformRoles() : r.level === 'PROJECT' ? projectRolesOf(r.projectId ?? '') : merchantRolesOf(r.merchantId ?? '')
    const errors = validateRole({ name: input.name, permissions, audience: r.audience, level: r.level }, others, r)
    if (errors.length) throw validation(errors)
    const scope: AssignmentScope = r.level === 'PROJECT' ? { kind: 'PROJECTS', projectIds: [r.projectId!] } : { kind: 'ALL_PROJECTS' }
    if (r.audience === 'MERCHANT' && !canGrant(granter(me), permissions, scope)) throw new ServiceError('FORBIDDEN', GRANT_TOO_POWERFUL)
    const changes = [
      ...(r.name !== input.name.trim() ? [{ field: 'Role name', from: r.name, to: input.name.trim() }] : []),
      ...(r.permissions.join() !== permissions.join() ? [{ field: `${r.name} permissions`, from: permissionList(r.permissions), to: permissionList(permissions) }] : []),
    ]
    if (!changes.length) return wire(r)
    const updated: Role = { ...r, name: input.name.trim(), permissions, updatedAt: now().toISOString(), updatedBy: by(actor) }
    putRole(updated)
    auditAccess(actor, 'ROLE_UPDATED', r.merchantId, { roleId, users: holders.length, changes }, r.projectId)
    // Holders who lost Claim (or Approve / reject) lose their open claims (DEC-74).
    releaseLostClaims(actor, holders.map((a) => a.userId), 'Role changed')
    return wire(updated)
  },

  async setStatus(roleId, status, actor) {
    await simulateNetwork('set role status')
    const me = requireActive(actor)
    const r = loadRole(me, roleId, 'status')
    const errors = validateRoleStatus(r, status, holdersOf(roleId, db.state().accounts).length)
    if (errors.length) throw validation(errors)
    if (r.status === status) return wire(r)
    const updated: Role = { ...r, status, updatedAt: now().toISOString(), updatedBy: by(actor) }
    putRole(updated)
    auditAccess(actor, 'ROLE_STATUS_CHANGED', r.merchantId, { roleId, changes: [{ field: `${r.name} status`, from: r.status, to: status }] }, r.projectId)
    return wire(updated)
  },
}

export const roleService: RoleService = mockRoleService

// Roles API (mock): [FRS] User Management › Roles (DEC-70, DEC-76). System Default roles are shared and locked; each
// merchant adds Custom roles. Editing a role applies at once to everyone holding it.
//   GET  /roles?merchantId=…        list        → 200 RoleRow[]
//   GET  /merchants/{id}/roles/assignable  assignable → 200 Role[] (active; for the access pickers)
//   POST /merchants/{id}/roles      create      → 201 Role | 403 | 422
//   PUT  /roles/{id}                update      → 200 Role | 403 | 422
//   POST /roles/{id}/status         setStatus   → 200 Role | 422 (still assigned)
import { canInMerchant, canInProject, canOnPlatform } from '@/domain/access'
import { canGrant, GRANT_TOO_POWERFUL, holdersOf, isMerchantLevel, PLATFORM_DEFAULT_ROLES, SYSTEM_DEFAULT_ROLES, validateRole, validateRoleStatus, withImpliedPermissions } from '@/domain/roles'
import type { Actor, Permission, Role, RoleAudience, RoleStatus } from '@/domain/types'
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

/** A new role: the Role ID shown in the dialog (from `draftRoleId`), its starting status (DEC-76) and Type (DEC-99). */
export type NewRoleInput = RoleInput & { roleId?: string; status?: RoleStatus; audience?: RoleAudience }

/** A row on the Roles screen. `users` / `projects`: holders in the viewer's scope; "Affects N users in M projects" (DEC-76). */
export type RoleRow = Role & { merchantName?: string; users: number; projects: number; heldForSelectedProjects: boolean }

export interface RoleService {
  list(actor: Actor, merchantId?: string): Promise<RoleRow[]>
  /**
   * REQ: DEC-74 / DEC-77 — active roles (System Default plus the merchant's own) that the actor may give: in `projectId`
   * when given (Members tab: project-level roles only), otherwise in at least one scope.
   */
  assignable(merchantId: string, actor: Actor, projectId?: string): Promise<Role[]>
  /** REQ: DEC-76 — the Role ID shown read-only when the create dialog opens; `create` keeps it. */
  draftRoleId(actor: Actor): Promise<string>
  /** A Merchant role for `merchantId`, or (super admin, Type = Platform) a platform role with no merchant (DEC-99). */
  create(merchantId: string | undefined, input: NewRoleInput, actor: Actor): Promise<Role>
  update(roleId: string, input: RoleInput, actor: Actor): Promise<Role>
  setStatus(roleId: string, status: RoleStatus, actor: Actor): Promise<Role>
}

// System Default roles first, in catalogue order; then Custom roles by created time (DEC-97: never by ID).
const SYSTEM_ORDER = [...SYSTEM_DEFAULT_ROLES, ...PLATFORM_DEFAULT_ROLES].map((r) => r.roleId)
const systemOrder = (r: Role) => (r.type === 'SYSTEM_DEFAULT' ? SYSTEM_ORDER.indexOf(r.roleId) : SYSTEM_ORDER.length)
const merchantName = (id?: string) => db.state().merchants.find((m) => m.merchantId === id)?.name
const by = (actor: Actor): Actor => ({ userId: actor.userId, fullName: actor.fullName })

const ROLE_ACTION_TEXT = { viewRoles: 'view roles', createRoles: 'create roles', editRoles: 'edit roles', changeRoleStatus: 'activate or deactivate roles' } as const

// REQ: DEC-102 — each operation on the Roles screen needs its own permission.
function requireRoles(me: AccountAccess, merchantId: string, action: keyof typeof ROLE_ACTION_TEXT = 'viewRoles') {
  if (!canInMerchant(me, action, merchantId)) throw new ServiceError('FORBIDDEN', `You do not have permission to ${ROLE_ACTION_TEXT[action]}.`)
}

/** Roles a merchant sees: the System Default ones and its own Custom ones. */
// REQ: DEC-99 — merchant roles only: platform roles never reach a merchant's screens.
const rolesFor = (merchantId: string) => db.state().roles.filter((r) => r.audience === 'MERCHANT' && (!r.merchantId || r.merchantId === merchantId))

const accountsIn = (merchantId?: string) => db.state().accounts.filter((a) => !merchantId || a.merchantId === merchantId)

/** A Custom role the actor may change (System Default roles are read-only: validateRole says so). */
function loadRole(me: AccountAccess, roleId: string, action: 'editRoles' | 'changeRoleStatus'): Role & { merchantId?: string } {
  const r = db.state().roles.find((x) => x.roleId === roleId)
  if (!r || (r.merchantId && me.level !== 'SUPER_ADMIN' && r.merchantId !== me.merchantId)) throw new ServiceError('NOT_FOUND', `Role ${roleId} not found.`)
  // REQ: DEC-99 — platform roles exist only for super admins.
  if (r.audience === 'PLATFORM') {
    if (!canOnPlatform(me, 'manageStaff')) throw new ServiceError('NOT_FOUND', `Role ${roleId} not found.`)
    return r
  }
  if (r.merchantId) requireRoles(me, r.merchantId, action)
  else if (me.level !== 'SUPER_ADMIN') requireRoles(me, me.merchantId!, action)
  return r
}

const platformRoles = () => db.state().roles.filter((r) => r.audience === 'PLATFORM')

/** REQ: DEC-99 — Type = Platform: super admin only; no merchant; platform permissions only. */
function createPlatformRole(me: AccountAccess, input: NewRoleInput, actor: Actor): Role {
  if (!canOnPlatform(me, 'manageStaff')) throw new ServiceError('FORBIDDEN', 'Only super admins create platform roles.')
  const permissions = withImpliedPermissions(input.permissions)
  const errors = validateRole({ name: input.name, permissions, audience: 'PLATFORM' }, platformRoles())
  if (errors.length) throw validation(errors)
  const at = now().toISOString()
  const role: Role = {
    roleId: adoptDraftId('rol', input.roleId, (id) => db.state().roles.some((r) => r.roleId === id)),
    audience: 'PLATFORM',
    name: input.name.trim(),
    type: 'CUSTOM',
    permissions,
    status: input.status ?? 'ACTIVE',
    createdAt: at,
    createdBy: by(actor),
    updatedAt: at,
    updatedBy: by(actor),
  }
  db.setState((st) => ({ roles: [...st.roles, role] }))
  auditAccess(actor, 'ROLE_CREATED', undefined, { roleId: role.roleId, name: role.name, type: 'Platform (internal)', permissions, status: role.status, summary: `Platform role ${role.name} created` })
  return role
}

const putRole = (r: Role) => db.setState((st) => ({ roles: st.roles.map((x) => (x.roleId === r.roleId ? r : x)) }))

const granter = (me: AccountAccess) => (me.level === 'SUPER_ADMIN' ? ('SUPER_ADMIN' as const) : me.grants)

export const mockRoleService: RoleService = {
  async list(actor, merchantId) {
    await simulateNetwork('list roles')
    const me = accountOf(actor)
    const scope = me.level === 'SUPER_ADMIN' ? merchantId : me.merchantId!
    if (me.level !== 'SUPER_ADMIN') requireRoles(me, scope!)
    const roles = scope ? rolesFor(scope) : db.state().roles
    const people = accountsIn(scope)
    return wire(
      roles
        .map((r): RoleRow => {
          const holders = holdersOf(r.roleId, people)
          return {
            ...r,
            merchantName: merchantName(r.merchantId),
            users: holders.length,
            projects: new Set(
              holders.flatMap((a) =>
                a.assignments
                  .filter((x) => x.roleId === r.roleId)
                  .flatMap((x) => (x.scope.kind === 'PROJECTS' ? x.scope.projectIds : db.state().projects.filter((p) => p.merchantId === a.merchantId).map((p) => p.projectId))),
              ),
            ).size,
            heldForSelectedProjects: holders.some((a) => a.assignments.some((x) => x.roleId === r.roleId && x.scope.kind === 'PROJECTS')),
          }
        })
        .sort((a, b) => systemOrder(a) - systemOrder(b) || a.createdAt.localeCompare(b.createdAt)),
    )
  },

  async assignable(merchantId, actor, projectId) {
    await simulateNetwork('assignable roles')
    const me = accountOf(actor)
    // REQ: DEC-102 — the role picker of New user, Add / Edit access and Members.
    const manages = canInMerchant(me, 'inviteUsers', merchantId) || canInMerchant(me, 'changeUserAccess', merchantId) || db.state().projects.some((p) => p.merchantId === merchantId && canInProject(me, 'manageMembers', p))
    if (!manages) throw new ServiceError('FORBIDDEN', 'You do not manage access in this merchant.')
    const open = db.state().projects.filter((p) => p.merchantId === merchantId && p.status === 'ACTIVE').map((p) => p.projectId)
    const g = granter(me)
    const inProject = (r: Role, id: string) => !isMerchantLevel(r.permissions) && canGrant(g, r.permissions, { kind: 'PROJECTS', projectIds: [id] })
    const grantable = (r: Role) => (projectId ? inProject(r, projectId) : canGrant(g, r.permissions, { kind: 'ALL_PROJECTS' }) || open.some((id) => inProject(r, id)))
    return wire(rolesFor(merchantId).filter((r) => r.status === 'ACTIVE' && grantable(r)))
  },

  async draftRoleId(actor) {
    await simulateNetwork('draft role id')
    const me = accountOf(actor)
    if (me.level !== 'SUPER_ADMIN') requireRoles(me, me.merchantId!, 'createRoles')
    return newId('rol')
  },

  async create(merchantId, input, actor) {
    await simulateNetwork('create role')
    const me = requireActive(actor)
    if (input.audience === 'PLATFORM') return wire(createPlatformRole(me, input, actor))
    if (!merchantId || !db.state().merchants.some((m) => m.merchantId === merchantId) || (me.level !== 'SUPER_ADMIN' && me.merchantId !== merchantId)) throw new ServiceError('NOT_FOUND', `Merchant ${merchantId} not found.`)
    requireRoles(me, merchantId, 'createRoles')
    const permissions = withImpliedPermissions(input.permissions)
    const errors = validateRole({ name: input.name, permissions, audience: 'MERCHANT' }, rolesFor(merchantId))
    if (errors.length) throw validation(errors)
    // REQ: DEC-74 — a role is a grant waiting to happen: nobody defines one more powerful than their own access.
    if (!canGrant(granter(me), permissions, { kind: 'ALL_PROJECTS' })) throw new ServiceError('FORBIDDEN', GRANT_TOO_POWERFUL)
    const at = now().toISOString()
    const role: Role = {
      roleId: adoptDraftId('rol', input.roleId, (id) => db.state().roles.some((r) => r.roleId === id)), // DEC-76
      audience: 'MERCHANT',
      merchantId,
      name: input.name.trim(),
      type: 'CUSTOM',
      permissions,
      status: input.status ?? 'ACTIVE',
      createdAt: at,
      createdBy: by(actor),
      updatedAt: at,
      updatedBy: by(actor),
    }
    db.setState((st) => ({ roles: [...st.roles, role] }))
    auditAccess(actor, 'ROLE_CREATED', merchantId, { roleId: role.roleId, name: role.name, permissions, status: role.status, summary: `Role ${role.name} created${role.status === 'INACTIVE' ? ' (inactive)' : ''}` })
    return wire(role)
  },

  async update(roleId, input, actor) {
    await simulateNetwork('update role')
    const me = requireActive(actor)
    const r = loadRole(me, roleId, 'editRoles')
    const holders = holdersOf(roleId, db.state().accounts)
    const heldForSelectedProjects = holders.some((a) => a.assignments.some((x) => x.roleId === roleId && x.scope.kind === 'PROJECTS'))
    const permissions = withImpliedPermissions(input.permissions)
    const others = r.audience === 'PLATFORM' ? platformRoles() : r.merchantId ? rolesFor(r.merchantId) : db.state().roles
    const errors = validateRole({ name: input.name, permissions, audience: r.audience }, others, { ...r, heldForSelectedProjects })
    if (errors.length) throw validation(errors)
    if (r.audience === 'MERCHANT' && !canGrant(granter(me), permissions, { kind: 'ALL_PROJECTS' })) throw new ServiceError('FORBIDDEN', GRANT_TOO_POWERFUL)
    const changes = [
      ...(r.name !== input.name.trim() ? [{ field: 'Role name', from: r.name, to: input.name.trim() }] : []),
      ...(r.permissions.join() !== permissions.join() ? [{ field: `${r.name} permissions`, from: permissionList(r.permissions), to: permissionList(permissions) }] : []),
    ]
    if (!changes.length) return wire(r)
    const updated: Role = { ...r, name: input.name.trim(), permissions, updatedAt: now().toISOString(), updatedBy: by(actor) }
    putRole(updated)
    auditAccess(actor, 'ROLE_UPDATED', r.merchantId, { roleId, users: holders.length, changes })
    // Holders who lost Claim (or Approve / reject) lose their open claims (DEC-74).
    releaseLostClaims(actor, holders.map((a) => a.userId), 'Role changed')
    return wire(updated)
  },

  async setStatus(roleId, status, actor) {
    await simulateNetwork('set role status')
    const me = requireActive(actor)
    const r = loadRole(me, roleId, 'changeRoleStatus')
    const errors = validateRoleStatus(r, status, holdersOf(roleId, db.state().accounts).length)
    if (errors.length) throw validation(errors)
    if (r.status === status) return wire(r)
    const updated: Role = { ...r, status, updatedAt: now().toISOString(), updatedBy: by(actor) }
    putRole(updated)
    auditAccess(actor, 'ROLE_STATUS_CHANGED', r.merchantId, { roleId, changes: [{ field: `${r.name} status`, from: r.status, to: status }] })
    return wire(updated)
  },
}

export const roleService: RoleService = mockRoleService

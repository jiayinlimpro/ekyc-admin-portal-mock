// Roles API (mock): [FRS] User Management › Roles (DEC-70, DEC-76). System Default roles are shared and locked; each
// merchant adds Custom roles. Editing a role applies at once to everyone holding it.
//   GET  /roles?merchantId=…        list        → 200 RoleRow[]
//   GET  /merchants/{id}/roles/assignable  assignable → 200 Role[] (active; for the access pickers)
//   POST /merchants/{id}/roles      create      → 201 Role | 403 | 422
//   PUT  /roles/{id}                update      → 200 Role | 403 | 422
//   POST /roles/{id}/status         setStatus   → 200 Role | 422 (still assigned)
import { canInMerchant, canInProject } from '@/domain/access'
import { canGrant, GRANT_TOO_POWERFUL, holdersOf, validateRole, validateRoleStatus, withImpliedPermissions } from '@/domain/roles'
import type { Actor, Permission, Role, RoleStatus } from '@/domain/types'
import { now } from '@/lib/clock'
import { permissionList } from '@/lib/labels'
import { db } from '@/mocks/mockDb'
import { accountOf, requireActive, type AccountAccess } from './accessGuard'
import { ServiceError } from './errors'
import { simulateNetwork, wire } from './network'
import { nextId, validation } from './projectService'
import { auditAccess, releaseLostClaims } from './userAdminService'

export interface RoleInput {
  name: string
  permissions: Permission[]
}

/** A row on the Roles screen. `users`: holders in the viewer's scope; "Affects N users" before a save. */
export type RoleRow = Role & { merchantName?: string; users: number; heldForSelectedProjects: boolean }

export interface RoleService {
  list(actor: Actor, merchantId?: string): Promise<RoleRow[]>
  /** Active roles a merchant can assign: System Default plus its own (Users screen and Members tab). */
  assignable(merchantId: string, actor: Actor): Promise<Role[]>
  create(merchantId: string, input: RoleInput, actor: Actor): Promise<Role>
  update(roleId: string, input: RoleInput, actor: Actor): Promise<Role>
  setStatus(roleId: string, status: RoleStatus, actor: Actor): Promise<Role>
}

const merchantName = (id?: string) => db.state().merchants.find((m) => m.merchantId === id)?.name
const by = (actor: Actor): Actor => ({ userId: actor.userId, fullName: actor.fullName })

function requireRoles(me: AccountAccess, merchantId: string) {
  if (!canInMerchant(me, 'manageUsersRoles', merchantId)) throw new ServiceError('FORBIDDEN', 'You do not have permission to manage roles.')
}

/** Roles a merchant sees: the System Default ones and its own Custom ones. */
const rolesFor = (merchantId: string) => db.state().roles.filter((r) => !r.merchantId || r.merchantId === merchantId)

const accountsIn = (merchantId?: string) => db.state().accounts.filter((a) => !merchantId || a.merchantId === merchantId)

/** A Custom role the actor may change (System Default roles are read-only: validateRole says so). */
function loadRole(me: AccountAccess, roleId: string): Role & { merchantId?: string } {
  const r = db.state().roles.find((x) => x.roleId === roleId)
  if (!r || (r.merchantId && me.level !== 'PLATFORM_ADMIN' && r.merchantId !== me.merchantId)) throw new ServiceError('NOT_FOUND', `Role ${roleId} not found.`)
  if (r.merchantId) requireRoles(me, r.merchantId)
  else if (me.level !== 'PLATFORM_ADMIN') requireRoles(me, me.merchantId!)
  return r
}

const putRole = (r: Role) => db.setState((st) => ({ roles: st.roles.map((x) => (x.roleId === r.roleId ? r : x)) }))

const granter = (me: AccountAccess) => (me.level === 'PLATFORM_ADMIN' ? ('PLATFORM_ADMIN' as const) : me.grants)

export const mockRoleService: RoleService = {
  async list(actor, merchantId) {
    await simulateNetwork('list roles')
    const me = accountOf(actor)
    const scope = me.level === 'PLATFORM_ADMIN' ? merchantId : me.merchantId!
    if (me.level !== 'PLATFORM_ADMIN') requireRoles(me, scope!)
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
            heldForSelectedProjects: holders.some((a) => a.assignments.some((x) => x.roleId === r.roleId && x.scope.kind === 'PROJECTS')),
          }
        })
        .sort((a, b) => Number(b.type === 'SYSTEM_DEFAULT') - Number(a.type === 'SYSTEM_DEFAULT') || a.roleId.localeCompare(b.roleId)),
    )
  },

  async assignable(merchantId, actor) {
    await simulateNetwork('assignable roles')
    const me = accountOf(actor)
    const manages = canInMerchant(me, 'manageUsersRoles', merchantId) || db.state().projects.some((p) => p.merchantId === merchantId && canInProject(me, 'manageMembers', p))
    if (!manages) throw new ServiceError('FORBIDDEN', 'You do not manage access in this merchant.')
    return wire(rolesFor(merchantId).filter((r) => r.status === 'ACTIVE'))
  },

  async create(merchantId, input, actor) {
    await simulateNetwork('create role')
    const me = requireActive(actor)
    if (!db.state().merchants.some((m) => m.merchantId === merchantId) || (me.level !== 'PLATFORM_ADMIN' && me.merchantId !== merchantId)) throw new ServiceError('NOT_FOUND', `Merchant ${merchantId} not found.`)
    requireRoles(me, merchantId)
    const permissions = withImpliedPermissions(input.permissions)
    const errors = validateRole({ name: input.name, permissions }, rolesFor(merchantId))
    if (errors.length) throw validation(errors)
    // REQ: DEC-74 — a role is a grant waiting to happen: nobody defines one more powerful than their own access.
    if (!canGrant(granter(me), permissions, { kind: 'ALL_PROJECTS' })) throw new ServiceError('FORBIDDEN', GRANT_TOO_POWERFUL)
    const at = now().toISOString()
    const role: Role = {
      roleId: nextId('ROL-2026-', db.state().roles.map((r) => r.roleId)),
      merchantId,
      name: input.name.trim(),
      type: 'CUSTOM',
      permissions,
      status: 'ACTIVE',
      createdAt: at,
      createdBy: by(actor),
      updatedAt: at,
      updatedBy: by(actor),
    }
    db.setState((st) => ({ roles: [...st.roles, role] }))
    auditAccess(actor, 'ROLE_CREATED', merchantId, { roleId: role.roleId, name: role.name, permissions, summary: `Role ${role.name} created` })
    return wire(role)
  },

  async update(roleId, input, actor) {
    await simulateNetwork('update role')
    const me = requireActive(actor)
    const r = loadRole(me, roleId)
    const holders = holdersOf(roleId, db.state().accounts)
    const heldForSelectedProjects = holders.some((a) => a.assignments.some((x) => x.roleId === roleId && x.scope.kind === 'PROJECTS'))
    const permissions = withImpliedPermissions(input.permissions)
    const errors = validateRole({ name: input.name, permissions }, r.merchantId ? rolesFor(r.merchantId) : db.state().roles, { ...r, heldForSelectedProjects })
    if (errors.length) throw validation(errors)
    if (!canGrant(granter(me), permissions, { kind: 'ALL_PROJECTS' })) throw new ServiceError('FORBIDDEN', GRANT_TOO_POWERFUL)
    const changes = [
      ...(r.name !== input.name.trim() ? [{ field: 'Role name', from: r.name, to: input.name.trim() }] : []),
      ...(r.permissions.join() !== permissions.join() ? [{ field: `${r.name} permissions`, from: permissionList(r.permissions), to: permissionList(permissions) }] : []),
    ]
    if (!changes.length) return wire(r)
    const updated: Role = { ...r, name: input.name.trim(), permissions, updatedAt: now().toISOString(), updatedBy: by(actor) }
    putRole(updated)
    auditAccess(actor, 'ROLE_UPDATED', r.merchantId!, { roleId, users: holders.length, changes })
    // Holders who lost Claim (or Approve / reject) lose their open claims (DEC-74).
    releaseLostClaims(actor, holders.map((a) => a.userId), 'Role changed')
    return wire(updated)
  },

  async setStatus(roleId, status, actor) {
    await simulateNetwork('set role status')
    const me = requireActive(actor)
    const r = loadRole(me, roleId)
    const errors = validateRoleStatus(r, status, holdersOf(roleId, db.state().accounts).length)
    if (errors.length) throw validation(errors)
    if (r.status === status) return wire(r)
    const updated: Role = { ...r, status, updatedAt: now().toISOString(), updatedBy: by(actor) }
    putRole(updated)
    auditAccess(actor, 'ROLE_STATUS_CHANGED', r.merchantId!, { roleId, changes: [{ field: `${r.name} status`, from: r.status, to: status }] })
    return wire(updated)
  },
}

export const roleService: RoleService = mockRoleService

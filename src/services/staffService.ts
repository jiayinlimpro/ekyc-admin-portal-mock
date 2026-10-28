// Platform staff API (mock): internal accounts with one platform role and no scope (DEC-99, DEC-104). Super admin only;
// merchant admins never see them ("not found"). The list also shows the one super admin, read-only (DEC-110).
//   GET    /staff                       list               → 200 StaffRow[] (the super admin first)
//   GET    /staff/{id}                  get                → 200 StaffDetail | 404
//   POST   /staff                       invite             → 201 StaffRow (Pending) | 422
//   POST   /staff/{id}/invitation       resendInvitation   → 200 | 422 (not Pending)
//   PUT    /staff/{id}/role             setRole            → 200 StaffDetail | 422
//   POST   /staff/{id}/suspend | reactivate
//   Any change to the super admin                          → 422 (created by the seed, never changed)
import { canOnPlatform } from '@/domain/access'
import { STAFF_EMAIL_DOMAIN } from '@/domain/openQuestions'
import { validateAssignment, withImpliedPermissions, type AccessChip } from '@/domain/roles'
import type { Actor, AuditAction, Role, RoleAssignment, UserAccount, UserStatus } from '@/domain/types'
import { now } from '@/lib/clock'
import { adoptDraftId, newId } from '@/lib/ids'
import { db } from '@/mocks/mockDb'
import { accountOf, nextAssignmentId, requireActive } from './accessGuard'
import { ServiceError } from './errors'
import { simulateNetwork, wire } from './network'
import { validation } from './projectService'
import { auditAccess, releaseLostClaims, requireNewUser } from './userAdminService'

export interface StaffRow {
  userId: string
  fullName: string
  email: string
  /** REQ: DEC-104 — one platform role, for every merchant (no scope). */
  access: AccessChip[] // ["Support"]
  roleId?: string
  status: UserStatus
  createdAt: string
  /** REQ: DEC-110 — the super admin: created by the seed, nothing can be changed. */
  fixed?: true
}

export interface StaffDetail extends StaffRow {
  lastActiveAt?: string
  roleName?: string
  isSelf: false
  canManage: boolean
}

export interface StaffService {
  list(actor: Actor): Promise<StaffRow[]>
  get(userId: string, actor: Actor): Promise<StaffDetail>
  /** Active platform roles, for the Staff role picker. */
  assignableRoles(actor: Actor): Promise<Role[]>
  draftUserId(actor: Actor): Promise<string>
  invite(input: { userId?: string; fullName: string; email: string; roleId: string }, actor: Actor): Promise<StaffRow>
  resendInvitation(userId: string, actor: Actor): Promise<void>
  /** REQ: DEC-104 — change the staff member's platform role. */
  setRole(userId: string, roleId: string, actor: Actor): Promise<StaffDetail>
  suspend(userId: string, actor: Actor): Promise<StaffRow>
  reactivate(userId: string, actor: Actor): Promise<StaffRow>
}

// REQ: DEC-99 — only super admins manage platform staff; to anyone else they don't exist.
function requireSuper(actor: Actor) {
  if (!canOnPlatform(accountOf(actor), 'manageStaff')) throw new ServiceError('NOT_FOUND', 'Not found.')
}

const roleOf = (roleId: string) => db.state().roles.find((r) => r.roleId === roleId)
const by = (actor: Actor): Actor => ({ userId: actor.userId, fullName: actor.fullName })

export const SUPER_ADMIN_FIXED = 'The super admin is created at setup and can’t be changed.'

function loadStaff(userId: string): UserAccount {
  const a = db.state().accounts.find((x) => x.userId === userId && x.level !== 'MERCHANT_USER')
  if (!a) throw new ServiceError('NOT_FOUND', `User ${userId} not found.`)
  // REQ: DEC-110 — the super admin is listed, but nothing about it can be opened or changed here.
  if (a.level === 'SUPER_ADMIN') throw validation([{ field: 'userId', message: SUPER_ADMIN_FIXED }])
  return a
}

const putAccount = (a: UserAccount) => db.setState((st) => ({ accounts: st.accounts.map((x) => (x.userId === a.userId ? a : x)) }))

/** REQ: DEC-104 — a platform role, for every merchant. */
function checkRole(roleId: string): Role {
  const role = roleOf(roleId)
  if (!role) throw validation([{ field: 'roleId', message: 'Choose a staff role.' }])
  const errors = validateAssignment(role, { kind: 'ALL_MERCHANTS' }, [])
  if (errors.length) throw validation(errors)
  return role
}

const roleName = (a: UserAccount) => (a.assignments[0] ? (roleOf(a.assignments[0].roleId)?.name ?? a.assignments[0].roleId) : undefined)

// REQ: DEC-42 — staff changes are audited like user changes, with no merchant.
function audit(actor: Actor, action: AuditAction, details: Record<string, unknown>) {
  auditAccess(actor, action, undefined, details)
}

function rowOf(a: UserAccount): StaffRow {
  if (a.level === 'SUPER_ADMIN') return { userId: a.userId, fullName: a.fullName, email: a.email, access: [{ label: 'Super admin', archived: false }], status: a.status, createdAt: a.invitedAt, fixed: true }
  const name = roleName(a)
  return { userId: a.userId, fullName: a.fullName, email: a.email, access: name ? [{ label: name, archived: false }] : [], roleId: a.assignments[0]?.roleId, status: a.status, createdAt: a.invitedAt }
}

const detailOf = (a: UserAccount): StaffDetail => ({ ...rowOf(a), lastActiveAt: a.lastActiveAt, roleName: roleName(a), isSelf: false, canManage: true })

export const mockStaffService: StaffService = {
  async list(actor) {
    await simulateNetwork('list staff')
    requireSuper(actor)
    // REQ: DEC-110 — the super admin first, then staff, newest first.
    const internal = db.state().accounts.filter((a) => a.level !== 'MERCHANT_USER').map(rowOf)
    return wire(internal.sort((a, b) => Number(!!b.fixed) - Number(!!a.fixed) || b.createdAt.localeCompare(a.createdAt)))
  },

  async get(userId, actor) {
    await simulateNetwork('get staff')
    requireSuper(actor)
    return wire(detailOf(loadStaff(userId)))
  },

  async assignableRoles(actor) {
    await simulateNetwork('staff roles')
    requireSuper(actor)
    return wire(db.state().roles.filter((r) => r.audience === 'PLATFORM' && r.status === 'ACTIVE').map((r) => ({ ...r, permissions: withImpliedPermissions(r.permissions) })))
  },

  async draftUserId(actor) {
    await simulateNetwork('draft staff id')
    requireSuper(actor)
    return newId('usr')
  },

  async invite(input, actor) {
    await simulateNetwork('invite staff')
    requireActive(actor)
    requireSuper(actor)
    const email = requireNewUser(input, 'INTERNAL') // REQ: DEC-99 / OQ-31 — the company staff domain
    const role = checkRole(input.roleId)
    const at = now().toISOString()
    const account: UserAccount = {
      userId: adoptDraftId('usr', input.userId, (id) => db.state().accounts.some((a) => a.userId === id)),
      fullName: input.fullName.trim(),
      email,
      level: 'PLATFORM_STAFF',
      assignments: [{ assignmentId: nextAssignmentId(), roleId: role.roleId, scope: { kind: 'ALL_MERCHANTS' }, addedBy: by(actor), addedAt: at }],
      status: 'PENDING',
      invitationId: newId('inv'),
      invitedAt: at,
    }
    db.setState((st) => ({ accounts: [...st.accounts, account] }))
    audit(actor, 'USER_INVITED', { userId: account.userId, fullName: account.fullName, email, access: role.name, type: 'Platform (internal)', summary: `${account.fullName} invited as ${role.name}` })
    return wire(rowOf(account))
  },

  async resendInvitation(userId, actor) {
    await simulateNetwork('resend staff invitation')
    requireActive(actor)
    requireSuper(actor)
    const a = loadStaff(userId)
    if (a.status !== 'PENDING') throw validation([{ field: 'status', message: 'Only Pending users have an invitation to resend.' }])
    const invitationId = newId('inv')
    putAccount({ ...a, invitationId })
    audit(actor, 'USER_INVITATION_RESENT', { userId, fullName: a.fullName, email: a.email, invitationId, summary: `Invitation resent to ${a.email}` })
  },

  async setRole(userId, roleId, actor) {
    await simulateNetwork('change staff role')
    requireActive(actor)
    requireSuper(actor)
    const a = loadStaff(userId)
    const role = checkRole(roleId)
    const old = a.assignments[0]
    if (old?.roleId === roleId) return wire(detailOf(a))
    const next: RoleAssignment = { assignmentId: old?.assignmentId ?? nextAssignmentId(), roleId, scope: { kind: 'ALL_MERCHANTS' }, addedBy: by(actor), addedAt: now().toISOString() }
    const updated = { ...a, assignments: [next] }
    putAccount(updated)
    audit(actor, 'USER_ACCESS_CHANGED', { userId, fullName: a.fullName, changes: [{ field: `${a.fullName} role`, from: roleName(a) ?? '—', to: role.name }] })
    releaseLostClaims(actor, [userId], 'Role changed')
    return wire(detailOf(updated))
  },

  async suspend(userId, actor) {
    await simulateNetwork('suspend staff')
    requireActive(actor)
    requireSuper(actor)
    const a = loadStaff(userId)
    if (a.status === 'SUSPENDED') return wire(rowOf(a))
    const updated = { ...a, status: 'SUSPENDED' as const }
    putAccount(updated)
    audit(actor, 'USER_SUSPENDED', { userId, fullName: a.fullName, changes: [{ field: `${a.fullName} status`, from: a.status, to: 'SUSPENDED' }] })
    releaseLostClaims(actor, [userId], 'User suspended')
    return wire(rowOf(updated))
  },

  async reactivate(userId, actor) {
    await simulateNetwork('reactivate staff')
    requireActive(actor)
    requireSuper(actor)
    const a = loadStaff(userId)
    if (a.status !== 'SUSPENDED') return wire(rowOf(a))
    const updated = { ...a, status: 'ACTIVE' as const }
    putAccount(updated)
    audit(actor, 'USER_REACTIVATED', { userId, fullName: a.fullName, changes: [{ field: `${a.fullName} status`, from: 'SUSPENDED', to: 'ACTIVE' }] })
    return wire(rowOf(updated))
  },
}

export const staffService: StaffService = mockStaffService

export { STAFF_EMAIL_DOMAIN }

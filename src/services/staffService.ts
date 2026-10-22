// Platform staff API (mock): internal accounts with platform roles (DEC-99). Super admin only; merchant admins never
// see them ("not found"). The Users screen lists them next to merchant users, with Type = Platform.
//   GET    /staff                                  list               → 200 StaffRow[]
//   GET    /staff/{id}                             get                → 200 StaffDetail | 404
//   POST   /staff                                  invite             → 201 StaffRow (Pending) | 422
//   POST   /staff/{id}/invitation                  resendInvitation   → 200 | 422 (not Pending)
//   POST|PUT|DELETE /staff/{id}/assignments[/{aid}] add / change / remove access
//   POST   /staff/{id}/suspend | reactivate
import { canOnPlatform } from '@/domain/access'
import { STAFF_EMAIL_DOMAIN } from '@/domain/openQuestions'
import { hasMerchantAccess, scopeLabel, validateAssignment, withImpliedPermissions } from '@/domain/roles'
import type { AccessChip } from '@/domain/roles'
import type { Actor, AssignmentScope, AuditAction, Role, RoleAssignment, UserAccount, UserStatus } from '@/domain/types'
import { now } from '@/lib/clock'
import { adoptDraftId, newId } from '@/lib/ids'
import { db } from '@/mocks/mockDb'
import { accountOf, nextAssignmentId, requireActive } from './accessGuard'
import { ServiceError } from './errors'
import { simulateNetwork, wire } from './network'
import { validation } from './projectService'
import { auditAccess, chipsOf, releaseLostClaims, requireNewUser, type AssignmentInput } from './userAdminService'

export interface StaffRow {
  userId: string
  fullName: string
  email: string
  access: AccessChip[] // "Support · All merchants", "Finance · Platform-wide"
  status: UserStatus
  createdAt: string
}

export interface StaffAssignmentRow {
  assignmentId: string
  roleId: string
  roleName: string
  scope: AssignmentScope
  scopeLabel: string
  /** The role has no merchant-access permissions: merchant scope doesn't apply (DEC-99). */
  platformWide: boolean
  addedBy: Actor
  addedAt: string
  editable: boolean
}

export interface StaffDetail extends StaffRow {
  lastActiveAt?: string
  assignments: StaffAssignmentRow[]
  isSelf: false
  canManage: boolean
}

export interface StaffService {
  list(actor: Actor): Promise<StaffRow[]>
  get(userId: string, actor: Actor): Promise<StaffDetail>
  /** Active platform roles, for the Staff role picker. */
  assignableRoles(actor: Actor): Promise<Role[]>
  draftUserId(actor: Actor): Promise<string>
  invite(input: { userId?: string; fullName: string; email: string; assignment: AssignmentInput }, actor: Actor): Promise<StaffRow>
  resendInvitation(userId: string, actor: Actor): Promise<void>
  addAssignment(userId: string, input: AssignmentInput, actor: Actor): Promise<StaffDetail>
  changeAssignment(userId: string, assignmentId: string, input: AssignmentInput, actor: Actor): Promise<StaffDetail>
  removeAssignment(userId: string, assignmentId: string, actor: Actor): Promise<StaffDetail>
  suspend(userId: string, actor: Actor): Promise<StaffRow>
  reactivate(userId: string, actor: Actor): Promise<StaffRow>
}

// REQ: DEC-99 — only super admins manage platform staff; to anyone else they don't exist.
function requireSuper(actor: Actor) {
  if (!canOnPlatform(accountOf(actor), 'manageStaff')) throw new ServiceError('NOT_FOUND', 'Not found.')
}

const merchantName = (id: string) => db.state().merchants.find((m) => m.merchantId === id)?.name ?? id
const roleOf = (roleId: string) => db.state().roles.find((r) => r.roleId === roleId)
const by = (actor: Actor): Actor => ({ userId: actor.userId, fullName: actor.fullName })

function loadStaff(userId: string): UserAccount {
  const a = db.state().accounts.find((x) => x.userId === userId && x.level === 'PLATFORM_STAFF')
  if (!a) throw new ServiceError('NOT_FOUND', `User ${userId} not found.`)
  return a
}

const putAccount = (a: UserAccount) => db.setState((st) => ({ accounts: st.accounts.map((x) => (x.userId === a.userId ? a : x)) }))

/** A platform role and a merchant scope; a role with no merchant access is stored as All merchants and shown "Platform-wide". */
function checkAssignment(input: AssignmentInput): RoleAssignment['scope'] {
  const role = roleOf(input.roleId)
  if (!role || role.audience !== 'PLATFORM') throw validation([{ field: 'roleId', message: 'Choose a staff role.' }])
  const scope: AssignmentScope = hasMerchantAccess(role.permissions) ? input.scope : { kind: 'ALL_MERCHANTS' }
  const errors = [...validateAssignment(role, scope, [], db.state().merchants.map((m) => m.merchantId))]
  if (errors.length) throw validation(errors)
  return scope
}

const label = (x: Pick<RoleAssignment, 'roleId' | 'scope'>) => {
  const r = roleOf(x.roleId)
  if (!r) return x.roleId
  return hasMerchantAccess(r.permissions) ? `${r.name} · ${scopeLabel(x.scope, (id) => id, merchantName)}` : `${r.name} · Platform-wide`
}

// REQ: DEC-42 — staff changes are audited like user changes, with no merchant.
function audit(actor: Actor, action: AuditAction, details: Record<string, unknown>) {
  auditAccess(actor, action, undefined, details)
}

function rowOf(a: UserAccount): StaffRow {
  return { userId: a.userId, fullName: a.fullName, email: a.email, access: chipsOf(a.assignments), status: a.status, createdAt: a.invitedAt }
}

function detailOf(a: UserAccount): StaffDetail {
  return {
    ...rowOf(a),
    lastActiveAt: a.lastActiveAt,
    isSelf: false,
    canManage: true,
    assignments: a.assignments.map((x) => {
      const r = roleOf(x.roleId)
      return {
        assignmentId: x.assignmentId,
        roleId: x.roleId,
        roleName: r?.name ?? x.roleId,
        scope: x.scope,
        scopeLabel: r && !hasMerchantAccess(r.permissions) ? 'Platform-wide' : scopeLabel(x.scope, (id) => id, merchantName),
        platformWide: !!r && !hasMerchantAccess(r.permissions),
        addedBy: x.addedBy,
        addedAt: x.addedAt,
        editable: true,
      }
    }),
  }
}

export const mockStaffService: StaffService = {
  async list(actor) {
    await simulateNetwork('list staff')
    requireSuper(actor)
    return wire(db.state().accounts.filter((a) => a.level === 'PLATFORM_STAFF').map(rowOf).sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
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
    const scope = checkAssignment(input.assignment)
    const at = now().toISOString()
    const account: UserAccount = {
      userId: adoptDraftId('usr', input.userId, (id) => db.state().accounts.some((a) => a.userId === id)),
      fullName: input.fullName.trim(),
      email,
      level: 'PLATFORM_STAFF',
      assignments: [{ assignmentId: nextAssignmentId(), roleId: input.assignment.roleId, scope, addedBy: by(actor), addedAt: at }],
      status: 'PENDING',
      invitationId: newId('inv'),
      invitedAt: at,
    }
    db.setState((st) => ({ accounts: [...st.accounts, account] }))
    const access = label(account.assignments[0])
    audit(actor, 'USER_INVITED', { userId: account.userId, fullName: account.fullName, email, access, type: 'Platform (internal)', summary: `${account.fullName} invited as ${access}` })
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

  async addAssignment(userId, input, actor) {
    await simulateNetwork('add staff access')
    requireActive(actor)
    requireSuper(actor)
    const a = loadStaff(userId)
    const scope = checkAssignment(input)
    const assignment: RoleAssignment = { assignmentId: nextAssignmentId(), roleId: input.roleId, scope, addedBy: by(actor), addedAt: now().toISOString() }
    const updated = { ...a, assignments: [...a.assignments, assignment] }
    putAccount(updated)
    audit(actor, 'USER_ACCESS_ADDED', { userId, fullName: a.fullName, assignmentId: assignment.assignmentId, summary: `${a.fullName}: ${label(assignment)} added` })
    return wire(detailOf(updated))
  },

  async changeAssignment(userId, assignmentId, input, actor) {
    await simulateNetwork('change staff access')
    requireActive(actor)
    requireSuper(actor)
    const a = loadStaff(userId)
    const old = a.assignments.find((x) => x.assignmentId === assignmentId)
    if (!old) throw new ServiceError('NOT_FOUND', `Access ${assignmentId} not found.`)
    const next: RoleAssignment = { ...old, roleId: input.roleId, scope: checkAssignment(input) }
    const updated = { ...a, assignments: a.assignments.map((x) => (x.assignmentId === assignmentId ? next : x)) }
    putAccount(updated)
    audit(actor, 'USER_ACCESS_CHANGED', { userId, fullName: a.fullName, assignmentId, changes: [{ field: `${a.fullName} access`, from: label(old), to: label(next) }] })
    releaseLostClaims(actor, [userId], 'Access changed')
    return wire(detailOf(updated))
  },

  async removeAssignment(userId, assignmentId, actor) {
    await simulateNetwork('remove staff access')
    requireActive(actor)
    requireSuper(actor)
    const a = loadStaff(userId)
    const old = a.assignments.find((x) => x.assignmentId === assignmentId)
    if (!old) throw new ServiceError('NOT_FOUND', `Access ${assignmentId} not found.`)
    const updated = { ...a, assignments: a.assignments.filter((x) => x.assignmentId !== assignmentId) }
    putAccount(updated)
    audit(actor, 'USER_ACCESS_REMOVED', { userId, fullName: a.fullName, assignmentId, changes: [{ field: `${a.fullName} access`, from: label(old), to: 'Removed' }] })
    releaseLostClaims(actor, [userId], 'Access removed')
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

// Admins API (mock): the internal Super admin accounts, kept apart from merchant users (DEC-79). Super admin only.
// No roles or scopes: Super admin rights are fixed (DEC-70).
//   GET  /admins                          list              → 200 AdminRow[]
//   POST /admins                          invite            → 201 AdminRow (Pending) | 422
//   POST /admins/{id}/invitation          resendInvitation  → 200 AdminRow | 422 (not Pending)
//   POST /admins/{id}/suspend | reactivate                  → 200 AdminRow | 422 (last active admin, yourself)
import { canOnPlatform } from '@/domain/access'
import { makeAudit } from '@/domain/audit'
import type { Actor, AuditAction, UserAccount, UserStatus } from '@/domain/types'
import { now } from '@/lib/clock'
import { db } from '@/mocks/mockDb'
import { accountOf, requireActive } from './accessGuard'
import { ServiceError } from './errors'
import { clientIpFor, simulateNetwork, wire } from './network'
import { validation } from './projectService'
import { requireNewUser } from './userAdminService'
import { adoptDraftId, newId } from '@/lib/ids'

export interface AdminRow {
  userId: string
  fullName: string
  email: string
  status: UserStatus
  createdAt: string
  lastActiveAt?: string
  /** REQ: DEC-78 — Suspend is shown but disabled, with this reason. */
  suspendBlocked?: string
}

export interface AdminService {
  list(actor: Actor): Promise<AdminRow[]>
  /** REQ: DEC-79 / DEC-97 — the User ID shown read-only when New admin opens. */
  draftUserId(actor: Actor): Promise<string>
  invite(input: { userId?: string; fullName: string; email: string }, actor: Actor): Promise<AdminRow>
  resendInvitation(userId: string, actor: Actor): Promise<AdminRow>
  suspend(userId: string, actor: Actor): Promise<AdminRow>
  reactivate(userId: string, actor: Actor): Promise<AdminRow>
}

export const LAST_ADMIN = 'At least one active Super admin is required.'
export const NOT_YOURSELF = 'You can’t suspend yourself.'

function requireAdmins(actor: Actor) {
  if (!canOnPlatform(accountOf(actor), 'manageAdmins')) throw new ServiceError('FORBIDDEN', 'Only Super admin manages admins.')
}

const admins = () => db.state().accounts.filter((a) => a.level === 'SUPER_ADMIN')

/** REQ: DEC-79 — why this admin can't be suspended now, if anything. */
function suspendBlocked(actor: Actor, a: UserAccount): string | undefined {
  if (a.userId === actor.userId) return NOT_YOURSELF
  if (a.status === 'ACTIVE' && admins().filter((x) => x.status === 'ACTIVE').length <= 1) return LAST_ADMIN
  return undefined
}

const rowOf = (actor: Actor, a: UserAccount): AdminRow => ({
  userId: a.userId,
  fullName: a.fullName,
  email: a.email,
  status: a.status,
  createdAt: a.invitedAt,
  lastActiveAt: a.lastActiveAt,
  suspendBlocked: a.status === 'SUSPENDED' ? undefined : suspendBlocked(actor, a),
})

function loadAdmin(userId: string): UserAccount {
  const a = admins().find((x) => x.userId === userId)
  if (!a) throw new ServiceError('NOT_FOUND', `Admin ${userId} not found.`)
  return a
}

const putAccount = (a: UserAccount) => db.setState((st) => ({ accounts: st.accounts.map((x) => (x.userId === a.userId ? a : x)) }))

// REQ: DEC-42 — the user events; no merchant or project.
function audit(actor: Actor, action: AuditAction, details: Record<string, unknown>) {
  db.appendAudit(makeAudit({ id: '', now: now(), action, actor, actorRole: 'Super admin', ip: clientIpFor(actor), details }))
}

export const mockAdminService: AdminService = {
  async list(actor) {
    await simulateNetwork('list admins')
    requireAdmins(actor)
    return wire(admins().map((a) => rowOf(actor, a)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.userId.localeCompare(a.userId)))
  },

  async draftUserId(actor) {
    await simulateNetwork('draft admin id')
    requireAdmins(actor)
    return newId('usr')
  },

  async invite(input, actor) {
    await simulateNetwork('invite admin')
    requireActive(actor)
    requireAdmins(actor)
    const email = requireNewUser(input)
    const account: UserAccount = {
      userId: adoptDraftId('usr', input.userId, (id) => db.state().accounts.some((a) => a.userId === id)),
      fullName: input.fullName.trim(),
      email,
      level: 'SUPER_ADMIN',
      assignments: [],
      status: 'PENDING',
      invitationId: newId('inv'),
      invitedAt: now().toISOString(),
    }
    db.setState((st) => ({ accounts: [...st.accounts, account] }))
    audit(actor, 'USER_INVITED', { userId: account.userId, fullName: account.fullName, email, access: 'Super admin', summary: `${account.fullName} invited as Super admin` })
    return wire(rowOf(actor, account))
  },

  async resendInvitation(userId, actor) {
    await simulateNetwork('resend admin invitation')
    requireActive(actor)
    requireAdmins(actor)
    const a = loadAdmin(userId)
    if (a.status !== 'PENDING') throw validation([{ field: 'status', message: 'Only Pending users have an invitation to resend.' }])
    const invitationId = newId('inv') // a resend replaces the invitation: the old link stops working
    putAccount({ ...a, invitationId })
    audit(actor, 'USER_INVITATION_RESENT', { userId, fullName: a.fullName, email: a.email, invitationId, summary: `Invitation resent to ${a.email}` })
    return wire(rowOf(actor, a))
  },

  async suspend(userId, actor) {
    await simulateNetwork('suspend admin')
    requireActive(actor)
    requireAdmins(actor)
    const a = loadAdmin(userId)
    if (a.status === 'SUSPENDED') return wire(rowOf(actor, a))
    const blocked = suspendBlocked(actor, a)
    if (blocked) throw validation([{ field: 'status', message: blocked }])
    const updated = { ...a, status: 'SUSPENDED' as const }
    putAccount(updated)
    audit(actor, 'USER_SUSPENDED', { userId, fullName: a.fullName, changes: [{ field: `${a.fullName} status`, from: a.status, to: 'SUSPENDED' }] })
    return wire(rowOf(actor, updated))
  },

  async reactivate(userId, actor) {
    await simulateNetwork('reactivate admin')
    requireActive(actor)
    requireAdmins(actor)
    const a = loadAdmin(userId)
    if (a.status !== 'SUSPENDED') return wire(rowOf(actor, a))
    const updated = { ...a, status: 'ACTIVE' as const }
    putAccount(updated)
    audit(actor, 'USER_REACTIVATED', { userId, fullName: a.fullName, changes: [{ field: `${a.fullName} status`, from: 'SUSPENDED', to: 'ACTIVE' }] })
    return wire(rowOf(actor, updated))
  },
}

export const adminService: AdminService = mockAdminService

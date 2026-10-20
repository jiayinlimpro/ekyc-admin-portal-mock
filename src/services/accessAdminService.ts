// Users and Access API (mock). DEC-70, DEC-74: users belong to the merchant; one role per project. Project Admins manage
// their own project only; Merchant Owners every project; Platform Admin any merchant. Deactivation is account-wide.
//   GET    /merchants/{id}/users                 list         → 200 AccessRow[]
//   POST   /merchants/{id}/users                 invite       → 201 UserAccount (Invited)
//   PUT    /users/{id}/projects/{projectId}      setRole      → 200 UserAccount
//   DELETE /users/{id}/projects/{projectId}      removeAccess → 200 UserAccount (releases their open claims there)
//   POST   /users/{id}/deactivate                deactivate   → 200 UserAccount (releases all their open claims)
import { canInMerchant, canInProject } from '@/domain/access'
import { makeAudit } from '@/domain/audit'
import { CLEARED_CLAIM, isClaimActive } from '@/domain/claimRules'
import type { Actor, Project, ProjectRole, UserAccount } from '@/domain/types'
import { now } from '@/lib/clock'
import { db } from '@/mocks/mockDb'
import { accountOf, requireActive, roleIn } from './accessGuard'
import { ServiceError } from './errors'
import { clientIpFor, simulateNetwork, wire } from './network'
import { auditProject, nextId, validation } from './projectService'

export interface AccessRow {
  account: UserAccount
  /** Projects and roles; for a Merchant Owner every project of the merchant. */
  roles: { projectId: string; projectName: string; role: ProjectRole | 'MERCHANT_OWNER' }[]
  /** Projects in which the viewer may change this user's role (none for owners or the viewer themself). */
  editableProjectIds: string[]
  canDeactivate: boolean
}

export interface InviteInput {
  fullName: string
  email: string
  roles: { projectId: string; role: ProjectRole }[]
}

export interface AccessAdminService {
  list(merchantId: string, actor: Actor): Promise<AccessRow[]>
  /** Projects of the merchant where the viewer may manage members (invite and role pickers). */
  manageableProjects(merchantId: string, actor: Actor): Promise<Pick<Project, 'projectId' | 'name' | 'status'>[]>
  invite(merchantId: string, input: InviteInput, actor: Actor): Promise<UserAccount>
  setRole(userId: string, projectId: string, role: ProjectRole, actor: Actor): Promise<UserAccount>
  removeAccess(userId: string, projectId: string, actor: Actor): Promise<UserAccount>
  deactivate(userId: string, actor: Actor): Promise<UserAccount>
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ROLE_TEXT: Record<ProjectRole, string> = { PROJECT_ADMIN: 'Project Admin', REVIEWER: 'Reviewer', VIEWER: 'Viewer' }

function requireMerchantScope(actor: Actor, merchantId: string) {
  const me = accountOf(actor)
  if (!db.state().merchants.some((m) => m.merchantId === merchantId) || (me.level !== 'PLATFORM_ADMIN' && me.merchantId !== merchantId)) {
    throw new ServiceError('NOT_FOUND', `Merchant ${merchantId} not found.`)
  }
  return me
}

const managed = (actor: Actor, merchantId: string) => {
  const me = accountOf(actor)
  return db.state().projects.filter((p) => p.merchantId === merchantId && canInProject(me, 'manageMembers', p))
}

function loadTarget(actor: Actor, userId: string): UserAccount {
  const a = db.state().accounts.find((x) => x.userId === userId)
  const me = accountOf(actor)
  if (!a || a.level === 'PLATFORM_ADMIN' || (me.level !== 'PLATFORM_ADMIN' && a.merchantId !== me.merchantId)) throw new ServiceError('NOT_FOUND', `User ${userId} not found.`)
  if (a.userId === actor.userId) throw validation([{ field: 'user', message: 'You cannot change your own access.' }])
  if (a.level === 'MERCHANT_OWNER') throw validation([{ field: 'user', message: 'Merchant Owners have every project; their access is not changed here.' }])
  return a
}

function requireManages(actor: Actor, projectId: string): Project {
  const p = db.state().projects.find((x) => x.projectId === projectId)
  if (!p || !canInProject(accountOf(actor), 'manageMembers', p)) throw new ServiceError('FORBIDDEN', 'You do not manage members of this project.')
  return p
}

const putAccount = (a: UserAccount) => db.setState((st) => ({ accounts: st.accounts.map((x) => (x.userId === a.userId ? a : x)) }))

/** REQ: DEC-22 / DEC-74 — removing access (or deactivating) ends the user's open claims; each release is audited. */
function releaseClaims(actor: Actor, userId: string, projectId?: string) {
  const at = now()
  for (const v of db.state().verifications) {
    if (v.claimedBy?.userId !== userId || !isClaimActive(v, at) || (projectId && v.projectId !== projectId)) continue
    db.updateVerification(v.referenceNo, (x) => ({ ...x, ...CLEARED_CLAIM }))
    db.appendAudit(
      makeAudit({ id: '', now: at, action: 'CASE_RELEASED', actor, actorRole: roleIn(actor, v.projectId), ip: clientIpFor(actor), merchantId: v.merchantId, projectId: v.projectId, referenceNo: v.referenceNo, details: { claimedBy: v.claimedBy, reason: 'Access removed' } }),
    )
  }
}

export const mockAccessAdminService: AccessAdminService = {
  async list(merchantId, actor) {
    await simulateNetwork('list users and access')
    const me = requireMerchantScope(actor, merchantId)
    const s = db.state()
    const mine = managed(actor, merchantId)
    if (!mine.length) throw new ServiceError('FORBIDDEN', 'You do not manage members in this merchant.')
    const projects = s.projects.filter((p) => p.merchantId === merchantId)
    const name = (id: string) => projects.find((p) => p.projectId === id)?.name ?? id
    const ownerView = canInMerchant(me, 'manageMembers', merchantId)
    const rows = s.accounts
      .filter((a) => a.merchantId === merchantId && a.level !== 'PLATFORM_ADMIN')
      // Project Admins see the people of their projects (and owners); Owners and Platform Admin see everyone.
      .filter((a) => ownerView || a.level === 'MERCHANT_OWNER' || a.memberships.some((m) => mine.some((p) => p.projectId === m.projectId)))
      .map((a): AccessRow => {
        const editable = a.level === 'MEMBER' && a.userId !== actor.userId && a.status !== 'DEACTIVATED'
        return {
          account: a,
          roles: a.level === 'MERCHANT_OWNER' ? projects.map((p) => ({ projectId: p.projectId, projectName: p.name, role: 'MERCHANT_OWNER' as const })) : a.memberships.map((m) => ({ projectId: m.projectId, projectName: name(m.projectId), role: m.role })),
          editableProjectIds: editable ? mine.map((p) => p.projectId) : [],
          canDeactivate: editable && ownerView,
        }
      })
      .sort((a, b) => Number(b.account.level === 'MERCHANT_OWNER') - Number(a.account.level === 'MERCHANT_OWNER') || a.account.fullName.localeCompare(b.account.fullName))
    return wire(rows)
  },

  async manageableProjects(merchantId, actor) {
    await simulateNetwork('manageable projects')
    requireMerchantScope(actor, merchantId)
    return wire(managed(actor, merchantId).map(({ projectId, name, status }) => ({ projectId, name, status })))
  },

  async invite(merchantId, input, actor) {
    await simulateNetwork('invite user')
    requireActive(actor)
    requireMerchantScope(actor, merchantId)
    const errors = []
    const email = input.email.trim().toLowerCase()
    if (input.fullName.trim().length < 3) errors.push({ field: 'fullName', message: 'Full name must be at least 3 characters' })
    if (!EMAIL.test(email)) errors.push({ field: 'email', message: 'Enter a valid email address' })
    else if (db.state().accounts.some((a) => a.email.toLowerCase() === email)) errors.push({ field: 'email', message: 'A user with this email already exists' })
    if (!input.roles.length) errors.push({ field: 'roles', message: 'Give the user a role in at least one project' })
    if (errors.length) throw validation(errors)
    const projects = input.roles.map((r) => requireManages(actor, r.projectId))
    if (projects.some((p) => p.merchantId !== merchantId)) throw validation([{ field: 'roles', message: 'Projects must belong to this merchant' }])
    const account: UserAccount = {
      userId: nextId('USR-2026-', db.state().accounts.map((a) => a.userId)),
      fullName: input.fullName.trim(),
      email,
      level: 'MEMBER',
      merchantId,
      memberships: input.roles.map((r) => ({ projectId: r.projectId, role: r.role })),
      status: 'INVITED',
      invitedAt: now().toISOString(),
    }
    db.setState((st) => ({ accounts: [...st.accounts, account] }))
    for (const p of projects) {
      auditProject(actor, 'USER_INVITED', p, { userId: account.userId, fullName: account.fullName, email, role: ROLE_TEXT[account.memberships.find((m) => m.projectId === p.projectId)!.role] })
    }
    return wire(account)
  },

  async setRole(userId, projectId, role, actor) {
    await simulateNetwork('set project role')
    requireActive(actor)
    const p = requireManages(actor, projectId)
    const a = loadTarget(actor, userId)
    if (a.merchantId !== p.merchantId) throw validation([{ field: 'projectId', message: 'The project belongs to another merchant.' }])
    const before = a.memberships.find((m) => m.projectId === projectId)?.role
    if (before === role) return wire(a)
    // REQ: DEC-74 — one role per project.
    const updated = { ...a, memberships: [...a.memberships.filter((m) => m.projectId !== projectId), { projectId, role }] }
    putAccount(updated)
    auditProject(actor, 'USER_ROLE_CHANGED', p, { userId, fullName: a.fullName, changes: [{ field: 'Role', from: before ? ROLE_TEXT[before] : 'No access', to: ROLE_TEXT[role] }] })
    // A Reviewer who becomes a Viewer can no longer hold claims there.
    if (role === 'VIEWER') releaseClaims(actor, userId, projectId)
    return wire(updated)
  },

  async removeAccess(userId, projectId, actor) {
    await simulateNetwork('remove project access')
    requireActive(actor)
    const p = requireManages(actor, projectId)
    const a = loadTarget(actor, userId)
    const before = a.memberships.find((m) => m.projectId === projectId)
    if (!before) return wire(a)
    const updated = { ...a, memberships: a.memberships.filter((m) => m.projectId !== projectId) }
    putAccount(updated)
    auditProject(actor, 'USER_REMOVED', p, { userId, fullName: a.fullName, changes: [{ field: 'Role', from: ROLE_TEXT[before.role], to: 'No access' }] })
    releaseClaims(actor, userId, projectId)
    return wire(updated)
  },

  async deactivate(userId, actor) {
    await simulateNetwork('deactivate user')
    requireActive(actor)
    const a = loadTarget(actor, userId)
    if (!canInMerchant(accountOf(actor), 'manageMembers', a.merchantId!)) throw new ServiceError('FORBIDDEN', 'Only the Merchant Owner or Platform Admin can deactivate users.')
    if (a.status === 'DEACTIVATED') return wire(a)
    const updated: UserAccount = { ...a, status: 'DEACTIVATED' }
    putAccount(updated)
    db.appendAudit(makeAudit({ id: '', now: now(), action: 'USER_DEACTIVATED', actor, actorRole: accountOf(actor).level === 'PLATFORM_ADMIN' ? 'PLATFORM_ADMIN' : 'MERCHANT_OWNER', ip: clientIpFor(actor), merchantId: a.merchantId, details: { userId, fullName: a.fullName } }))
    releaseClaims(actor, userId)
    return wire(updated)
  },
}

export const accessAdminService: AccessAdminService = mockAccessAdminService

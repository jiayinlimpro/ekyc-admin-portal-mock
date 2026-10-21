// Users API (mock): [FRS] User Management › Users with scoped role assignments (DEC-70, DEC-74, DEC-77).
// Users with Manage users and roles (or Platform Admin) manage everything here; on a project's Members tab, users with
// Manage project members add and remove access for that project only.
//   GET    /users?merchantId=…                      list               → 200 UserRow[]
//   GET    /users/{id}                              get                → 200 UserDetail | 404
//   POST   /merchants/{id}/users                    invite             → 201 UserRow (Pending) | 403 | 422
//   POST   /users/{id}/invitation                   resendInvitation   → 200 UserRow | 422 (not Pending)
//   POST   /users/{id}/assignments                  addAssignment      → 200 UserDetail | 403 | 422
//   PUT    /users/{id}/assignments/{aid}            changeAssignment   → 200 UserDetail | 403 | 422
//   DELETE /users/{id}/assignments/{aid}            removeAssignment   → 200 UserDetail | 403 | 422 (last owner)
//   POST   /users/{id}/suspend | /reactivate        suspend/reactivate → 200 UserRow
//   GET    /projects/{id}/members                   listMembers        → 200 MemberRow[]
//   POST   /projects/{id}/members                   addMember          → 200 MemberRow[]
//   DELETE /projects/{id}/members/{uid}/{aid}       removeMember       → 200 MemberRow[]
import { canInMerchant, canInProject } from '@/domain/access'
import { makeAudit } from '@/domain/audit'
import { CLEARED_CLAIM, isClaimActive } from '@/domain/claimRules'
import { accessChips, allArchived, canGrant, chipLabel, covers, effectivePermissions, GRANT_TOO_POWERFUL, grantsOf, lastOwnerError, scopeLabel, validateAssignment, type AccessChip } from '@/domain/roles'
import type { Actor, AssignmentScope, AuditAction, Permission, Project, Role, RoleAssignment, RuleError, UserAccount, UserStatus } from '@/domain/types'
import { now } from '@/lib/clock'
import { db } from '@/mocks/mockDb'
import { accountOf, nextAssignmentId, requireActive, roleIn, withAccess, type AccountAccess } from './accessGuard'
import { ServiceError } from './errors'
import { clientIpFor, simulateNetwork, wire } from './network'
import { validation } from './projectService'
import { newId } from '@/lib/ids'

export interface AssignmentInput {
  roleId: string
  scope: AssignmentScope
}

export interface InviteInput {
  fullName: string
  email: string
  assignment: AssignmentInput
}

/** A row on the Users screen (DEC-74). */
export interface UserRow {
  userId: string
  fullName: string
  email: string
  merchantId: string
  merchantName: string
  access: AccessChip[] // "Reviewer · Default", "Viewer · SME app" (DEC-74)
  status: UserStatus
  createdAt: string
}

export interface AssignmentRow {
  assignmentId: string
  roleId: string
  roleName: string
  scope: AssignmentScope
  scopeLabel: string // "SME app (archived)" for an archived project
  addedBy: Actor
  addedAt: string
  /** The viewer may edit or remove it (never when every project in it is archived). */
  editable: boolean
  /** REQ: DEC-78 — Remove is shown but disabled, with this reason (the last Merchant Owner). */
  removeBlocked?: string
}

export interface UserDetail extends UserRow {
  lastActiveAt?: string
  assignments: AssignmentRow[]
  /** Nobody changes their own access (DEC-74). */
  isSelf: boolean
  /** The viewer may add access, resend the invitation, suspend and reactivate. */
  canManage: boolean
  /** REQ: DEC-78 — Suspend is shown but disabled, with this reason (the last Merchant Owner). */
  suspendBlocked?: string
  /** REQ: DEC-74 — per project of the merchant: each permission and the access rows ("Comes from") that grant it. */
  effective: { projectId: string; projectName: string; permissions: { permission: Permission; from: string[] }[] }[]
}

/** A row on a project's Members tab (DEC-77): everyone with access, All projects users marked inherited. */
export interface MemberRow {
  userId: string
  fullName: string
  email: string
  status: UserStatus
  roles: { assignmentId: string; roleName: string; label: string; inherited: boolean; removable: boolean }[]
}

export interface UserAdminService {
  list(actor: Actor, merchantId?: string): Promise<UserRow[]>
  get(userId: string, actor: Actor): Promise<UserDetail>
  invite(merchantId: string, input: InviteInput, actor: Actor): Promise<UserRow>
  resendInvitation(userId: string, actor: Actor): Promise<UserRow>
  addAssignment(userId: string, input: AssignmentInput, actor: Actor): Promise<UserDetail>
  changeAssignment(userId: string, assignmentId: string, input: AssignmentInput, actor: Actor): Promise<UserDetail>
  removeAssignment(userId: string, assignmentId: string, actor: Actor): Promise<UserDetail>
  suspend(userId: string, actor: Actor): Promise<UserRow>
  reactivate(userId: string, actor: Actor): Promise<UserRow>
  listMembers(projectId: string, actor: Actor): Promise<MemberRow[]>
  /** Users of the project's merchant who could be added (not suspended). */
  memberCandidates(projectId: string, actor: Actor): Promise<Pick<UserRow, 'userId' | 'fullName' | 'email'>[]>
  addMember(projectId: string, userId: string, roleId: string, actor: Actor): Promise<MemberRow[]>
  /** Takes the project out of the assignment's scope (the assignment goes when no project is left). */
  removeMember(projectId: string, userId: string, assignmentId: string, actor: Actor): Promise<MemberRow[]>
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const projectOf = (id: string) => db.state().projects.find((p) => p.projectId === id)
const isArchived = (id: string) => projectOf(id)?.status === 'ARCHIVED'
// REQ: DEC-74 — an archived project is labelled wherever access is shown.
const projectName = (id: string) => {
  const p = projectOf(id)
  return p ? `${p.name}${p.status === 'ARCHIVED' ? ' (archived)' : ''}` : id
}
const merchantName = (id?: string) => db.state().merchants.find((m) => m.merchantId === id)?.name ?? id ?? ''
const roleOf = (roleId: string) => db.state().roles.find((r) => r.roleId === roleId)
const label = (a: Pick<RoleAssignment, 'roleId' | 'scope'>) => chipLabel(roleOf(a.roleId)?.name ?? a.roleId, a.scope, projectName)
const by = (actor: Actor): Actor => ({ userId: actor.userId, fullName: actor.fullName })

/** The actor's roles for merchant-level audit entries: "Platform Admin", or their role names. */
function merchantRoleOf(me: AccountAccess): string {
  return me.level === 'PLATFORM_ADMIN' ? 'Platform Admin' : [...new Set(me.grants.map((g) => g.roleName))].join(', ')
}

/** REQ: DEC-42 — user and role events. Scoped to one project, the entry also shows in that project's audit log. */
export function auditAccess(actor: Actor, action: AuditAction, merchantId: string, details: Record<string, unknown>, projectId?: string) {
  db.appendAudit(
    makeAudit({
      id: '',
      now: now(),
      action,
      actor,
      actorRole: projectId ? roleIn(actor, projectId) : merchantRoleOf(accountOf(actor)),
      ip: clientIpFor(actor),
      merchantId,
      projectId,
      details,
    }),
  )
}

/** REQ: DEC-74 / DEC-79 — name and email of a new user (any account, merchant user or Platform Admin); returns the email. */
export function requireNewUser(input: { fullName: string; email: string }): string {
  const errors: RuleError[] = []
  const email = input.email.trim().toLowerCase()
  if (input.fullName.trim().length < 3) errors.push({ field: 'fullName', message: 'Full name must be at least 3 characters' })
  if (!EMAIL.test(email)) errors.push({ field: 'email', message: 'Enter a valid email address' })
  else if (db.state().accounts.some((a) => a.email.toLowerCase() === email)) errors.push({ field: 'email', message: 'A user with this email already exists' })
  if (errors.length) throw validation(errors)
  return email
}

const singleProject = (scope: AssignmentScope) => (scope.kind === 'PROJECTS' && scope.projectIds.length === 1 ? scope.projectIds[0] : undefined)

/**
 * REQ: DEC-74 / DEC-77 — who may give or take access in a scope: Manage users and roles (merchant-wide), or Manage project
 * members in every selected project.
 */
function mayManageScope(me: AccountAccess, merchantId: string, scope: AssignmentScope): boolean {
  if (canInMerchant(me, 'manageUsersRoles', merchantId)) return true
  return scope.kind === 'PROJECTS' && scope.projectIds.every((id) => {
    const p = projectOf(id)
    return !!p && p.merchantId === merchantId && canInProject(me, 'manageMembers', p)
  })
}

function requireUsersScreen(me: AccountAccess, merchantId: string) {
  if (!canInMerchant(me, 'manageUsersRoles', merchantId)) throw new ServiceError('FORBIDDEN', 'You do not have permission to manage users.')
}

/** A merchant user the actor may see, or "not found". Platform Admins are internal and not listed (DEC-70). */
function loadUser(me: AccountAccess, userId: string): UserAccount & { merchantId: string } {
  const a = db.state().accounts.find((x) => x.userId === userId)
  if (!a || !a.merchantId || (me.level !== 'PLATFORM_ADMIN' && a.merchantId !== me.merchantId)) throw new ServiceError('NOT_FOUND', `User ${userId} not found.`)
  return a as UserAccount & { merchantId: string }
}

function notSelf(actor: Actor, a: UserAccount) {
  if (a.userId === actor.userId) throw validation([{ field: 'user', message: 'You can’t change your own access.' }])
}

/** Projects of the merchant that take new members; projects already in `keep` stay allowed (archived ones stay read-only). */
const openProjectIds = (merchantId: string, keep: AssignmentScope | undefined) =>
  db
    .state()
    .projects.filter((p) => p.merchantId === merchantId && (p.status === 'ACTIVE' || (keep?.kind === 'PROJECTS' && keep.projectIds.includes(p.projectId))))
    .map((p) => p.projectId)

/** Role, scope and "grant only what you hold" checks for a new or edited assignment. */
function checkAssignment(me: AccountAccess, merchantId: string, input: AssignmentInput, keep?: AssignmentScope): Role {
  const role = roleOf(input.roleId)
  if (!role || (role.merchantId && role.merchantId !== merchantId)) throw validation([{ field: 'roleId', message: 'Choose a role.' }])
  const errors = validateAssignment(role, input.scope, openProjectIds(merchantId, keep))
  if (errors.length) throw validation(errors)
  if (!mayManageScope(me, merchantId, input.scope)) throw new ServiceError('FORBIDDEN', 'You do not manage access for these projects.')
  if (!canGrant(me.level === 'PLATFORM_ADMIN' ? 'PLATFORM_ADMIN' : me.grants, role.permissions, input.scope)) throw new ServiceError('FORBIDDEN', GRANT_TOO_POWERFUL)
  return role
}

/** REQ: DEC-74 — at least one Merchant Owner (All projects) remains among the merchant's users that are not suspended. */
function ownerErrors(merchantId: string, changed: UserAccount): RuleError[] {
  const users = db.state().accounts.filter((a) => a.merchantId === merchantId)
  const live = (us: UserAccount[]) => us.filter((a) => a.status !== 'SUSPENDED')
  return lastOwnerError(live(users), live(users.map((a) => (a.userId === changed.userId ? changed : a))))
}

function requireOwnerRemains(merchantId: string, changed: UserAccount) {
  const errors = ownerErrors(merchantId, changed)
  if (errors.length) throw validation(errors)
}

const putAccount = (a: UserAccount) => db.setState((st) => ({ accounts: st.accounts.map((x) => (x.userId === a.userId ? a : x)) }))

/**
 * REQ: DEC-22 / DEC-74 — after an access change, the users' open claims end wherever they can no longer claim (all of
 * them when suspended). Each release is audited.
 */
export function releaseLostClaims(actor: Actor, userIds: readonly string[], reason: string) {
  const at = now()
  for (const v of db.state().verifications) {
    if (!v.claimedBy || !userIds.includes(v.claimedBy.userId) || !isClaimActive(v, at)) continue
    const holder = db.state().accounts.find((a) => a.userId === v.claimedBy!.userId)
    if (holder && holder.status === 'ACTIVE' && canInProject(withAccess(holder), 'claimCase', v)) continue
    db.updateVerification(v.caseId, (x) => ({ ...x, ...CLEARED_CLAIM }))
    db.appendAudit(
      makeAudit({ id: '', now: at, action: 'CASE_RELEASED', actor, actorRole: roleIn(actor, v.projectId), ip: clientIpFor(actor), merchantId: v.merchantId, projectId: v.projectId, caseId: v.caseId, referenceNo: v.referenceNo, details: { claimedBy: v.claimedBy, reason } }),
    )
  }
}

function rowOf(a: UserAccount & { merchantId: string }): UserRow {
  return {
    userId: a.userId,
    fullName: a.fullName,
    email: a.email,
    merchantId: a.merchantId,
    merchantName: merchantName(a.merchantId),
    access: accessChips(grantsOf(a.assignments, db.state().roles), projectName, isArchived),
    status: a.status,
    createdAt: a.invitedAt,
  }
}

function detailOf(actor: Actor, a: UserAccount & { merchantId: string }): UserDetail {
  const me = accountOf(actor)
  const isSelf = a.userId === actor.userId
  return {
    ...rowOf(a),
    lastActiveAt: a.lastActiveAt,
    isSelf,
    canManage: !isSelf && canInMerchant(me, 'manageUsersRoles', a.merchantId),
    suspendBlocked: ownerErrors(a.merchantId, { ...a, status: 'SUSPENDED' })[0]?.message,
    effective: db
      .state()
      .projects.filter((p) => p.merchantId === a.merchantId)
      .map((p) => ({
        projectId: p.projectId,
        projectName: projectName(p.projectId),
        permissions: effectivePermissions(grantsOf(a.assignments, db.state().roles), p.projectId).map(({ permission, from }) => ({ permission, from: from.map((g) => chipLabel(g.roleName, g.scope, projectName)) })),
      })),
    assignments: a.assignments.map((x) => ({
      assignmentId: x.assignmentId,
      roleId: x.roleId,
      roleName: roleOf(x.roleId)?.name ?? x.roleId,
      scope: x.scope,
      scopeLabel: scopeLabel(x.scope, projectName),
      addedBy: x.addedBy,
      addedAt: x.addedAt,
      editable: !isSelf && !allArchived(x.scope, isArchived) && mayManageScope(me, a.merchantId, x.scope),
      removeBlocked: ownerErrors(a.merchantId, { ...a, assignments: a.assignments.filter((y) => y.assignmentId !== x.assignmentId) })[0]?.message,
    })),
  }
}

function membersOf(actor: Actor, p: Project): MemberRow[] {
  const me = accountOf(actor)
  const open = p.status === 'ACTIVE'
  return db
    .state()
    .accounts.filter((a) => a.merchantId === p.merchantId && a.assignments.some((x) => covers(x.scope, p.projectId)))
    .map((a) => ({
      userId: a.userId,
      fullName: a.fullName,
      email: a.email,
      status: a.status,
      roles: a.assignments
        .filter((x) => covers(x.scope, p.projectId))
        .map((x) => ({
          assignmentId: x.assignmentId,
          roleName: roleOf(x.roleId)?.name ?? x.roleId,
          label: label(x),
          inherited: x.scope.kind === 'ALL_PROJECTS',
          // All projects access is managed on the Users screen; archived projects are read-only (DEC-77).
          removable: open && x.scope.kind === 'PROJECTS' && a.userId !== actor.userId && mayManageScope(me, p.merchantId, { kind: 'PROJECTS', projectIds: [p.projectId] }),
        })),
    }))
    .sort((x, y) => Number(y.roles.some((r) => r.inherited)) - Number(x.roles.some((r) => r.inherited)) || x.fullName.localeCompare(y.fullName))
}

/** The project, if the actor may manage its members; otherwise "not found" / "forbidden" (DEC-72). */
function membersProject(actor: Actor, projectId: string): Project {
  const me = accountOf(actor)
  const p = projectOf(projectId)
  if (!p || (me.level !== 'PLATFORM_ADMIN' && me.merchantId !== p.merchantId) || (me.level !== 'PLATFORM_ADMIN' && !me.grants.some((g) => covers(g.scope, projectId)))) {
    throw new ServiceError('NOT_FOUND', `Project ${projectId} not found.`)
  }
  if (!canInProject(me, 'manageMembers', p)) throw new ServiceError('FORBIDDEN', 'You do not have permission to manage members in this project.')
  return p
}

export const mockUserAdminService: UserAdminService = {
  async list(actor, merchantId) {
    await simulateNetwork('list users')
    const me = accountOf(actor)
    const merchants = me.level === 'PLATFORM_ADMIN' ? db.state().merchants.map((m) => m.merchantId).filter((id) => !merchantId || id === merchantId) : [me.merchantId!]
    if (me.level !== 'PLATFORM_ADMIN') requireUsersScreen(me, me.merchantId!)
    return wire(
      db
        .state()
        .accounts.filter((a): a is UserAccount & { merchantId: string } => !!a.merchantId && merchants.includes(a.merchantId))
        .map(rowOf)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.userId.localeCompare(a.userId)),
    )
  },

  async get(userId, actor) {
    await simulateNetwork('get user')
    const me = accountOf(actor)
    const a = loadUser(me, userId)
    requireUsersScreen(me, a.merchantId)
    return wire(detailOf(actor, a))
  },

  async invite(merchantId, input, actor) {
    await simulateNetwork('invite user')
    const me = requireActive(actor)
    if (!db.state().merchants.some((m) => m.merchantId === merchantId) || (me.level !== 'PLATFORM_ADMIN' && me.merchantId !== merchantId)) throw new ServiceError('NOT_FOUND', `Merchant ${merchantId} not found.`)
    requireUsersScreen(me, merchantId)
    const email = requireNewUser(input)
    checkAssignment(me, merchantId, input.assignment)
    const at = now().toISOString()
    const account: UserAccount & { merchantId: string } = {
      userId: newId('usr'),
      fullName: input.fullName.trim(),
      email,
      level: 'MERCHANT_USER',
      merchantId,
      assignments: [{ assignmentId: nextAssignmentId(), ...input.assignment, addedBy: by(actor), addedAt: at }],
      status: 'PENDING',
      invitationId: newId('inv'),
      invitedAt: at,
    }
    db.setState((st) => ({ accounts: [...st.accounts, account] }))
    const access = label(account.assignments[0])
    auditAccess(actor, 'USER_INVITED', merchantId, { userId: account.userId, fullName: account.fullName, email, access, summary: `${account.fullName} invited as ${access}` }, singleProject(input.assignment.scope))
    return wire(rowOf(account))
  },

  async resendInvitation(userId, actor) {
    await simulateNetwork('resend invitation')
    const me = requireActive(actor)
    const a = loadUser(me, userId)
    requireUsersScreen(me, a.merchantId)
    if (a.status !== 'PENDING') throw validation([{ field: 'status', message: 'Only Pending users have an invitation to resend.' }])
    const invitationId = newId('inv') // a resend replaces the invitation: the old link stops working
    putAccount({ ...a, invitationId })
    auditAccess(actor, 'USER_INVITATION_RESENT', a.merchantId, { userId, fullName: a.fullName, email: a.email, invitationId, summary: `Invitation resent to ${a.email}` })
    return wire(rowOf(a))
  },

  async addAssignment(userId, input, actor) {
    await simulateNetwork('add access')
    const me = requireActive(actor)
    const a = loadUser(me, userId)
    notSelf(actor, a)
    checkAssignment(me, a.merchantId, input)
    const assignment: RoleAssignment = { assignmentId: nextAssignmentId(), roleId: input.roleId, scope: input.scope, addedBy: by(actor), addedAt: now().toISOString() }
    const updated = { ...a, assignments: [...a.assignments, assignment] }
    putAccount(updated)
    auditAccess(actor, 'USER_ACCESS_ADDED', a.merchantId, { userId, fullName: a.fullName, assignmentId: assignment.assignmentId, summary: `${a.fullName}: ${label(assignment)} added` }, singleProject(input.scope))
    return wire(detailOf(actor, updated))
  },

  async changeAssignment(userId, assignmentId, input, actor) {
    await simulateNetwork('change access')
    const me = requireActive(actor)
    const a = loadUser(me, userId)
    notSelf(actor, a)
    const old = a.assignments.find((x) => x.assignmentId === assignmentId)
    if (!old) throw new ServiceError('NOT_FOUND', `Access ${assignmentId} not found.`)
    if (!mayManageScope(me, a.merchantId, old.scope)) throw new ServiceError('FORBIDDEN', 'You do not manage access for these projects.')
    checkAssignment(me, a.merchantId, input, old.scope)
    const next: RoleAssignment = { ...old, roleId: input.roleId, scope: input.scope }
    const updated = { ...a, assignments: a.assignments.map((x) => (x.assignmentId === assignmentId ? next : x)) }
    if (label(old) === label(next)) return wire(detailOf(actor, a))
    requireOwnerRemains(a.merchantId, updated)
    putAccount(updated)
    auditAccess(actor, 'USER_ACCESS_CHANGED', a.merchantId, { userId, fullName: a.fullName, assignmentId, changes: [{ field: `${a.fullName} access`, from: label(old), to: label(next) }] }, singleProject(old.scope) === singleProject(next.scope) ? singleProject(next.scope) : undefined)
    releaseLostClaims(actor, [userId], 'Access changed')
    return wire(detailOf(actor, updated))
  },

  async removeAssignment(userId, assignmentId, actor) {
    await simulateNetwork('remove access')
    const me = requireActive(actor)
    const a = loadUser(me, userId)
    notSelf(actor, a)
    const old = a.assignments.find((x) => x.assignmentId === assignmentId)
    if (!old) throw new ServiceError('NOT_FOUND', `Access ${assignmentId} not found.`)
    if (!mayManageScope(me, a.merchantId, old.scope)) throw new ServiceError('FORBIDDEN', 'You do not manage access for these projects.')
    const updated = { ...a, assignments: a.assignments.filter((x) => x.assignmentId !== assignmentId) }
    requireOwnerRemains(a.merchantId, updated)
    putAccount(updated)
    auditAccess(actor, 'USER_ACCESS_REMOVED', a.merchantId, { userId, fullName: a.fullName, assignmentId, changes: [{ field: `${a.fullName} access`, from: label(old), to: 'Removed' }] }, singleProject(old.scope))
    releaseLostClaims(actor, [userId], 'Access removed')
    return wire(detailOf(actor, updated))
  },

  async suspend(userId, actor) {
    await simulateNetwork('suspend user')
    const me = requireActive(actor)
    const a = loadUser(me, userId)
    requireUsersScreen(me, a.merchantId)
    notSelf(actor, a)
    if (a.status === 'SUSPENDED') return wire(rowOf(a))
    const updated = { ...a, status: 'SUSPENDED' as const }
    requireOwnerRemains(a.merchantId, updated)
    putAccount(updated)
    auditAccess(actor, 'USER_SUSPENDED', a.merchantId, { userId, fullName: a.fullName, changes: [{ field: `${a.fullName} status`, from: a.status, to: 'SUSPENDED' }] })
    releaseLostClaims(actor, [userId], 'User suspended')
    return wire(rowOf(updated))
  },

  async reactivate(userId, actor) {
    await simulateNetwork('reactivate user')
    const me = requireActive(actor)
    const a = loadUser(me, userId)
    requireUsersScreen(me, a.merchantId)
    notSelf(actor, a)
    if (a.status !== 'SUSPENDED') return wire(rowOf(a))
    const updated = { ...a, status: 'ACTIVE' as const }
    putAccount(updated)
    auditAccess(actor, 'USER_REACTIVATED', a.merchantId, { userId, fullName: a.fullName, changes: [{ field: `${a.fullName} status`, from: 'SUSPENDED', to: 'ACTIVE' }] })
    return wire(rowOf(updated))
  },

  async listMembers(projectId, actor) {
    await simulateNetwork('list members')
    return wire(membersOf(actor, membersProject(actor, projectId)))
  },

  async memberCandidates(projectId, actor) {
    await simulateNetwork('member candidates')
    const p = membersProject(actor, projectId)
    return wire(
      db
        .state()
        .accounts.filter((a) => a.merchantId === p.merchantId && a.status !== 'SUSPENDED')
        .map(({ userId, fullName, email }) => ({ userId, fullName, email }))
        .sort((x, y) => x.fullName.localeCompare(y.fullName)),
    )
  },

  async addMember(projectId, userId, roleId, actor) {
    const p = membersProject(actor, projectId)
    if (p.status !== 'ACTIVE') throw validation([{ field: 'scope', message: 'Archived projects keep their members but take no new ones.' }])
    await mockUserAdminService.addAssignment(userId, { roleId, scope: { kind: 'PROJECTS', projectIds: [projectId] } }, actor)
    return wire(membersOf(actor, p))
  },

  async removeMember(projectId, userId, assignmentId, actor) {
    const p = membersProject(actor, projectId)
    const me = requireActive(actor)
    if (p.status !== 'ACTIVE') throw validation([{ field: 'scope', message: 'Archived projects are read-only.' }])
    const a = loadUser(me, userId)
    const old = a.assignments.find((x) => x.assignmentId === assignmentId)
    if (!old || old.scope.kind !== 'PROJECTS' || !old.scope.projectIds.includes(projectId)) {
      throw validation([{ field: 'assignmentId', message: 'All projects access is managed on the Users screen.' }])
    }
    const rest = old.scope.projectIds.filter((id) => id !== projectId)
    if (rest.length) {
      // Only this project leaves the scope; the actor needs member rights here, not in the other projects.
      if (!mayManageScope(me, a.merchantId, { kind: 'PROJECTS', projectIds: [projectId] })) throw new ServiceError('FORBIDDEN', 'You do not manage access for this project.')
      notSelf(actor, a)
      const next = { ...old, scope: { kind: 'PROJECTS' as const, projectIds: rest } }
      putAccount({ ...a, assignments: a.assignments.map((x) => (x.assignmentId === assignmentId ? next : x)) })
      auditAccess(actor, 'USER_ACCESS_CHANGED', a.merchantId, { userId, fullName: a.fullName, assignmentId, changes: [{ field: `${a.fullName} access`, from: label(old), to: label(next) }] }, projectId)
      releaseLostClaims(actor, [userId], 'Access removed')
    } else {
      await mockUserAdminService.removeAssignment(userId, assignmentId, actor)
    }
    return wire(membersOf(actor, p))
  },
}

export const userAdminService: UserAdminService = mockUserAdminService

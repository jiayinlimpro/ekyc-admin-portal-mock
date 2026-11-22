// Users API (mock): [FRS] User Management › Users (DEC-74) under the DEC-104 model. A merchant user has one merchant
// role, set here (whole merchant, all projects), plus project roles set in Project › Members (that project only).
//   GET    /users?merchantId=…                      list               → 200 UserRow[]
//   GET    /users/{id}                              get                → 200 UserDetail | 404
//   POST   /merchants/{id}/users                    invite             → 201 UserRow (Pending) | 403 | 422
//   POST   /users/{id}/invitation                   resendInvitation   → 200 UserRow | 422 (not Pending)
//   PUT    /users/{id}/role                         setRole            → 200 UserDetail | 403 | 422 (last Owner)
//   POST   /users/{id}/suspend | /reactivate        suspend/reactivate → 200 UserRow
//   GET    /projects/{id}/members                   listMembers        → 200 MemberRow[]
//   POST   /projects/{id}/members                   addMember          → 200 MemberRow[]
//   POST   /projects/{id}/members/invitations       inviteMember       → 200 { members, userId, existing } | 403 | 422
//   DELETE /projects/{id}/members/{uid}/{aid}       removeMember       → 200 MemberRow[]
import { canAnyInProject, canInMerchant, canInProject, hasProject, isInternal } from '@/domain/access'
import { makeAudit } from '@/domain/audit'
import { CLEARED_CLAIM, isClaimActive } from '@/domain/claimRules'
import { canGrant, chipLabel, covers, DEFAULT_MERCHANT_ROLE_ID, effectivePermissions, isStaffEmail, GRANT_TOO_POWERFUL, grantsOf, lastOwnerError, SYSTEM_ROLE_IDS, validateAssignment } from '@/domain/roles'
import { MERCHANT_PERMISSIONS, type Actor, type AssignmentScope, type AuditAction, type Permission, type Project, type Role, type RoleAssignment, type RuleError, type UserAccount, type UserStatus } from '@/domain/types'
import { now } from '@/lib/clock'
import { db } from '@/mocks/mockDb'
import { accountOf, nextAssignmentId, requireActive, roleIn, withAccess, type AccountAccess } from './accessGuard'
import { ServiceError } from './errors'
import { clientIpFor, simulateNetwork, wire } from './network'
import { validation } from './projectService'
import { adoptDraftId, newId } from '@/lib/ids'
import { STAFF_EMAIL_DOMAIN } from '@/domain/openQuestions'

export interface InviteInput {
  /** The User ID shown in the form (from `draftUserId`), kept on save (DEC-97). */
  userId?: string
  fullName: string
  email: string
  /** REQ: DEC-104 — the merchant role (whole merchant); Member when left out. */
  roleId?: string
}

/** A row on the Users screen (DEC-74). */
export interface UserRow {
  userId: string // shown only in the user's details, not in the list (DEC-97)
  fullName: string
  email: string
  merchantId: string
  merchantName: string
  /** REQ: DEC-74 (2026-10-27) — the merchant role's name only ("Member" by default); project roles are in the details. */
  merchantRoleName: string
  status: UserStatus
  createdAt: string
}

/** REQ: DEC-104 — a project role from Project › Members, shown read-only on the user's details. */
export interface ProjectRoleRow {
  assignmentId: string
  projectId: string
  projectName: string // "SME app (archived)" for an archived project
  roleName: string
  addedBy: Actor
  addedAt: string
}

export interface UserDetail extends UserRow {
  lastActiveAt?: string
  /** REQ: DEC-104 — the merchant role: whole merchant, all projects. */
  merchantRole?: { roleId: string; roleName: string }
  projectRoles: ProjectRoleRow[]
  /** Nobody changes their own access (DEC-74). */
  isSelf: boolean
  /** REQ: DEC-102 — what the viewer may do here, one permission each (never on themselves). */
  can: { changeRole: boolean; resendInvitation: boolean; suspend: boolean }
  /** REQ: DEC-78 — shown but disabled, with this reason (the last Owner). */
  suspendBlocked?: string
  changeRoleBlocked?: string
  /** REQ: DEC-74 — per project of the merchant: each permission and the roles ("Comes from") that grant it. */
  effective: { projectId: string; projectName: string; permissions: { permission: Permission; from: string[] }[] }[]
}

/** REQ: DEC-77 / OQ-27 — a new person from Project › Members: their name and email, and the project role. */
export interface InviteMemberInput {
  fullName: string
  email: string
  roleId: string
}

export interface InviteMemberResult {
  members: MemberRow[]
  userId: string
  /** The email already belonged to a user of this merchant: the project role was added to them (no second account). */
  existing: boolean
}

/** A row on a project's Members tab (DEC-77): everyone with access, merchant-role access marked inherited. */
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
  /** REQ: DEC-74 / DEC-97 — the User ID shown read-only when New user opens. */
  draftUserId(actor: Actor): Promise<string>
  invite(merchantId: string, input: InviteInput, actor: Actor): Promise<UserRow>
  resendInvitation(userId: string, actor: Actor): Promise<UserRow>
  /** REQ: DEC-104 — the user's merchant role (Change role). */
  setRole(userId: string, roleId: string, actor: Actor): Promise<UserDetail>
  suspend(userId: string, actor: Actor): Promise<UserRow>
  reactivate(userId: string, actor: Actor): Promise<UserRow>
  listMembers(projectId: string, actor: Actor): Promise<MemberRow[]>
  /** Users of the project's merchant who could be added (not suspended). */
  memberCandidates(projectId: string, actor: Actor): Promise<Pick<UserRow, 'userId' | 'fullName' | 'email'>[]>
  addMember(projectId: string, userId: string, roleId: string, actor: Actor): Promise<MemberRow[]>
  /** REQ: DEC-77 / OQ-27 — New person: a merchant user with the Member role, plus the project role here. */
  inviteMember(projectId: string, input: InviteMemberInput, actor: Actor): Promise<InviteMemberResult>
  removeMember(projectId: string, userId: string, assignmentId: string, actor: Actor): Promise<MemberRow[]>
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const projectOf = (id: string) => db.state().projects.find((p) => p.projectId === id)
// REQ: DEC-74 — an archived project is labelled wherever access is shown.
const projectName = (id: string) => {
  const p = projectOf(id)
  return p ? `${p.name}${p.status === 'ARCHIVED' ? ' (archived)' : ''}` : id
}
const merchantName = (id?: string) => db.state().merchants.find((m) => m.merchantId === id)?.name ?? id ?? ''
const roleOf = (roleId: string) => db.state().roles.find((r) => r.roleId === roleId)
const roleNameOf = (roleId: string) => roleOf(roleId)?.name ?? roleId
/** REQ: DEC-104 — "Owner · All projects", "Reviewer · SME app"; Member alone (it grants nothing). */
const label = (a: Pick<RoleAssignment, 'roleId' | 'scope'>) => (a.roleId === SYSTEM_ROLE_IDS.MEMBER ? roleNameOf(a.roleId) : chipLabel(roleNameOf(a.roleId), a.scope, projectName))
const by = (actor: Actor): Actor => ({ userId: actor.userId, fullName: actor.fullName })
const isMerchantWide = (p: Permission) => (MERCHANT_PERMISSIONS as readonly Permission[]).includes(p)
const merchantRoleOfUser = (a: UserAccount) => a.assignments.find((x) => x.scope.kind === 'ALL_PROJECTS')

/** The actor's roles for merchant-level audit entries: "Super admin", or their role names. */
function merchantRoleOf(me: AccountAccess): string {
  return me.level === 'SUPER_ADMIN' ? 'Super admin' : [...new Set(me.grants.map((g) => g.roleName))].join(', ')
}

/** REQ: DEC-42 — user and role events. Scoped to one project, the entry also shows in that project's audit log. */
export function auditAccess(actor: Actor, action: AuditAction, merchantId: string | undefined, details: Record<string, unknown>, projectId?: string) {
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

/**
 * REQ: DEC-74 / DEC-79 / DEC-99 — name and email of a new user; returns the email. Internal accounts (super admins, platform
 * staff) must use the company staff domain (OQ-31); merchant users may not.
 */
export function requireNewUser(input: { fullName: string; email: string }, kind: 'INTERNAL' | 'MERCHANT'): string {
  const errors: RuleError[] = []
  const email = input.email.trim().toLowerCase()
  if (input.fullName.trim().length < 3) errors.push({ field: 'fullName', message: 'Full name must be at least 3 characters' })
  if (!EMAIL.test(email)) errors.push({ field: 'email', message: 'Enter a valid email address' })
  else if (kind === 'INTERNAL' && !isStaffEmail(email, STAFF_EMAIL_DOMAIN)) errors.push({ field: 'email', message: `Use a company email (@${STAFF_EMAIL_DOMAIN}).` })
  else if (kind === 'MERCHANT' && isStaffEmail(email, STAFF_EMAIL_DOMAIN)) errors.push({ field: 'email', message: `Company staff emails (@${STAFF_EMAIL_DOMAIN}) can’t be used for merchant users.` })
  else if (db.state().accounts.some((a) => a.email.toLowerCase() === email)) errors.push({ field: 'email', message: 'A user with this email already exists' })
  if (errors.length) throw validation(errors)
  return email
}

const USER_ACTION_TEXT = { viewUsers: 'view users', inviteUsers: 'invite users', changeUserRole: 'change user roles', suspendUsers: 'suspend or reactivate users' } as const

// REQ: DEC-102 — each operation on the Users screen needs its own permission.
function requireUsersScreen(me: AccountAccess, merchantId: string, action: keyof typeof USER_ACTION_TEXT = 'viewUsers') {
  if (!canInMerchant(me, action, merchantId)) throw new ServiceError('FORBIDDEN', `You do not have permission to ${USER_ACTION_TEXT[action]}.`)
}

/** A merchant user the actor may see, or "not found". Super admins and staff are internal and not listed here (DEC-70). */
function loadUser(me: AccountAccess, userId: string): UserAccount & { merchantId: string } {
  const a = db.state().accounts.find((x) => x.userId === userId)
  // REQ: DEC-104 — internal accounts (super admins, staff with the permission) work in every merchant.
  if (!a || !a.merchantId || (!isInternal(me) && a.merchantId !== me.merchantId)) throw new ServiceError('NOT_FOUND', `User ${userId} not found.`)
  return a as UserAccount & { merchantId: string }
}

function notSelf(actor: Actor, a: UserAccount) {
  if (a.userId === actor.userId) throw validation([{ field: 'user', message: 'You can’t change your own access.' }])
}

const openProjectIds = (merchantId: string) => db.state().projects.filter((p) => p.merchantId === merchantId && p.status === 'ACTIVE').map((p) => p.projectId)
// REQ: DEC-104 — staff hold platform permissions, so like super admins they aren't limited by "give only what you hold".
const granter = (me: AccountAccess) => (isInternal(me) ? ('SUPER_ADMIN' as const) : me.grants)

/** REQ: DEC-104 — a merchant role of this merchant, given for the whole merchant; nobody gives more than they hold (DEC-74). */
function checkMerchantRole(me: AccountAccess, merchantId: string, roleId: string): Role {
  const role = roleOf(roleId)
  if (!role || (role.merchantId && role.merchantId !== merchantId)) throw validation([{ field: 'roleId', message: 'Choose a role.' }])
  const errors = validateAssignment(role, { kind: 'ALL_PROJECTS' }, []) // a platform role: WRONG_ROLE_TYPE
  if (errors.length) throw validation(errors)
  if (!canGrant(granter(me), role.permissions, { kind: 'ALL_PROJECTS' })) throw new ServiceError('FORBIDDEN', GRANT_TOO_POWERFUL)
  return role
}

/** REQ: DEC-77 / DEC-104 — a project role: Add / remove members in that project; no merchant-wide permissions. */
function checkProjectRole(me: AccountAccess, p: Project, roleId: string): Role {
  const role = roleOf(roleId)
  if (!role || (role.merchantId && role.merchantId !== p.merchantId)) throw validation([{ field: 'roleId', message: 'Choose a role.' }])
  const scope: AssignmentScope = { kind: 'PROJECTS', projectIds: [p.projectId] }
  const errors = validateAssignment(role, scope, openProjectIds(p.merchantId))
  if (errors.length) throw validation(errors)
  if (!canGrant(granter(me), role.permissions, scope)) throw new ServiceError('FORBIDDEN', GRANT_TOO_POWERFUL)
  return role
}

/** REQ: DEC-74 — at least one Owner remains among the merchant's users that are not suspended. */
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
    db.updateVerification(v.verificationId, (x) => ({ ...x, ...CLEARED_CLAIM }))
    db.appendAudit(
      makeAudit({ id: '', now: at, action: 'CASE_RELEASED', actor, actorRole: roleIn(actor, v.projectId), ip: clientIpFor(actor), merchantId: v.merchantId, projectId: v.projectId, verificationId: v.verificationId, referenceId: v.referenceId, details: { claimedBy: v.claimedBy, reason } }),
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
    merchantRoleName: roleNameOf(merchantRoleOfUser(a)?.roleId ?? DEFAULT_MERCHANT_ROLE_ID),
    status: a.status,
    createdAt: a.invitedAt,
  }
}

function detailOf(actor: Actor, a: UserAccount & { merchantId: string }): UserDetail {
  const me = accountOf(actor)
  const isSelf = a.userId === actor.userId
  const mine = merchantRoleOfUser(a)
  return {
    ...rowOf(a),
    lastActiveAt: a.lastActiveAt,
    merchantRole: mine && { roleId: mine.roleId, roleName: roleNameOf(mine.roleId) },
    projectRoles: a.assignments.flatMap((x) =>
      x.scope.kind === 'PROJECTS' ? x.scope.projectIds.map((projectId) => ({ assignmentId: x.assignmentId, projectId, projectName: projectName(projectId), roleName: roleNameOf(x.roleId), addedBy: x.addedBy, addedAt: x.addedAt })) : [],
    ),
    isSelf,
    can: {
      changeRole: !isSelf && canInMerchant(me, 'changeUserRole', a.merchantId),
      resendInvitation: !isSelf && canInMerchant(me, 'inviteUsers', a.merchantId),
      suspend: !isSelf && canInMerchant(me, 'suspendUsers', a.merchantId),
    },
    suspendBlocked: ownerErrors(a.merchantId, { ...a, status: 'SUSPENDED' })[0]?.message,
    changeRoleBlocked: ownerErrors(a.merchantId, { ...a, assignments: a.assignments.filter((x) => x !== mine) })[0]?.message,
    effective: db
      .state()
      .projects.filter((p) => p.merchantId === a.merchantId)
      .map((p) => ({
        projectId: p.projectId,
        projectName: projectName(p.projectId),
        permissions: effectivePermissions(grantsOf(a.assignments, db.state().roles), p.projectId).map(({ permission, from }) => ({ permission, from: from.map((g) => chipLabel(g.roleName, g.scope, projectName)) })),
      })),
  }
}

/** REQ: DEC-77 / DEC-104 — project roles (removable) and merchant roles that give something here (inherited, read-only). */
function membersOf(actor: Actor, p: Project): MemberRow[] {
  const me = accountOf(actor)
  const open = p.status === 'ACTIVE'
  const mayManage = canInProject(me, 'manageMembers', p)
  const counts = (x: RoleAssignment) => covers(x.scope, p.projectId) && (x.scope.kind === 'PROJECTS' || (roleOf(x.roleId)?.permissions.some((perm) => !isMerchantWide(perm)) ?? false))
  return db
    .state()
    .accounts.filter((a) => a.merchantId === p.merchantId && a.assignments.some(counts))
    .map((a) => ({
      userId: a.userId,
      fullName: a.fullName,
      email: a.email,
      status: a.status,
      roles: a.assignments.filter(counts).map((x) => ({
        assignmentId: x.assignmentId,
        roleName: roleNameOf(x.roleId),
        label: label(x),
        inherited: x.scope.kind === 'ALL_PROJECTS',
        // The merchant role is changed on Users; archived projects are read-only (DEC-77).
        removable: open && x.scope.kind === 'PROJECTS' && a.userId !== actor.userId && mayManage,
      })),
    }))
    .sort((x, y) => Number(y.roles.some((r) => r.inherited)) - Number(x.roles.some((r) => r.inherited)) || x.fullName.localeCompare(y.fullName))
}

/**
 * The project, if the actor may view (or manage) its members; otherwise "not found" / "forbidden" (DEC-72, DEC-102).
 * REQ: DEC-77 — Users › Invite (merchant level) also opens Members, to invite a new person.
 */
function membersProject(actor: Actor, projectId: string, action: 'viewMembers' | 'manageMembers' | 'inviteMembers' = 'manageMembers'): Project {
  const me = accountOf(actor)
  const p = projectOf(projectId)
  if (!p || !hasProject(me, p)) {
    throw new ServiceError('NOT_FOUND', `Project ${projectId} not found.`)
  }
  const ok = action === 'manageMembers' ? canInProject(me, 'manageMembers', p) : canAnyInProject(me, [action === 'viewMembers' ? 'viewMembers' : 'manageMembers', 'inviteUsers'], p)
  if (!ok) throw new ServiceError('FORBIDDEN', `You do not have permission to ${action === 'viewMembers' ? 'view' : 'manage'} members in this project.`)
  return p
}

export const mockUserAdminService: UserAdminService = {
  async list(actor, merchantId) {
    await simulateNetwork('list users')
    const me = accountOf(actor)
    const merchants = isInternal(me) ? db.state().merchants.map((m) => m.merchantId).filter((id) => !merchantId || id === merchantId) : [me.merchantId!]
    if (me.level !== 'SUPER_ADMIN') requireUsersScreen(me, me.merchantId ?? '')
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

  async draftUserId(actor) {
    await simulateNetwork('draft user id')
    const me = accountOf(actor)
    if (me.level !== 'SUPER_ADMIN') requireUsersScreen(me, me.merchantId ?? '', 'inviteUsers')
    return newId('usr')
  },

  async invite(merchantId, input, actor) {
    await simulateNetwork('invite user')
    const me = requireActive(actor)
    if (!db.state().merchants.some((m) => m.merchantId === merchantId) || (!isInternal(me) && me.merchantId !== merchantId)) throw new ServiceError('NOT_FOUND', `Merchant ${merchantId} not found.`)
    requireUsersScreen(me, merchantId, 'inviteUsers')
    const email = requireNewUser(input, 'MERCHANT')
    // REQ: DEC-104 — the merchant role, Member by default (access then comes from Project › Members).
    const role = checkMerchantRole(me, merchantId, input.roleId || DEFAULT_MERCHANT_ROLE_ID)
    const at = now().toISOString()
    const account: UserAccount & { merchantId: string } = {
      userId: adoptDraftId('usr', input.userId, (id) => db.state().accounts.some((a) => a.userId === id)),
      fullName: input.fullName.trim(),
      email,
      level: 'MERCHANT_USER',
      merchantId,
      assignments: [{ assignmentId: nextAssignmentId(), roleId: role.roleId, scope: { kind: 'ALL_PROJECTS' }, addedBy: by(actor), addedAt: at }],
      status: 'PENDING',
      invitationId: newId('inv'),
      invitedAt: at,
    }
    db.setState((st) => ({ accounts: [...st.accounts, account] }))
    auditAccess(actor, 'USER_INVITED', merchantId, { userId: account.userId, fullName: account.fullName, email, access: role.name, summary: `${account.fullName} invited as ${role.name}` })
    return wire(rowOf(account))
  },

  async resendInvitation(userId, actor) {
    await simulateNetwork('resend invitation')
    const me = requireActive(actor)
    const a = loadUser(me, userId)
    requireUsersScreen(me, a.merchantId, 'inviteUsers')
    if (a.status !== 'PENDING') throw validation([{ field: 'status', message: 'Only Pending users have an invitation to resend.' }])
    const invitationId = newId('inv') // a resend replaces the invitation: the old link stops working
    putAccount({ ...a, invitationId })
    auditAccess(actor, 'USER_INVITATION_RESENT', a.merchantId, { userId, fullName: a.fullName, email: a.email, invitationId, summary: `Invitation resent to ${a.email}` })
    return wire(rowOf(a))
  },

  async setRole(userId, roleId, actor) {
    await simulateNetwork('change role')
    const me = requireActive(actor)
    const a = loadUser(me, userId)
    requireUsersScreen(me, a.merchantId, 'changeUserRole')
    notSelf(actor, a)
    const role = checkMerchantRole(me, a.merchantId, roleId)
    const old = merchantRoleOfUser(a)
    if (old?.roleId === roleId) return wire(detailOf(actor, a))
    const next: RoleAssignment = { assignmentId: old?.assignmentId ?? nextAssignmentId(), roleId, scope: { kind: 'ALL_PROJECTS' }, addedBy: by(actor), addedAt: now().toISOString() }
    const updated = { ...a, assignments: [next, ...a.assignments.filter((x) => x !== old)] }
    requireOwnerRemains(a.merchantId, updated)
    putAccount(updated)
    auditAccess(actor, 'USER_ACCESS_CHANGED', a.merchantId, { userId, fullName: a.fullName, changes: [{ field: `${a.fullName} role`, from: old ? roleNameOf(old.roleId) : '—', to: role.name }] })
    releaseLostClaims(actor, [userId], 'Role changed')
    return wire(detailOf(actor, updated))
  },

  async suspend(userId, actor) {
    await simulateNetwork('suspend user')
    const me = requireActive(actor)
    const a = loadUser(me, userId)
    requireUsersScreen(me, a.merchantId, 'suspendUsers')
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
    requireUsersScreen(me, a.merchantId, 'suspendUsers')
    notSelf(actor, a)
    if (a.status !== 'SUSPENDED') return wire(rowOf(a))
    const updated = { ...a, status: 'ACTIVE' as const }
    putAccount(updated)
    auditAccess(actor, 'USER_REACTIVATED', a.merchantId, { userId, fullName: a.fullName, changes: [{ field: `${a.fullName} status`, from: 'SUSPENDED', to: 'ACTIVE' }] })
    return wire(rowOf(updated))
  },

  async listMembers(projectId, actor) {
    await simulateNetwork('list members')
    return wire(membersOf(actor, membersProject(actor, projectId, 'viewMembers')))
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

  // REQ: DEC-77 / DEC-104 — a project role for that project only; roles with merchant-wide permissions are refused.
  async addMember(projectId, userId, roleId, actor) {
    await simulateNetwork('add member')
    const me = requireActive(actor)
    const p = membersProject(actor, projectId)
    if (p.status !== 'ACTIVE') throw validation([{ field: 'scope', message: 'Archived projects keep their members but take no new ones.' }])
    const a = loadUser(me, userId)
    notSelf(actor, a)
    const role = checkProjectRole(me, p, roleId)
    const assignment: RoleAssignment = { assignmentId: nextAssignmentId(), roleId: role.roleId, scope: { kind: 'PROJECTS', projectIds: [projectId] }, addedBy: by(actor), addedAt: now().toISOString() }
    putAccount({ ...a, assignments: [...a.assignments, assignment] })
    auditAccess(actor, 'USER_ACCESS_ADDED', a.merchantId, { userId, fullName: a.fullName, assignmentId: assignment.assignmentId, summary: `${a.fullName}: ${label(assignment)} added` }, projectId)
    return wire(membersOf(actor, p))
  },

  // REQ: DEC-77 / OQ-27 — Members › Add / remove here, or Users › Invite (merchant level). One step: the merchant user with
  // the Member role (no permissions; Pending, invitation sent) and the project role in this project only.
  async inviteMember(projectId, input, actor) {
    await simulateNetwork('invite member')
    const me = requireActive(actor)
    const p = membersProject(actor, projectId, 'inviteMembers')
    if (p.status !== 'ACTIVE') throw validation([{ field: 'scope', message: 'Archived projects keep their members but take no new ones.' }])
    if (!input.roleId) throw validation([{ field: 'roleId', message: 'Choose a role.' }])
    const email = input.email.trim().toLowerCase()
    const known = db.state().accounts.find((a) => a.email.toLowerCase() === email)
    // The email is already a user of this merchant: add the project role to them, no second account (DEC-104).
    if (known && known.merchantId === p.merchantId) {
      if (known.status === 'SUSPENDED') throw validation([{ field: 'email', message: `${known.fullName} is suspended. Reactivate them on the Users screen first.` }])
      notSelf(actor, known)
      const role = checkProjectRole(me, p, input.roleId)
      if (known.assignments.some((x) => x.roleId === role.roleId && x.scope.kind === 'PROJECTS' && x.scope.projectIds.includes(projectId))) {
        throw validation([{ field: 'email', message: `${known.fullName} is already ${role.name} in this project.` }])
      }
      const assignment: RoleAssignment = { assignmentId: nextAssignmentId(), roleId: role.roleId, scope: { kind: 'PROJECTS', projectIds: [projectId] }, addedBy: by(actor), addedAt: now().toISOString() }
      putAccount({ ...known, assignments: [...known.assignments, assignment] })
      auditAccess(actor, 'USER_ACCESS_ADDED', p.merchantId, { userId: known.userId, fullName: known.fullName, assignmentId: assignment.assignmentId, summary: `${known.fullName}: ${label(assignment)} added` }, projectId)
      return wire({ members: membersOf(actor, p), userId: known.userId, existing: true })
    }
    // Otherwise a new merchant user: the same checks as New user (another merchant's email, staff domain → refused).
    requireNewUser(input, 'MERCHANT')
    const role = checkProjectRole(me, p, input.roleId)
    const at = now().toISOString()
    const member = roleOf(DEFAULT_MERCHANT_ROLE_ID)!
    const project: RoleAssignment = { assignmentId: nextAssignmentId(), roleId: role.roleId, scope: { kind: 'PROJECTS', projectIds: [projectId] }, addedBy: by(actor), addedAt: at }
    const account: UserAccount & { merchantId: string } = {
      userId: newId('usr'),
      fullName: input.fullName.trim(),
      email,
      level: 'MERCHANT_USER',
      merchantId: p.merchantId,
      assignments: [{ assignmentId: nextAssignmentId(), roleId: member.roleId, scope: { kind: 'ALL_PROJECTS' }, addedBy: by(actor), addedAt: at }, project],
      status: 'PENDING',
      invitationId: newId('inv'),
      invitedAt: at,
    }
    db.setState((st) => ({ accounts: [...st.accounts, account] }))
    auditAccess(actor, 'USER_INVITED', p.merchantId, { userId: account.userId, fullName: account.fullName, email, access: member.name, fromProjectId: projectId, summary: `${account.fullName} invited as ${member.name} from project ${p.name}` }, projectId)
    auditAccess(actor, 'USER_ACCESS_ADDED', p.merchantId, { userId: account.userId, fullName: account.fullName, assignmentId: project.assignmentId, summary: `${account.fullName}: ${label(project)} added` }, projectId)
    return wire({ members: membersOf(actor, p), userId: account.userId, existing: false })
  },

  async removeMember(projectId, userId, assignmentId, actor) {
    await simulateNetwork('remove member')
    const me = requireActive(actor)
    const p = membersProject(actor, projectId)
    if (p.status !== 'ACTIVE') throw validation([{ field: 'scope', message: 'Archived projects are read-only.' }])
    const a = loadUser(me, userId)
    notSelf(actor, a)
    const old = a.assignments.find((x) => x.assignmentId === assignmentId)
    if (!old || old.scope.kind !== 'PROJECTS' || !old.scope.projectIds.includes(projectId)) {
      throw validation([{ field: 'assignmentId', message: 'The merchant role is changed on the Users screen.' }])
    }
    putAccount({ ...a, assignments: a.assignments.filter((x) => x.assignmentId !== assignmentId) })
    auditAccess(actor, 'USER_ACCESS_REMOVED', a.merchantId, { userId, fullName: a.fullName, assignmentId, changes: [{ field: `${a.fullName} access`, from: label(old), to: 'Removed' }] }, projectId)
    releaseLostClaims(actor, [userId], 'Access removed')
    return wire(membersOf(actor, p))
  },
}

export const userAdminService: UserAdminService = mockUserAdminService

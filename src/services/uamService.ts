// User & Access Management API (mock): merchants and users. 2 roles only (DEC-70).
// REQ: DEC-42 / OQ-16 — merchant and user changes are audited with the DEC-42 names. Actions that only exist on this
// legacy screen (rename a user, reactivate) have no DEC-42 event and are not audited; Users and Access drops them (DEC-74).
// Until Users and Access replaces this screen (Phase 11), every change is mirrored onto the user's account, which is what
// the services check (accessGuard.ts). A Merchant Reviewer becomes a Reviewer in the merchant's Default project.
//   GET/POST /merchants · PATCH/DELETE /merchants/{id} · GET/POST /users · PATCH /users/{id}
import { makeAudit } from '@/domain/audit'
import { canOnPlatform } from '@/domain/access'
import type { Actor, AuditAction, Merchant, RoleType, SettingChange, UserAccount, UserRecord, WorkflowVersion } from '@/domain/types'
import { now } from '@/lib/clock'
import { initialConfig, mockSecret } from '@/mocks/builders'
import { db } from '@/mocks/mockDb'
import { accountOf } from './accessGuard'
import { ServiceError } from './errors'
import { clientIpFor, simulateNetwork, wire } from './network'

export interface MerchantAdminRow extends Merchant {
  users: number
  verifications: number
  activeConfigVersion: string
}

export interface UserInput {
  fullName: string
  role: RoleType
  merchantId?: string
}

export interface UamService {
  listMerchants(actor: Actor): Promise<MerchantAdminRow[]>
  createMerchant(input: { name: string; workflowVersion: WorkflowVersion }, actor: Actor): Promise<Merchant>
  renameMerchant(merchantId: string, name: string, actor: Actor): Promise<Merchant>
  /** Only merchants with no users and no verifications can be deleted. */
  deleteMerchant(merchantId: string, actor: Actor): Promise<void>
  listUsers(actor: Actor): Promise<UserRecord[]>
  createUser(input: UserInput, actor: Actor): Promise<UserRecord>
  updateUser(userId: string, input: UserInput, actor: Actor): Promise<UserRecord>
  setUserActive(userId: string, active: boolean, actor: Actor): Promise<UserRecord>
}

// REQ: DEC-70 — Platform Admin only, read from the account (never from the session's role).
function requireUam(actor: Actor) {
  if (!canOnPlatform(accountOf(actor), 'manageMerchants')) throw new ServiceError('FORBIDDEN', 'You do not have permission to manage users and merchants.')
}

function audit(actor: Actor, action: AuditAction, merchantId: string | undefined, details: Record<string, unknown>) {
  db.appendAudit(makeAudit({ id: '', now: now(), action, actor, actorRole: 'PLATFORM_ADMIN', ip: clientIpFor(actor), merchantId, details }))
}

const ROLE_TEXT: Record<RoleType, string> = { PLATFORM_ADMIN: 'Platform Admin', MERCHANT_REVIEWER: 'Merchant Reviewer' }

const invalid = (message: string, field?: string) => new ServiceError('VALIDATION', message, field ? [{ field, message }] : undefined)

function nextId(prefix: string, ids: string[], width: number): string {
  const max = ids.map((id) => Number(id.slice(prefix.length))).filter(Number.isFinite).reduce((a, b) => Math.max(a, b), 0)
  return `${prefix}${String(max + 1).padStart(width, '0')}`
}

function validateUser(input: UserInput, merchants: Merchant[]) {
  const name = input.fullName.trim()
  if (name.length < 3) throw invalid('Full name must be at least 3 characters.', 'fullName')
  if (input.role === 'MERCHANT_REVIEWER' && !merchants.some((m) => m.merchantId === input.merchantId)) throw invalid('A Merchant Reviewer must belong to a merchant.', 'merchantId')
  return { fullName: name, role: input.role, merchantId: input.role === 'PLATFORM_ADMIN' ? undefined : input.merchantId }
}

/** The account for a user created or changed on this legacy screen. Unchanged role and merchant keep the account's project roles. */
function mirrorAccount(user: UserRecord, existing: UserAccount | undefined): UserAccount {
  // An invited user shows as inactive here: keep INVITED unless this change toggled the active flag.
  const keep = existing && user.active === (existing.status === 'ACTIVE')
  const base = { userId: user.userId, fullName: user.fullName, status: keep ? existing.status : user.active ? 'ACTIVE' : 'DEACTIVATED' } as const
  if (existing && (existing.level === 'PLATFORM_ADMIN') === (user.role === 'PLATFORM_ADMIN') && existing.merchantId === user.merchantId) {
    return { ...existing, ...base }
  }
  const invited = { email: existing?.email ?? `${user.userId.toLowerCase()}@users.example`, invitedAt: existing?.invitedAt ?? user.createdAt, lastActiveAt: existing?.lastActiveAt }
  if (user.role === 'PLATFORM_ADMIN') return { ...base, ...invited, level: 'PLATFORM_ADMIN', memberships: [] }
  const home = db.state().projects.find((p) => p.merchantId === user.merchantId && p.isDefault)
  return { ...base, ...invited, level: 'MEMBER', merchantId: user.merchantId, memberships: home ? [{ projectId: home.projectId, role: 'REVIEWER' }] : [] }
}

function saveUser(user: UserRecord) {
  db.setState((st) => {
    const existing = st.accounts.find((a) => a.userId === user.userId)
    const account = mirrorAccount(user, existing)
    return {
      users: st.users.some((u) => u.userId === user.userId) ? st.users.map((u) => (u.userId === user.userId ? user : u)) : [...st.users, user],
      accounts: existing ? st.accounts.map((a) => (a.userId === user.userId ? account : a)) : [...st.accounts, account],
    }
  })
}

export const mockUamService: UamService = {
  async listMerchants(actor) {
    await simulateNetwork('list merchants (admin)')
    requireUam(actor)
    const s = db.state()
    return wire(
      s.merchants.map((m) => ({
        ...m,
        users: s.users.filter((u) => u.merchantId === m.merchantId).length,
        verifications: s.verifications.filter((v) => v.merchantId === m.merchantId).length,
        activeConfigVersion: s.configs[m.merchantId]?.deployed.version ?? '—',
      })),
    )
  },

  async createMerchant(input, actor) {
    await simulateNetwork('create merchant')
    requireUam(actor)
    const name = input.name.trim()
    const s = db.state()
    if (name.length < 2) throw invalid('Merchant name is required.', 'name')
    if (s.merchants.some((m) => m.name.toLowerCase() === name.toLowerCase())) throw invalid('A merchant with this name already exists.', 'name')
    const at = now()
    const merchant: Merchant = { merchantId: nextId('MER-', s.merchants.map((m) => m.merchantId), 4), name, workflowVersion: input.workflowVersion }
    const config = initialConfig(merchant, at, { userId: actor.userId, fullName: actor.fullName })
    db.setState((st) => ({
      merchants: [...st.merchants, merchant],
      configs: { ...st.configs, [merchant.merchantId]: { deployed: config, history: [config] } },
      apiKeys: { ...st.apiKeys, [merchant.merchantId]: { merchantId: merchant.merchantId, keyId: `key_mock_${merchant.merchantId.toLowerCase()}_01`, secret: mockSecret(), createdAt: at.toISOString(), createdBy: actor.fullName } },
    }))
    audit(actor, 'MERCHANT_CREATED', merchant.merchantId, { name, workflowVersion: input.workflowVersion })
    // The first config deployment is a config event, so it is audited like any other deploy.
    db.appendAudit(makeAudit({ id: '', now: at, action: 'CONFIG_DEPLOY', actor, ip: clientIpFor(actor), merchantId: merchant.merchantId, details: { fromVersion: null, toVersion: 'v1.0.0', changes: [] } }))
    return wire(merchant)
  },

  async renameMerchant(merchantId, name, actor) {
    await simulateNetwork('rename merchant')
    requireUam(actor)
    const n = name.trim()
    const s = db.state()
    if (!s.merchants.some((m) => m.merchantId === merchantId)) throw new ServiceError('NOT_FOUND', `Merchant ${merchantId} not found.`)
    if (n.length < 2) throw invalid('Merchant name is required.', 'name')
    if (s.merchants.some((m) => m.merchantId !== merchantId && m.name.toLowerCase() === n.toLowerCase())) throw invalid('A merchant with this name already exists.', 'name')
    const before = s.merchants.find((m) => m.merchantId === merchantId)!.name
    db.setState((st) => ({ merchants: st.merchants.map((m) => (m.merchantId === merchantId ? { ...m, name: n } : m)) }))
    if (before !== n) audit(actor, 'MERCHANT_UPDATED', merchantId, { changes: [{ field: 'Name', from: before, to: n }] })
    return wire(db.state().merchants.find((m) => m.merchantId === merchantId)!)
  },

  async deleteMerchant(merchantId, actor) {
    await simulateNetwork('delete merchant')
    requireUam(actor)
    const s = db.state()
    if (!s.merchants.some((m) => m.merchantId === merchantId)) throw new ServiceError('NOT_FOUND', `Merchant ${merchantId} not found.`)
    if (s.verifications.some((v) => v.merchantId === merchantId)) throw invalid('This merchant has verification records and cannot be deleted.')
    if (s.users.some((u) => u.merchantId === merchantId)) throw invalid('Remove or move this merchant’s users first.')
    db.setState((st) => {
      const configs = { ...st.configs }
      const apiKeys = { ...st.apiKeys }
      delete configs[merchantId]
      delete apiKeys[merchantId]
      return { merchants: st.merchants.filter((m) => m.merchantId !== merchantId), configs, apiKeys }
    })
    audit(actor, 'MERCHANT_STATUS_CHANGED', merchantId, { changes: [{ field: 'Status', from: 'Active', to: 'Deleted (no users, no records)' }] })
  },

  async listUsers(actor) {
    await simulateNetwork('list users (admin)')
    requireUam(actor)
    return wire(db.state().users)
  },

  async createUser(input, actor) {
    await simulateNetwork('create user')
    requireUam(actor)
    const s = db.state()
    const clean = validateUser(input, s.merchants)
    const user: UserRecord = { userId: nextId('USR-2026-', s.accounts.map((u) => u.userId), 4), ...clean, active: true, createdAt: now().toISOString() }
    saveUser(user)
    audit(actor, 'USER_INVITED', user.merchantId, { userId: user.userId, fullName: user.fullName, role: ROLE_TEXT[user.role] })
    return wire(user)
  },

  async updateUser(userId, input, actor) {
    await simulateNetwork('update user')
    requireUam(actor)
    const s = db.state()
    const existing = s.users.find((u) => u.userId === userId)
    if (!existing) throw new ServiceError('NOT_FOUND', `User ${userId} not found.`)
    const clean = validateUser(input, s.merchants)
    if (userId === actor.userId && clean.role !== existing.role) throw invalid('You cannot change your own role.', 'role')
    saveUser({ ...existing, ...clean })
    const changes: SettingChange[] = []
    if (clean.role !== existing.role) changes.push({ field: 'Role', from: ROLE_TEXT[existing.role], to: ROLE_TEXT[clean.role] })
    if (clean.merchantId !== existing.merchantId) changes.push({ field: 'Merchant', from: existing.merchantId ?? '—', to: clean.merchantId ?? '—' })
    if (changes.length) audit(actor, 'USER_ROLE_CHANGED', clean.merchantId ?? existing.merchantId, { userId, fullName: clean.fullName, changes })
    return wire(db.state().users.find((u) => u.userId === userId)!)
  },

  async setUserActive(userId, active, actor) {
    await simulateNetwork('set user active')
    requireUam(actor)
    if (userId === actor.userId && !active) throw invalid('You cannot deactivate yourself.')
    const existing = db.state().users.find((u) => u.userId === userId)
    if (!existing) throw new ServiceError('NOT_FOUND', `User ${userId} not found.`)
    saveUser({ ...existing, active })
    if (existing.active && !active) audit(actor, 'USER_DEACTIVATED', existing.merchantId, { userId, fullName: existing.fullName })
    return wire(db.state().users.find((u) => u.userId === userId)!)
  },
}

export const uamService: UamService = mockUamService

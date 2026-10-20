// Merchants API (mock), Platform Admin only (DEC-70). DEC-92: a new merchant starts with a Default project, one default
// flow on the registry's default version (Draft until its settings are complete, OQ-19) and its first user as Merchant
// Owner (Invited). Every change is audited (DEC-42).
//   GET    /merchants        list    → 200 MerchantRow[]
//   POST   /merchants        create  → 201 Merchant
//   PATCH  /merchants/{id}   rename  → 200 Merchant
//   DELETE /merchants/{id}   remove  → 204 (only with no cases)
import { canOnPlatform } from '@/domain/access'
import { makeAudit } from '@/domain/audit'
import { createFlow } from '@/domain/flowSettings'
import { DEFAULT_CLAIM_TIMEOUT_MIN } from '@/domain/openQuestions'
import { PROJECT_SETTING_DEFAULTS } from '@/domain/projectSettings'
import { defaultVersion } from '@/domain/registryRules'
import { SYSTEM_ROLE_IDS } from '@/domain/roles'
import type { Actor, AuditAction, Merchant, Project, UserAccount } from '@/domain/types'
import { now } from '@/lib/clock'
import { db } from '@/mocks/mockDb'
import { accountOf, nextAssignmentId, requireActive } from './accessGuard'
import { ServiceError } from './errors'
import { clientIpFor, simulateNetwork, wire } from './network'
import { auditProject, nextId, validation } from './projectService'

export interface MerchantRow extends Merchant {
  owner?: { fullName: string; email: string; status: UserAccount['status'] }
  projects: number
  users: number // merchant users (owners and members)
  cases: number
  deletable: boolean // no cases yet
}

export interface MerchantInput {
  name: string
  ownerName: string
  ownerEmail: string
}

export interface MerchantAdminService {
  list(actor: Actor): Promise<MerchantRow[]>
  create(input: MerchantInput, actor: Actor): Promise<Merchant>
  rename(merchantId: string, name: string, actor: Actor): Promise<Merchant>
  remove(merchantId: string, actor: Actor): Promise<void>
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function requirePlatform(actor: Actor) {
  if (!canOnPlatform(accountOf(actor), 'manageMerchants')) throw new ServiceError('FORBIDDEN', 'Only Platform Admin manages merchants.')
}

function audit(actor: Actor, action: AuditAction, merchantId: string, details: Record<string, unknown>) {
  db.appendAudit(makeAudit({ id: '', now: now(), action, actor, actorRole: 'Platform Admin', ip: clientIpFor(actor), merchantId, details }))
}

const nameTaken = (name: string, except?: string) => db.state().merchants.some((m) => m.merchantId !== except && m.name.trim().toLowerCase() === name.trim().toLowerCase())

export const mockMerchantAdminService: MerchantAdminService = {
  async list(actor) {
    await simulateNetwork('list merchants (admin)')
    requirePlatform(actor)
    const s = db.state()
    return wire(
      s.merchants.map((m) => {
        const owner = s.accounts.find((a) => a.merchantId === m.merchantId && a.assignments.some((x) => x.roleId === SYSTEM_ROLE_IDS.MERCHANT_OWNER))
        const cases = s.verifications.filter((v) => v.merchantId === m.merchantId).length
        return {
          ...m,
          owner: owner && { fullName: owner.fullName, email: owner.email, status: owner.status },
          projects: s.projects.filter((p) => p.merchantId === m.merchantId).length,
          users: s.accounts.filter((a) => a.merchantId === m.merchantId).length,
          cases,
          deletable: cases === 0,
        }
      }),
    )
  },

  // REQ: DEC-92
  async create(input, actor) {
    await simulateNetwork('create merchant')
    requireActive(actor)
    requirePlatform(actor)
    const s = db.state()
    const name = input.name.trim()
    const email = input.ownerEmail.trim().toLowerCase()
    const errors = []
    if (name.length < 2) errors.push({ field: 'name', message: 'Merchant name is required' })
    else if (nameTaken(name)) errors.push({ field: 'name', message: 'A merchant with this name already exists' })
    if (input.ownerName.trim().length < 3) errors.push({ field: 'ownerName', message: 'Owner full name must be at least 3 characters' })
    if (!EMAIL.test(email)) errors.push({ field: 'ownerEmail', message: 'Enter a valid email address' })
    else if (s.accounts.some((a) => a.email.toLowerCase() === email)) errors.push({ field: 'ownerEmail', message: 'A user with this email already exists' })
    if (errors.length) throw validation(errors)
    const entry = defaultVersion(s.registry)
    if (!entry) throw validation([{ field: 'form', message: 'No default workflow version is set in the registry.' }])

    const at = now()
    const merchant: Merchant = { merchantId: nextId('MER-', s.merchants.map((m) => m.merchantId)), name }
    const flowId = nextId('FLW-', s.flows.map((f) => f.flowId))
    const project: Project = {
      projectId: nextId('PRJ-', s.projects.map((p) => p.projectId)),
      merchantId: merchant.merchantId,
      name: 'Default',
      status: 'ACTIVE',
      isDefault: true,
      defaultFlowId: flowId,
      claimTimeoutMin: DEFAULT_CLAIM_TIMEOUT_MIN,
      createdAt: at.toISOString(),
      createdBy: 'SYSTEM',
      ...structuredClone(PROJECT_SETTING_DEFAULTS),
    }
    const flow = createFlow({ flowId, project }, { name: 'Default flow', description: 'Created with the merchant' }, entry, at, { userId: 'SYSTEM', fullName: 'SYSTEM' })
    const owner: UserAccount = {
      userId: nextId('USR-2026-', s.accounts.map((a) => a.userId)),
      fullName: input.ownerName.trim(),
      email,
      level: 'MERCHANT_USER',
      merchantId: merchant.merchantId,
      // REQ: DEC-92 — the first user is Merchant Owner for All projects.
      assignments: [{ assignmentId: nextAssignmentId(), roleId: SYSTEM_ROLE_IDS.MERCHANT_OWNER, scope: { kind: 'ALL_PROJECTS' }, addedBy: { userId: actor.userId, fullName: actor.fullName }, addedAt: at.toISOString() }],
      status: 'PENDING',
      invitedAt: at.toISOString(),
    }
    db.setState((st) => ({ merchants: [...st.merchants, merchant], projects: [...st.projects, project], flows: [...st.flows, flow], accounts: [...st.accounts, owner] }))
    audit(actor, 'MERCHANT_CREATED', merchant.merchantId, { name })
    auditProject(actor, 'PROJECT_CREATED', project, { name: project.name, isDefault: true }, at)
    auditProject(actor, 'FLOW_CREATED', project, { flowId, name: flow.name, workflowVersion: flow.workflowVersion, isDefault: true }, at)
    audit(actor, 'USER_INVITED', merchant.merchantId, { userId: owner.userId, fullName: owner.fullName, email, role: 'Merchant Owner' })
    return wire(merchant)
  },

  async rename(merchantId, name, actor) {
    await simulateNetwork('rename merchant')
    requireActive(actor)
    requirePlatform(actor)
    const m = db.state().merchants.find((x) => x.merchantId === merchantId)
    if (!m) throw new ServiceError('NOT_FOUND', `Merchant ${merchantId} not found.`)
    const n = name.trim()
    if (n.length < 2) throw validation([{ field: 'name', message: 'Merchant name is required' }])
    if (nameTaken(n, merchantId)) throw validation([{ field: 'name', message: 'A merchant with this name already exists' }])
    if (n === m.name) return wire(m)
    db.setState((st) => ({ merchants: st.merchants.map((x) => (x.merchantId === merchantId ? { ...x, name: n } : x)) }))
    audit(actor, 'MERCHANT_UPDATED', merchantId, { changes: [{ field: 'Name', from: m.name, to: n }] })
    return wire({ ...m, name: n })
  },

  /** Only a merchant with no cases (e.g. created by mistake); its projects, flows, keys and users go with it. */
  async remove(merchantId, actor) {
    await simulateNetwork('delete merchant')
    requireActive(actor)
    requirePlatform(actor)
    const s = db.state()
    if (!s.merchants.some((m) => m.merchantId === merchantId)) throw new ServiceError('NOT_FOUND', `Merchant ${merchantId} not found.`)
    if (s.verifications.some((v) => v.merchantId === merchantId)) throw validation([{ field: 'form', message: 'This merchant has cases and cannot be deleted.' }])
    const projectIds = new Set(s.projects.filter((p) => p.merchantId === merchantId).map((p) => p.projectId))
    db.setState((st) => ({
      merchants: st.merchants.filter((m) => m.merchantId !== merchantId),
      projects: st.projects.filter((p) => p.merchantId !== merchantId),
      flows: st.flows.filter((f) => f.merchantId !== merchantId),
      flowRevisions: st.flowRevisions.filter((r) => !st.flows.some((f) => f.flowId === r.flowId && f.merchantId === merchantId)),
      projectKeys: st.projectKeys.filter((k) => !projectIds.has(k.projectId)),
      webhooks: st.webhooks.filter((w) => !projectIds.has(w.projectId)),
      accounts: st.accounts.filter((a) => a.merchantId !== merchantId),
      roles: st.roles.filter((r) => r.merchantId !== merchantId),
    }))
    audit(actor, 'MERCHANT_STATUS_CHANGED', merchantId, { changes: [{ field: 'Status', from: 'Active', to: 'Deleted (no cases)' }] })
  },
}

export const merchantAdminService: MerchantAdminService = mockMerchantAdminService

// Merchants API (mock), Super admin only (DEC-70). [FRS] Merchant Management (DEC-98): FRS fields, Onboarding → Active →
// Suspended → Terminated with reasons, never deleted. DEC-92: a new merchant also gets a Default project, one default flow
// on the registry's default version (Draft until its settings are complete) and its first user as Merchant Owner
// (Pending, invited). Every change is audited (DEC-42).
//   GET   /merchants                         list              → 200 MerchantRow[]
//   POST  /merchants                         create            → 201 Merchant (Onboarding) | 422
//   PATCH /merchants/{id}                    update            → 200 Merchant (name, contact phone) | 422
//   POST  /merchants/{id}/status             changeStatus      → 200 Merchant | 422 (transition, reason)
//   POST  /merchants/{id}/invitation         resendInvitation  → 200 | 422 (not Onboarding, owner not Pending)
import { canOnPlatform } from '@/domain/access'
import { makeAudit } from '@/domain/audit'
import { createFlow } from '@/domain/flowSettings'
import { MERCHANT_TRANSITIONS, nameError, normalizeRegistrationNo, phoneError, statusChangeErrors, validateMerchantProfile, type MerchantProfileInput } from '@/domain/merchantRules'
import { DEFAULT_CLAIM_TIMEOUT_SEC, STAFF_EMAIL_DOMAIN } from '@/domain/openQuestions'
import { PROJECT_SETTING_DEFAULTS } from '@/domain/projectSettings'
import { defaultVersion } from '@/domain/registryRules'
import { SYSTEM_ROLE_IDS } from '@/domain/roles'
import type { Actor, AuditAction, Merchant, MerchantStatus, Project, RuleError, UserAccount } from '@/domain/types'
import { now } from '@/lib/clock'
import { countryName, isCountryCode } from '@/lib/countries'
import { newId } from '@/lib/ids'
import { db } from '@/mocks/mockDb'
import { accountOf, nextAssignmentId, requireActive } from './accessGuard'
import { ServiceError } from './errors'
import { clientIpFor, simulateNetwork, wire } from './network'
import { auditProject, validation } from './projectService'
import { isStaffEmail } from '@/domain/roles'

/** A row on the Merchants screen, with what the detail panel shows. */
export interface MerchantRow extends Merchant {
  countryName: string
  owner?: { fullName: string; email: string; status: UserAccount['status'] }
  projects: number
  users: number // merchant users (owners and members)
  cases: number
  /** REQ: DEC-98 — the statuses it may move to now. */
  nextStatuses: MerchantStatus[]
  /** Onboarding with the first owner still Pending (FRS ResendInvitation). */
  canResendInvitation: boolean
}

export type MerchantInput = MerchantProfileInput

export interface MerchantAdminService {
  list(actor: Actor): Promise<MerchantRow[]>
  create(input: MerchantInput, actor: Actor): Promise<Merchant>
  /** Name and contact phone; registration number, country and contact email are locked (DEC-98). */
  update(merchantId: string, input: { name: string; contactPhone: string }, actor: Actor): Promise<Merchant>
  changeStatus(merchantId: string, to: MerchantStatus, reason: string, actor: Actor): Promise<Merchant>
  resendInvitation(merchantId: string, actor: Actor): Promise<void>
}

// REQ: DEC-98 / DEC-99 — super admin, or platform staff with Merchants View / Create / Suspend.
function requirePlatform(actor: Actor, action: 'viewMerchants' | 'createMerchants' | 'changeMerchantStatus') {
  if (!canOnPlatform(accountOf(actor), action)) throw new ServiceError('FORBIDDEN', 'You do not have permission for this on merchants.')
}

function audit(actor: Actor, action: AuditAction, merchantId: string, details: Record<string, unknown>) {
  db.appendAudit(makeAudit({ id: '', now: now(), action, actor, actorRole: 'Super admin', ip: clientIpFor(actor), merchantId, details }))
}

function loadMerchant(merchantId: string): Merchant {
  const m = db.state().merchants.find((x) => x.merchantId === merchantId)
  if (!m) throw new ServiceError('NOT_FOUND', `Merchant ${merchantId} not found.`)
  return m
}

/** The first owner: the user created from the primary contact (FRS "Option B"). */
const firstOwner = (m: Merchant) => db.state().accounts.find((a) => a.merchantId === m.merchantId && a.email === m.primaryContact.email)

const putMerchant = (m: Merchant) => db.setState((st) => ({ merchants: st.merchants.map((x) => (x.merchantId === m.merchantId ? m : x)) }))

const STATUS_TEXT: Record<MerchantStatus, string> = { ONBOARDING: 'Onboarding', ACTIVE: 'Active', SUSPENDED: 'Suspended', TERMINATED: 'Terminated' }

export const mockMerchantAdminService: MerchantAdminService = {
  async list(actor) {
    await simulateNetwork('list merchants (admin)')
    requirePlatform(actor, 'viewMerchants')
    const s = db.state()
    return wire(
      s.merchants
        .map((m): MerchantRow => {
          const owner = s.accounts.find((a) => a.merchantId === m.merchantId && a.assignments.some((x) => x.roleId === SYSTEM_ROLE_IDS.MERCHANT_OWNER))
          return {
            ...m,
            countryName: countryName(m.country),
            owner: owner && { fullName: owner.fullName, email: owner.email, status: owner.status },
            projects: s.projects.filter((p) => p.merchantId === m.merchantId).length,
            users: s.accounts.filter((a) => a.merchantId === m.merchantId).length,
            cases: s.verifications.filter((v) => v.merchantId === m.merchantId).length,
            nextStatuses: [...MERCHANT_TRANSITIONS[m.status]],
            canResendInvitation: m.status === 'ONBOARDING' && firstOwner(m)?.status === 'PENDING',
          }
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)), // REQ: DEC-98 — Created At, newest first
    )
  },

  // REQ: DEC-92 / DEC-98
  async create(input, actor) {
    await simulateNetwork('create merchant')
    requireActive(actor)
    requirePlatform(actor, 'createMerchants')
    const s = db.state()
    const email = input.contactEmail.trim().toLowerCase()
    const errors = validateMerchantProfile(input, s.merchants, s.accounts.some((a) => a.email.toLowerCase() === email), isCountryCode)
    if (!errors.some((e) => e.field === 'contactEmail') && isStaffEmail(email, STAFF_EMAIL_DOMAIN)) errors.push({ field: 'contactEmail', message: `Company staff emails (@${STAFF_EMAIL_DOMAIN}) can’t be used for merchant users.` })
    if (errors.length) throw validation(errors)
    const entry = defaultVersion(s.registry)
    if (!entry) throw validation([{ field: 'form', message: 'No default workflow version is set in the registry.' }])

    const at = now()
    const merchant: Merchant = {
      merchantId: newId('mer'),
      name: input.name.trim(),
      registrationNo: normalizeRegistrationNo(input.country, input.registrationNo),
      country: input.country,
      primaryContact: { fullName: input.contactName.trim(), email, phone: input.contactPhone.trim() || undefined },
      status: 'ONBOARDING', // REQ: DEC-98 — set by the system, not chosen
      createdAt: at.toISOString(),
      createdBy: actor.fullName,
    }
    const flowId = newId('flw')
    const project: Project = {
      projectId: newId('prj'),
      merchantId: merchant.merchantId,
      name: 'Default',
      status: 'ACTIVE',
      isDefault: true,
      defaultFlowId: flowId,
      claimTimeoutSec: DEFAULT_CLAIM_TIMEOUT_SEC,
      createdAt: at.toISOString(),
      createdBy: 'SYSTEM',
      ...structuredClone(PROJECT_SETTING_DEFAULTS),
    }
    const flow = createFlow({ flowId, project }, { name: 'Default flow', description: 'Created with the merchant' }, entry, at, { userId: 'SYSTEM', fullName: 'SYSTEM' })
    const owner: UserAccount = {
      userId: newId('usr'),
      fullName: merchant.primaryContact.fullName,
      email,
      level: 'MERCHANT_USER',
      merchantId: merchant.merchantId,
      // REQ: DEC-92 — the primary contact becomes Merchant Owner for All projects.
      assignments: [{ assignmentId: nextAssignmentId(), roleId: SYSTEM_ROLE_IDS.MERCHANT_OWNER, scope: { kind: 'ALL_PROJECTS' }, addedBy: { userId: actor.userId, fullName: actor.fullName }, addedAt: at.toISOString() }],
      status: 'PENDING',
      invitationId: newId('inv'),
      invitedAt: at.toISOString(),
    }
    db.setState((st) => ({ merchants: [...st.merchants, merchant], projects: [...st.projects, project], flows: [...st.flows, flow], accounts: [...st.accounts, owner] }))
    audit(actor, 'MERCHANT_CREATED', merchant.merchantId, { name: merchant.name, registrationNo: merchant.registrationNo, country: merchant.country, status: 'ONBOARDING' })
    auditProject(actor, 'PROJECT_CREATED', project, { name: project.name, isDefault: true }, at)
    auditProject(actor, 'FLOW_CREATED', project, { flowId, name: flow.name, workflowVersion: flow.workflowVersion, isDefault: true }, at)
    audit(actor, 'USER_INVITED', merchant.merchantId, { userId: owner.userId, fullName: owner.fullName, email, access: 'Merchant Owner · All projects', invitationId: owner.invitationId })
    return wire(merchant)
  },

  async update(merchantId, input, actor) {
    await simulateNetwork('update merchant')
    requireActive(actor)
    requirePlatform(actor, 'createMerchants')
    const m = loadMerchant(merchantId)
    const errors: RuleError[] = []
    const nameErr = nameError(input.name)
    if (nameErr) errors.push({ field: 'name', message: nameErr })
    const phoneErr = phoneError(input.contactPhone)
    if (phoneErr) errors.push({ field: 'contactPhone', message: phoneErr })
    if (errors.length) throw validation(errors)
    const name = input.name.trim()
    const phone = input.contactPhone.trim() || undefined
    const changes = [
      ...(name !== m.name ? [{ field: 'Name', from: m.name, to: name }] : []),
      ...(phone !== m.primaryContact.phone ? [{ field: 'Contact phone', from: m.primaryContact.phone ?? '—', to: phone ?? '—' }] : []),
    ]
    if (!changes.length) return wire(m)
    const updated = { ...m, name, primaryContact: { ...m.primaryContact, phone } }
    putMerchant(updated)
    audit(actor, 'MERCHANT_UPDATED', merchantId, { changes })
    return wire(updated)
  },

  // REQ: DEC-98 — FRS transitions, mandatory reason; Suspended / Terminated cut off sign-in and API keys (accessGuard).
  async changeStatus(merchantId, to, reason, actor) {
    await simulateNetwork('change merchant status')
    requireActive(actor)
    requirePlatform(actor, 'changeMerchantStatus')
    const m = loadMerchant(merchantId)
    const errors = statusChangeErrors(m.status, to, reason)
    if (errors.length) throw validation(errors)
    const updated = { ...m, status: to }
    putMerchant(updated)
    audit(actor, 'MERCHANT_STATUS_CHANGED', merchantId, { reason: reason.trim(), changes: [{ field: 'Status', from: STATUS_TEXT[m.status], to: STATUS_TEXT[to] }] })
    return wire(updated)
  },

  async resendInvitation(merchantId, actor) {
    await simulateNetwork('resend merchant invitation')
    requireActive(actor)
    requirePlatform(actor, 'createMerchants')
    const m = loadMerchant(merchantId)
    const owner = firstOwner(m)
    if (m.status !== 'ONBOARDING' || owner?.status !== 'PENDING') throw validation([{ field: 'status', message: 'Only an Onboarding merchant whose first owner is still Pending has an invitation to resend.' }])
    const invitationId = newId('inv') // a resend replaces the invitation: the old link stops working
    db.setState((st) => ({ accounts: st.accounts.map((a) => (a.userId === owner.userId ? { ...a, invitationId } : a)) }))
    audit(actor, 'USER_INVITATION_RESENT', merchantId, { userId: owner.userId, fullName: owner.fullName, email: owner.email, invitationId, summary: `Invitation resent to ${owner.email}` })
  },
}

export const merchantAdminService: MerchantAdminService = mockMerchantAdminService

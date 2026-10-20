// Verification API (mock implementation). Signatures are the draft contract for the real REST API:
//   GET  /verifications?…            list      → 200 Paged<VerificationSummary>
//   GET  /verifications/filters      filterOptions → 200 FilterOptions (projects and flows in the user's case scope)
//   GET  /verifications/{ref}        get       → 200 VerificationDetail (server writes SENSITIVE_PII_VIEW)
//   POST /verifications/{ref}/claim  claim     → 200 | 409 ALREADY_CLAIMED / NOT_CLAIMABLE
//   DELETE /verifications/{ref}/claim release → 200 | 409 NOT_CLAIM_OWNER
//   POST /verifications/{ref}/decision decide  → 200 | 409 OWNERSHIP_CONFLICT | 422 VALIDATION
import { makeAudit } from '@/domain/audit'
import { applyDecision, checkOwnershipAtSave, claim as claimRule, isClaimActive, release as releaseRule, validateDecision } from '@/domain/claimRules'
import { reasonLabel } from '@/domain/openQuestions'
import { hasRisk } from '@/domain/registryRules'
import type { Actor, Decision, Flow, Paged, Project, RiskLevel, Verification, VerificationDetail, VerificationStatus, VerificationSummary } from '@/domain/types'
import { now } from '@/lib/clock'
import { db } from '@/mocks/mockDb'
import { mayInProject, projectById, projectIdsWhere, requireActive, roleIn } from './accessGuard'
import { sweepExpiredClaims } from './claimSweep'
import { settleRetiringFlow } from './flowService'
import { ServiceError } from './errors'
import { clientIpFor, simulateNetwork, wire } from './network'

// REQ: DEC-43 — filters, search and sort of the Verifications List.
export interface VerificationQuery {
  referenceNo?: string // contains, case-insensitive
  fullName?: string // contains, case-insensitive
  statuses?: VerificationStatus[]
  /** Limits to these projects; projects outside the user's case scope are ignored (DEC-72). Omitted = all of them. */
  projectIds?: string[]
  flowId?: string
  workflowVersion?: string
  claim?: 'UNCLAIMED' | 'MINE' | 'OTHERS' // active claims only
  createdFrom?: string // ISO, inclusive
  createdTo?: string // ISO, inclusive
  riskLevels?: RiskLevel[]
  lastUpdatedBy?: 'SYSTEM' | 'MANUAL'
  /** By Last updated (for Pending Review: when it started waiting). Default OLDEST (DEC-43). */
  sort?: 'OLDEST' | 'NEWEST'
  page?: number // 1-based
  pageSize?: number
}

/** Projects and flows the user can filter on: those in their case scope (DEC-43). */
export interface FilterOptions {
  projects: Pick<Project, 'projectId' | 'merchantId' | 'name' | 'status'>[]
  flows: (Pick<Flow, 'flowId' | 'projectId' | 'name' | 'workflowVersion' | 'status'> & { runsRisk: boolean })[]
}

export interface VerificationService {
  list(q: VerificationQuery, actor: Actor): Promise<Paged<VerificationSummary>>
  filterOptions(actor: Actor): Promise<FilterOptions>
  get(ref: string, actor: Actor, opts?: { requestId?: string }): Promise<VerificationDetail>
  claim(ref: string, actor: Actor): Promise<VerificationDetail>
  release(ref: string, actor: Actor): Promise<VerificationDetail>
  decide(ref: string, actor: Actor, d: Decision): Promise<VerificationDetail>
}

const merchantName = (id: string) => db.state().merchants.find((m) => m.merchantId === id)?.name ?? id
const projectName = (id: string) => db.state().projects.find((p) => p.projectId === id)?.name ?? id
const flowName = (id: string) => db.state().flows.find((f) => f.flowId === id)?.name ?? id

// REQ: DEC-40 — built field by field (never spread), so PII and client metadata cannot leak into list rows.
function toSummary(v: Verification, at: Date): VerificationSummary {
  const active = isClaimActive(v, at)
  return {
    referenceNo: v.referenceNo,
    merchantId: v.merchantId,
    merchantName: merchantName(v.merchantId),
    projectId: v.projectId,
    projectName: projectName(v.projectId),
    flowId: v.flowId,
    flowName: flowName(v.flowId),
    fullName: v.pii.fullName,
    documentType: v.documentType,
    workflowVersion: v.workflowVersion,
    status: v.status,
    riskLevel: v.riskLevel,
    claimedBy: active ? v.claimedBy : undefined,
    claimExpiresAt: active ? v.claimExpiresAt : undefined,
    lastUpdatedBy: v.lastUpdatedBy,
    lastUpdatedAt: v.lastUpdatedAt,
    createdAt: v.createdAt,
  }
}

const toDetail = (v: Verification): VerificationDetail => wire({ ...v, merchantName: merchantName(v.merchantId) })

// REQ: DEC-72 — the same response for "not found" and "not in your projects", so references can't be probed.
function load(ref: string, actor: Actor): Verification {
  const v = db.findVerification(ref)
  if (!v || !mayInProject(actor, 'viewCases', v.projectId)) throw new ServiceError('NOT_FOUND', `Verification ${ref} not found.`)
  return v
}

function audit(actor: Actor, action: Parameters<typeof makeAudit>[0]['action'], v: Verification, at: Date, details?: Record<string, unknown>) {
  // REQ: DEC-42 — actor, their role in the case's project, project, target and old/new values.
  db.appendAudit(
    makeAudit({ id: '', now: at, action, actor, actorRole: roleIn(actor, v.projectId), ip: clientIpFor(actor), merchantId: v.merchantId, projectId: v.projectId, referenceNo: v.referenceNo, details }),
  )
}

const loggedPiiViews = new Set<string>()

const includes = (hay: string, needle?: string) => !needle?.trim() || hay.toLowerCase().includes(needle.trim().toLowerCase())

export const mockVerificationService: VerificationService = {
  async list(q, actor) {
    await simulateNetwork('list verifications')
    const at = now()
    sweepExpiredClaims(at)
    // REQ: DEC-72 — only cases in projects where the user may view cases (Platform Admin: none by default, OQ-20).
    const scope = projectIdsWhere(actor, 'viewCases')
    const asked = q.projectIds ? new Set(q.projectIds) : undefined
    const rows = db
      .state()
      .verifications.filter((v) => {
        if (!scope.has(v.projectId) || (asked && !asked.has(v.projectId))) return false
        if (q.flowId && v.flowId !== q.flowId) return false
        if (q.workflowVersion && v.workflowVersion !== q.workflowVersion) return false
        if (!includes(v.referenceNo, q.referenceNo) || !includes(v.pii.fullName, q.fullName)) return false
        if (q.statuses?.length && !q.statuses.includes(v.status)) return false
        if (q.riskLevels?.length && (!v.riskLevel || !q.riskLevels.includes(v.riskLevel))) return false
        if (q.lastUpdatedBy === 'SYSTEM' && v.lastUpdatedBy.kind !== 'SYSTEM') return false
        if (q.lastUpdatedBy === 'MANUAL' && v.lastUpdatedBy.kind !== 'USER') return false
        if (q.claim) {
          const active = isClaimActive(v, at)
          const mine = active && v.claimedBy!.userId === actor.userId
          if (q.claim === 'UNCLAIMED' ? active : q.claim === 'MINE' ? !mine : !active || mine) return false
        }
        if (q.createdFrom && v.createdAt < q.createdFrom) return false
        if (q.createdTo && v.createdAt > q.createdTo) return false
        return true
      })
      // REQ: DEC-43 — oldest first by default (the case waiting longest); ties by Reference No.
      .sort((a, b) => (q.sort === 'NEWEST' ? -1 : 1) * (a.lastUpdatedAt.localeCompare(b.lastUpdatedAt) || a.referenceNo.localeCompare(b.referenceNo)))
    const pageSize = Math.max(1, q.pageSize ?? 20)
    const page = Math.max(1, q.page ?? 1)
    return {
      items: rows.slice((page - 1) * pageSize, page * pageSize).map((v) => toSummary(v, at)),
      page,
      pageSize,
      total: rows.length,
    }
  },

  async filterOptions(actor) {
    await simulateNetwork('verification filters')
    const scope = projectIdsWhere(actor, 'viewCases')
    const s = db.state()
    return wire({
      projects: s.projects.filter((p) => scope.has(p.projectId)).map(({ projectId, merchantId, name, status }) => ({ projectId, merchantId, name, status })),
      flows: s.flows
        .filter((f) => scope.has(f.projectId) && f.status !== 'DRAFT') // Draft flows never have cases
        .map(({ flowId, projectId, name, workflowVersion, status }) => {
          const entry = s.registry.find((e) => e.code === workflowVersion)
          return { flowId, projectId, name, workflowVersion, status, runsRisk: !!entry && hasRisk(entry) }
        }),
    })
  },

  // REQ: DEC-41 — every open writes SENSITIVE_PII_VIEW. requestId dedupes React StrictMode's double effect in dev.
  async get(ref, actor, opts) {
    await simulateNetwork('get verification')
    const at = now()
    sweepExpiredClaims(at)
    const v = load(ref, actor) // REQ: DEC-25 / DEC-41 — every project member who can view the case sees its full detail
    const key = opts?.requestId ? `${actor.userId}:${ref}:${opts.requestId}` : undefined
    if (!key || !loggedPiiViews.has(key)) {
      if (key) loggedPiiViews.add(key)
      audit(actor, 'SENSITIVE_PII_VIEW', v, at, { requestId: opts?.requestId })
    }
    return toDetail(v)
  },

  async claim(ref, actor) {
    await simulateNetwork('claim')
    requireActive(actor)
    const at = now()
    sweepExpiredClaims(at)
    const v = load(ref, actor)
    const r = claimRule(v, actor, { mayClaim: mayInProject(actor, 'claimCase', v.projectId), claimTimeoutMin: projectById(v.projectId)!.claimTimeoutMin }, at)
    if (!r.ok) throw new ServiceError(r.code, r.message)
    // REQ: DEC-03 — claiming does not touch lastUpdatedBy / lastUpdatedAt.
    const updated = db.updateVerification(ref, (x) => ({ ...x, ...r.value }))
    audit(actor, 'CASE_CLAIMED', updated, at, { claimExpiresAt: r.value.claimExpiresAt })
    return toDetail(updated)
  },

  async release(ref, actor) {
    await simulateNetwork('release claim')
    requireActive(actor)
    const at = now()
    sweepExpiredClaims(at)
    const v = load(ref, actor)
    const r = releaseRule(v, actor, at)
    if (!r.ok) throw new ServiceError(r.code, r.message)
    const updated = db.updateVerification(ref, (x) => ({ ...x, ...r.value }))
    audit(actor, 'CASE_RELEASED', updated, at, { claimedAt: v.claimedAt })
    return toDetail(updated)
  },

  // REQ: DEC-24 / DEC-30 / DEC-31
  async decide(ref, actor, d) {
    await simulateNetwork('save decision')
    requireActive(actor)
    const valid = validateDecision(d)
    if (!valid.ok) throw new ServiceError(valid.code, valid.message)
    const at = now()
    // Re-read at save time. Check ownership BEFORE sweeping, so an expired claim of the actor's own is recognised.
    const v = load(ref, actor)
    if (!mayInProject(actor, 'decideCase', v.projectId)) throw new ServiceError('FORBIDDEN', 'You do not have review permission for this project.')
    const owner = checkOwnershipAtSave(v, actor, at)
    if (!owner.ok) {
      sweepExpiredClaims(at) // writes CASE_CLAIM_EXPIRED first if the claim just expired
      audit(actor, 'CASE_DECISION_BLOCKED', v, at, { attempted: d.outcome, reason: owner.message })
      throw new ServiceError(owner.code, owner.message)
    }
    const label = reasonLabel(d.reasonCode) ?? d.reasonCode
    const updated = db.updateVerification(ref, (x) => applyDecision(x, actor, d, label, at))
    audit(actor, d.outcome === 'APPROVE' ? 'CASE_DECISION_APPROVED' : 'CASE_DECISION_REJECTED', updated, at, { ...d, fromStatus: v.status, toStatus: updated.status, fromReason: v.statusReason })
    settleRetiringFlow(v.flowId, at) // REQ: DEC-94 — a Retiring flow goes Inactive with its last in-flight case
    return toDetail(updated)
  },
}

// Swap point: when the real API exists, add an HTTP implementation and select it with VITE_USE_MOCK.
export const verificationService: VerificationService = mockVerificationService

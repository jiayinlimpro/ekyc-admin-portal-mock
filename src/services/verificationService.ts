// Verification API (mock implementation). Signatures are the draft contract for the real REST API:
//   GET  /verifications?…            list      → 200 Paged<VerificationSummary>
//   GET  /verifications/{ref}        get       → 200 VerificationDetail (server writes PII_VIEW)
//   POST /verifications/{ref}/claim  claim     → 200 | 409 ALREADY_CLAIMED / NOT_CLAIMABLE
//   DELETE /verifications/{ref}/claim release → 200 | 409 NOT_CLAIM_OWNER
//   POST /verifications/{ref}/decision decide  → 200 | 409 OWNERSHIP_CONFLICT | 422 VALIDATION
import { makeAudit } from '@/domain/audit'
import { applyDecision, checkOwnershipAtSave, claim as claimRule, isClaimActive, release as releaseRule, validateDecision } from '@/domain/claimRules'
import { reasonLabel } from '@/domain/openQuestions'
import type { Actor, Decision, Paged, RiskLevel, Verification, VerificationDetail, VerificationStatus, VerificationSummary } from '@/domain/types'
import { now } from '@/lib/clock'
import { db } from '@/mocks/mockDb'
import { mayInProject, projectById, projectIdsWhere, requireActive } from './accessGuard'
import { sweepExpiredClaims } from './claimSweep'
import { ServiceError } from './errors'
import { clientIpFor, simulateNetwork, wire } from './network'

export interface VerificationQuery {
  referenceNo?: string // contains, case-insensitive
  fullName?: string // contains, case-insensitive
  statuses?: VerificationStatus[]
  merchantId?: string
  submittedFrom?: string // ISO, inclusive
  submittedTo?: string // ISO, inclusive
  riskLevels?: RiskLevel[]
  claimedBy?: string | 'UNCLAIMED' // userId of an active claim
  lastUpdatedBy?: 'SYSTEM' | 'MANUAL'
  page?: number // 1-based
  pageSize?: number
}

export interface VerificationService {
  list(q: VerificationQuery, actor: Actor): Promise<Paged<VerificationSummary>>
  get(ref: string, actor: Actor, opts?: { requestId?: string }): Promise<VerificationDetail>
  claim(ref: string, actor: Actor): Promise<VerificationDetail>
  release(ref: string, actor: Actor): Promise<VerificationDetail>
  decide(ref: string, actor: Actor, d: Decision): Promise<VerificationDetail>
}

const merchantName = (id: string) => db.state().merchants.find((m) => m.merchantId === id)?.name ?? id

// REQ: DEC-40 — built field by field (never spread), so PII and client metadata cannot leak into list rows.
function toSummary(v: Verification, at: Date): VerificationSummary {
  const active = isClaimActive(v, at)
  return {
    referenceNo: v.referenceNo,
    merchantId: v.merchantId,
    merchantName: merchantName(v.merchantId),
    fullName: v.pii.fullName,
    documentType: v.documentType,
    workflowVersion: v.workflowVersion,
    status: v.status,
    riskLevel: v.riskLevel,
    claimedBy: active ? v.claimedBy : undefined,
    claimExpiresAt: active ? v.claimExpiresAt : undefined,
    lastUpdatedBy: v.lastUpdatedBy,
    lastUpdatedAt: v.lastUpdatedAt,
    submittedAt: v.attempts[0]?.startedAt ?? v.lastUpdatedAt,
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
  db.appendAudit(makeAudit({ id: '', now: at, action, actor, ip: clientIpFor(actor), merchantId: v.merchantId, referenceNo: v.referenceNo, details }))
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
    const rows = db
      .state()
      .verifications.filter((v) => {
        if (!scope.has(v.projectId)) return false
        if (q.merchantId && v.merchantId !== q.merchantId) return false
        if (!includes(v.referenceNo, q.referenceNo) || !includes(v.pii.fullName, q.fullName)) return false
        if (q.statuses?.length && !q.statuses.includes(v.status)) return false
        if (q.riskLevels?.length && (!v.riskLevel || !q.riskLevels.includes(v.riskLevel))) return false
        if (q.lastUpdatedBy === 'SYSTEM' && v.lastUpdatedBy.kind !== 'SYSTEM') return false
        if (q.lastUpdatedBy === 'MANUAL' && v.lastUpdatedBy.kind !== 'USER') return false
        if (q.claimedBy) {
          const active = isClaimActive(v, at)
          if (q.claimedBy === 'UNCLAIMED' ? active : !active || v.claimedBy!.userId !== q.claimedBy) return false
        }
        const submitted = v.attempts[0]?.startedAt ?? v.lastUpdatedAt
        if (q.submittedFrom && submitted < q.submittedFrom) return false
        if (q.submittedTo && submitted > q.submittedTo) return false
        return true
      })
      .sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt))
    const pageSize = Math.max(1, q.pageSize ?? 20)
    const page = Math.max(1, q.page ?? 1)
    return {
      items: rows.slice((page - 1) * pageSize, page * pageSize).map((v) => toSummary(v, at)),
      page,
      pageSize,
      total: rows.length,
    }
  },

  // REQ: DEC-41 — every open writes PII_VIEW. requestId dedupes React StrictMode's double effect in dev.
  async get(ref, actor, opts) {
    await simulateNetwork('get verification')
    const at = now()
    sweepExpiredClaims(at)
    const v = load(ref, actor) // REQ: DEC-25 / DEC-41 — every project member who can view the case sees its full detail
    const key = opts?.requestId ? `${actor.userId}:${ref}:${opts.requestId}` : undefined
    if (!key || !loggedPiiViews.has(key)) {
      if (key) loggedPiiViews.add(key)
      audit(actor, 'PII_VIEW', v, at, { requestId: opts?.requestId })
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
    audit(actor, 'CLAIM', updated, at, { claimExpiresAt: r.value.claimExpiresAt })
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
    audit(actor, 'CLAIM_RELEASE', updated, at, { claimedAt: v.claimedAt })
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
      sweepExpiredClaims(at) // writes CLAIM_TIMEOUT first if the claim just expired
      audit(actor, 'OWNERSHIP_CONFLICT', v, at, { attempted: d.outcome, reason: owner.message })
      throw new ServiceError(owner.code, owner.message)
    }
    const label = reasonLabel(d.reasonCode) ?? d.reasonCode
    const updated = db.updateVerification(ref, (x) => applyDecision(x, actor, d, label, at))
    audit(actor, 'DECISION', updated, at, { ...d, fromStatus: v.status, toStatus: updated.status, fromReason: v.statusReason })
    return toDetail(updated)
  },
}

// Swap point: when the real API exists, add an HTTP implementation and select it with VITE_USE_MOCK.
export const verificationService: VerificationService = mockVerificationService

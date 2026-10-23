// Verification API (mock implementation). Signatures are the draft contract for the real REST API:
//   GET  /verifications?…            list      → 200 Paged<VerificationSummary>
//   GET  /verifications/filters      filterOptions → 200 FilterOptions (projects and flows in the user's case scope)
//   GET  /verifications/{caseId}        get       → 200 VerificationDetail (server writes SENSITIVE_PII_VIEW)
//   POST /verifications/{caseId}/claim  claim     → 200 | 409 ALREADY_CLAIMED / NOT_CLAIMABLE
//   DELETE /verifications/{caseId}/claim release → 200 | 409 NOT_CLAIM_OWNER
//   POST /verifications/{caseId}/decision decide  → 200 | 409 OWNERSHIP_CONFLICT | 422 VALIDATION
// REQ: DEC-97 — cases are addressed by their case ID (ver_…); the Reference ID is the merchant's and only searched.
import { makeAudit } from '@/domain/audit'
import { applyDecision, checkOwnershipAtSave, decisionReason, claim as claimRule, isClaimActive, release as releaseRule, validateDecision } from '@/domain/claimRules'
import { activeReasons, reasonsOf } from '@/domain/decisionReasons'
import { evaluateCase } from '@/domain/checkRules'
import { newCaseAllowedAt, revisionLabel } from '@/domain/flowRules'
import { hasRisk } from '@/domain/registryRules'
import { CHECKS, PHASE_LABELS, RISK_LEVELS, VERIFICATION_STATUSES, type Actor, type AuditAction, type CaseActivity, type Decision, type Flow, type Paged, type Project, type RiskLevel, type Verification, type VerificationDetail, type VerificationStatus, type VerificationSummary } from '@/domain/types'
import { now } from '@/lib/clock'
import { db } from '@/mocks/mockDb'
import { mayInProject, projectById, projectIdsWhere, requireActive, roleIn } from './accessGuard'
import { sweepExpiredClaims } from './claimSweep'
import { settleRetiringFlow } from './flowService'
import { ServiceError } from './errors'
import { clientIpFor, simulateNetwork, wire } from './network'

/** REQ: DEC-100 — the columns the FRS lets the list sort on (never Full Name or Merchant). */
export const VERIFICATION_SORT_KEYS = ['referenceNo', 'status', 'riskLevel', 'lastUpdatedAt'] as const
export type VerificationSortKey = (typeof VERIFICATION_SORT_KEYS)[number]
export interface VerificationSort {
  by: VerificationSortKey
  dir: 'asc' | 'desc'
}

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
  /** A column sort (DEC-100). Omitted = the default: Last updated, oldest first (the case waiting longest, DEC-43). */
  sort?: VerificationSort
  page?: number // 1-based
  pageSize?: number
}

// REQ: DEC-100 — status in lifecycle order, risk Low → High; a case without a risk level is last either way.
const STATUS_ORDER = (s: VerificationStatus) => VERIFICATION_STATUSES.indexOf(s)
const RISK_ORDER = (r?: RiskLevel) => (r ? RISK_LEVELS.indexOf(r) : undefined)

/** REQ: DEC-43 / DEC-100 — the chosen column, then the default order (Last updated oldest first, then Reference No.). */
function compareBy(sort?: VerificationSort) {
  const byDefault = (a: Verification, b: Verification) => a.lastUpdatedAt.localeCompare(b.lastUpdatedAt) || a.referenceNo.localeCompare(b.referenceNo)
  if (!sort) return byDefault
  const sign = sort.dir === 'asc' ? 1 : -1
  return (a: Verification, b: Verification) => {
    if (sort.by === 'riskLevel') {
      const [x, y] = [RISK_ORDER(a.riskLevel), RISK_ORDER(b.riskLevel)]
      if (x === undefined || y === undefined) return (x === undefined ? 1 : 0) - (y === undefined ? 1 : 0) || byDefault(a, b)
      return sign * (x - y) || byDefault(a, b)
    }
    const c = sort.by === 'status' ? STATUS_ORDER(a.status) - STATUS_ORDER(b.status) : sort.by === 'referenceNo' ? a.referenceNo.localeCompare(b.referenceNo) : byDefault(a, b)
    return sign * c || byDefault(a, b)
  }
}

/** Projects and flows the user can filter on: those in their case scope (DEC-43). */
export interface FilterOptions {
  projects: Pick<Project, 'projectId' | 'merchantId' | 'name' | 'status'>[]
  flows: (Pick<Flow, 'flowId' | 'projectId' | 'name' | 'workflowVersion' | 'status'> & { runsRisk: boolean })[]
}

export interface VerificationService {
  list(q: VerificationQuery, actor: Actor): Promise<Paged<VerificationSummary>>
  filterOptions(actor: Actor): Promise<FilterOptions>
  get(caseId: string, actor: Actor, opts?: { requestId?: string }): Promise<VerificationDetail>
  claim(caseId: string, actor: Actor): Promise<VerificationDetail>
  release(caseId: string, actor: Actor): Promise<VerificationDetail>
  decide(caseId: string, actor: Actor, d: Decision): Promise<VerificationDetail>
}

const merchantName = (id: string) => db.state().merchants.find((m) => m.merchantId === id)?.name ?? id
const projectName = (id: string) => db.state().projects.find((p) => p.projectId === id)?.name ?? id
const flowName = (id: string) => db.state().flows.find((f) => f.flowId === id)?.name ?? id

// REQ: DEC-40 — built field by field (never spread), so PII and client metadata cannot leak into list rows.
function toSummary(v: Verification, at: Date): VerificationSummary {
  const active = isClaimActive(v, at)
  return {
    caseId: v.caseId, referenceNo: v.referenceNo,
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

/** Case events on the timeline. Views are left out (the Audit Log has them); the rest are the DEC-42 case events. */
const TIMELINE_ACTIONS: readonly AuditAction[] = ['CASE_CLAIMED', 'CASE_RELEASED', 'CASE_CLAIM_EXPIRED', 'CASE_DECISION_APPROVED', 'CASE_DECISION_REJECTED', 'CASE_DECISION_BLOCKED']

function activityOf(v: Verification): CaseActivity[] {
  const system = { kind: 'SYSTEM' } as const
  const out: CaseActivity[] = [{ at: v.createdAt, kind: 'SESSION_STARTED', by: system }]
  const rounds = Math.max(0, ...CHECKS.map((c) => v.submissions[c]?.length ?? 0))
  for (let i = 0; i < rounds; i++) {
    const scores = CHECKS.filter((c) => v.submissions[c]?.[i] !== undefined).map((c) => `${PHASE_LABELS[c]} ${v.submissions[c]![i]}`)
    out.push({ at: v.attempts[i]?.startedAt ?? v.createdAt, kind: 'SUBMISSION', by: system, detail: `#${i + 1}${i ? ` (retry ${i})` : ''} · ${scores.join(' · ')}` })
  }
  // The automated result; for a manual decision the audit entry below records the change instead (DEC-03).
  if (v.status !== 'PROCESSING' && v.lastUpdatedBy.kind === 'SYSTEM') out.push({ at: v.lastUpdatedAt, kind: 'SYSTEM_RESULT', by: system, detail: [v.status, v.statusReason].filter(Boolean).join(' · ') })
  for (const e of db.state().audit) {
    if (e.caseId !== v.caseId || !TIMELINE_ACTIONS.includes(e.action)) continue
    const d = e.details as { reasons?: string; note?: string; reason?: string }
    out.push({ at: e.at, kind: e.action, by: e.actor, detail: [d.reasons, d.note && `“${d.note}”`, d.reason].filter(Boolean).join(' · ') || undefined })
  }
  return out.sort((a, b) => a.at.localeCompare(b.at))
}

// REQ: DEC-44 — everything the Detail sections need, evaluated with the revision the case started on (DEC-52).
function toDetail(v: Verification): VerificationDetail {
  const s = db.state()
  const flow = s.flows.find((f) => f.flowId === v.flowId)!
  const rev = s.flowRevisions.find((r) => r.flowId === v.flowId && r.revision === v.configRevision)
  const settings = rev?.settings ?? flow.settings
  const entry = s.registry.find((e) => e.code === v.workflowVersion)!
  const runsRisk = hasRisk(entry)
  const ev = evaluateCase({ submissions: v.submissions, riskLevel: v.riskLevel }, { checks: entry.configurableChecks, faceMatchMethod: entry.faceMatchMethod, hasRisk: runsRisk, settings })
  return wire({
    ...v,
    merchantName: merchantName(v.merchantId),
    projectName: projectName(v.projectId),
    flowName: flow.name,
    revisionLabel: revisionLabel({ workflowVersion: v.workflowVersion, revision: v.configRevision }) ?? `${v.workflowVersion}-R${v.configRevision}`,
    rulesApplied: settings,
    steps: { phases: entry.phases, faceMatchMethod: entry.faceMatchMethod, runsRisk },
    checks: ev.checks,
    newCaseAllowedAt: v.status === 'REJECTED' ? newCaseAllowedAt(v.lastUpdatedAt, settings.cooldownMin)?.toISOString() : undefined,
    activity: activityOf(v),
    reasonOptions: activeReasons(projectById(v.projectId)!.decisionReasons), // REQ: DEC-106
  })
}

// REQ: DEC-72 — the same response for "not found" and "not in your projects", so references can't be probed.
function load(caseId: string, actor: Actor): Verification {
  const v = db.findVerification(caseId)
  if (!v || !mayInProject(actor, 'viewCases', v.projectId)) throw new ServiceError('NOT_FOUND', `Verification ${caseId} not found.`)
  return v
}

function audit(actor: Actor, action: Parameters<typeof makeAudit>[0]['action'], v: Verification, at: Date, details?: Record<string, unknown>) {
  // REQ: DEC-42 — actor, their role in the case's project, project, target and old/new values.
  db.appendAudit(
    makeAudit({ id: '', now: at, action, actor, actorRole: roleIn(actor, v.projectId), ip: clientIpFor(actor), merchantId: v.merchantId, projectId: v.projectId, caseId: v.caseId, referenceNo: v.referenceNo, details }),
  )
}

const loggedPiiViews = new Set<string>()

const includes = (hay: string, needle?: string) => !needle?.trim() || hay.toLowerCase().includes(needle.trim().toLowerCase())

export const mockVerificationService: VerificationService = {
  async list(q, actor) {
    await simulateNetwork('list verifications')
    const at = now()
    sweepExpiredClaims(at)
    // REQ: DEC-72 — only cases in projects where the user may view cases (Super admin: every project, DEC-75).
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
      .sort(compareBy(q.sort))
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
  async get(caseId, actor, opts) {
    await simulateNetwork('get verification')
    const at = now()
    sweepExpiredClaims(at)
    const v = load(caseId, actor)
    // REQ: DEC-104 — the case page needs View details (no masking); View list alone sees the case only in the list.
    if (!mayInProject(actor, 'viewCaseDetails', v.projectId)) throw new ServiceError('FORBIDDEN', 'You can see this case in the list, but not its details.')
    // REQ: DEC-41 / DEC-104 — every open is audited (who, which case, when): the oversight for personal data.
    const key = opts?.requestId ? `${actor.userId}:${caseId}:${opts.requestId}` : undefined
    if (!key || !loggedPiiViews.has(key)) {
      if (key) loggedPiiViews.add(key)
      audit(actor, 'SENSITIVE_PII_VIEW', v, at, { requestId: opts?.requestId })
    }
    return toDetail(v)
  },

  async claim(caseId, actor) {
    await simulateNetwork('claim')
    requireActive(actor)
    const at = now()
    sweepExpiredClaims(at)
    const v = load(caseId, actor)
    const r = claimRule(v, actor, { mayClaim: mayInProject(actor, 'claimCase', v.projectId), claimTimeoutSec: projectById(v.projectId)!.claimTimeoutSec }, at)
    if (!r.ok) throw new ServiceError(r.code, r.message)
    // REQ: DEC-03 — claiming does not touch lastUpdatedBy / lastUpdatedAt.
    const updated = db.updateVerification(caseId, (x) => ({ ...x, ...r.value }))
    audit(actor, 'CASE_CLAIMED', updated, at, { claimExpiresAt: r.value.claimExpiresAt })
    return toDetail(updated)
  },

  async release(caseId, actor) {
    await simulateNetwork('release claim')
    requireActive(actor)
    const at = now()
    sweepExpiredClaims(at)
    const v = load(caseId, actor)
    const r = releaseRule(v, actor, at)
    if (!r.ok) throw new ServiceError(r.code, r.message)
    const updated = db.updateVerification(caseId, (x) => ({ ...x, ...r.value }))
    audit(actor, 'CASE_RELEASED', updated, at, { claimedAt: v.claimedAt })
    return toDetail(updated)
  },

  // REQ: DEC-24 / DEC-30 / DEC-31 / DEC-106
  async decide(caseId, actor, d) {
    await simulateNetwork('save decision')
    requireActive(actor)
    const at = now()
    // Re-read at save time. Check ownership BEFORE sweeping, so an expired claim of the actor's own is recognised.
    const v = load(caseId, actor)
    if (!mayInProject(actor, 'decideCase', v.projectId)) throw new ServiceError('FORBIDDEN', 'You do not have review permission for this project.')
    // REQ: DEC-106 — the reasons of the case's project, as they are now (a reason turned off meanwhile is refused).
    const reasons = reasonsOf(projectById(v.projectId)!.decisionReasons)
    const valid = validateDecision(d, reasons)
    if (!valid.ok) throw new ServiceError(valid.code, valid.message)
    const owner = checkOwnershipAtSave(v, actor, at)
    if (!owner.ok) {
      sweepExpiredClaims(at) // writes CASE_CLAIM_EXPIRED first if the claim just expired
      audit(actor, 'CASE_DECISION_BLOCKED', v, at, { attempted: d.outcome, reason: owner.message })
      throw new ServiceError(owner.code, owner.message)
    }
    const updated = db.updateVerification(caseId, (x) => applyDecision(x, actor, d, at, reasons))
    audit(actor, d.outcome === 'APPROVE' ? 'CASE_DECISION_APPROVED' : 'CASE_DECISION_REJECTED', updated, at, {
      ...d,
      reasons: decisionReason(d, reasons),
      fromStatus: v.status,
      toStatus: updated.status,
      fromReason: v.statusReason,
    })
    settleRetiringFlow(v.flowId, at) // REQ: DEC-94 — a Retiring flow goes Inactive with its last in-flight case
    return toDetail(updated)
  },
}

// Swap point: when the real API exists, add an HTTP implementation and select it with VITE_USE_MOCK.
export const verificationService: VerificationService = mockVerificationService

// Dashboard and billing aggregations (pure). DEC-18, DEC-60, DEC-86. Sessions are counted by `createdAt` (DEC-04);
// days and billing months are MYT calendar days. Check evaluations (threshold, retries) come from the caller, who knows
// each case's flow revision.
import type { CheckEvaluation, PhaseEvaluation } from './checkRules'
import { isClaimActive } from './claimRules'
import { CHECKS, RETRY_PHASES, RISK_RESULTS, VERIFICATION_STATUSES, type Check, type RetryPhase, type RiskResult, type Verification, type VerificationStatus } from './types'

const MYT = 8 * 3_600_000
const DAY = 86_400_000
const HOUR = 3_600_000

export const mytDay = (iso: string | number | Date) => new Date(new Date(iso).getTime() + MYT).toISOString().slice(0, 10)

export interface DateRange {
  from: string // ISO, inclusive
  to: string // ISO, inclusive
}

/** Last `days` MYT calendar days up to `now` (today included), plus the equally long period before it. */
export function presetRange(days: number, now: Date): { current: DateRange; previous: DateRange } {
  const todayStart = Date.parse(`${mytDay(now)}T00:00:00.000Z`) - MYT
  const from = todayStart - (days - 1) * DAY
  return {
    current: { from: new Date(from).toISOString(), to: now.toISOString() },
    previous: { from: new Date(from - days * DAY).toISOString(), to: new Date(from - 1).toISOString() },
  }
}

/** Billing periods are MYT calendar months: "2026-09". */
export function monthRange(period: string): DateRange {
  const [y, m] = period.split('-').map(Number)
  return { from: new Date(Date.UTC(y, m - 1, 1) - MYT).toISOString(), to: new Date(Date.UTC(y, m, 1) - MYT - 1).toISOString() }
}

export const inRange = (v: Pick<Verification, 'createdAt'>, r: DateRange) => v.createdAt >= r.from && v.createdAt <= r.to

const zeroStatus = (): Record<VerificationStatus, number> => Object.fromEntries(VERIFICATION_STATUSES.map((s) => [s, 0])) as Record<VerificationStatus, number>

// ----- Overview --------------------------------------------------------------------------------------------------------

/** One project, flow, version or merchant on Overview (DEC-86, [MS] Reports metrics). */
export interface GroupRow {
  key: string
  total: number
  byStatus: Record<VerificationStatus, number>
  autoCleared: number // REQ: DEC-14 — APPROVED by SYSTEM
  /** REQ: DEC-112 — APPROVED out of completed (APPROVED + REJECTED + UNSUCCESSFUL); undefined when nothing is completed. */
  passRate?: number
  pending: number
  oldestPendingHours?: number // age of the case waiting longest in PENDING_REVIEW
  avgPendingHours?: number
}

export interface OverviewStats {
  total: number
  previousTotal: number
  byStatus: Record<VerificationStatus, number>
  autoCleared: number
  manuallyDecided: number
  pending: { total: number; claimed: number; unclaimed: number }
  daily: { day: string; counts: Record<VerificationStatus, number> }[]
  byMerchant: GroupRow[]
  byProject: GroupRow[]
  byFlow: GroupRow[]
  byVersion: GroupRow[]
}

function groupBy(rows: readonly Verification[], key: (v: Verification) => string, now: Date): GroupRow[] {
  const groups = new Map<string, Verification[]>()
  for (const v of rows) groups.set(key(v), [...(groups.get(key(v)) ?? []), v])
  return [...groups]
    .map(([k, vs]) => {
      const byStatus = zeroStatus()
      for (const v of vs) byStatus[v.status]++
      const done = byStatus.APPROVED + byStatus.REJECTED + byStatus.UNSUCCESSFUL // REQ: DEC-112
      // A case waits in PENDING_REVIEW since its last status change (DEC-03).
      const ages = vs.filter((v) => v.status === 'PENDING_REVIEW').map((v) => (now.getTime() - Date.parse(v.lastUpdatedAt)) / HOUR)
      const round1 = (n: number) => Math.round(n * 10) / 10
      return {
        key: k,
        total: vs.length,
        byStatus,
        autoCleared: vs.filter((v) => v.status === 'APPROVED' && v.lastUpdatedBy.kind === 'SYSTEM').length,
        passRate: done ? byStatus.APPROVED / done : undefined,
        pending: byStatus.PENDING_REVIEW,
        oldestPendingHours: ages.length ? round1(Math.max(...ages)) : undefined,
        avgPendingHours: ages.length ? round1(ages.reduce((a, b) => a + b, 0) / ages.length) : undefined,
      }
    })
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key))
}

/** Current status of the sessions created in the range (a snapshot as of `now`). */
export function overviewStats(records: readonly Verification[], range: DateRange, previous: DateRange, now: Date): OverviewStats {
  const rows = records.filter((v) => inRange(v, range))
  const byStatus = zeroStatus()
  const days = new Map<string, Record<VerificationStatus, number>>()
  for (let t = Date.parse(`${mytDay(range.from)}T00:00:00.000Z`); mytDay(t - MYT) <= mytDay(range.to); t += DAY) days.set(mytDay(t - MYT), zeroStatus())
  let claimed = 0
  for (const v of rows) {
    byStatus[v.status]++
    days.get(mytDay(v.createdAt))![v.status]++
    if (v.status === 'PENDING_REVIEW' && isClaimActive(v, now)) claimed++
  }
  return {
    total: rows.length,
    previousTotal: records.filter((v) => inRange(v, previous)).length,
    byStatus,
    autoCleared: rows.filter((v) => v.status === 'APPROVED' && v.lastUpdatedBy.kind === 'SYSTEM').length,
    manuallyDecided: rows.filter((v) => v.lastUpdatedBy.kind === 'USER').length,
    pending: { total: byStatus.PENDING_REVIEW, claimed, unclaimed: byStatus.PENDING_REVIEW - claimed },
    daily: [...days].map(([day, counts]) => ({ day, counts })),
    byMerchant: groupBy(rows, (v) => v.merchantId, now),
    byProject: groupBy(rows, (v) => v.projectId, now),
    byFlow: groupBy(rows, (v) => v.flowId, now),
    byVersion: groupBy(rows, (v) => v.workflowVersion, now),
  }
}

// ----- System Intelligence ---------------------------------------------------------------------------------------------

export const HISTOGRAM_BIN = 5 // score bins of 5 points: [0,5), [5,10) … [95,100]

/** What the caller knows about a case: its checks evaluated with its revision, and whether the flow has a selfie step. */
export interface CaseContext {
  checks: CheckEvaluation[]
  phases: PhaseEvaluation[] // REQ: DEC-108 — retries per phase
  exhaustedPhase?: RetryPhase
  hasSelfie: boolean
}

export interface FlowIntel {
  flowId: string
  sessions: number
  submitted: number // reached a face match or liveness submission
  firstAttemptPass: number // every check passed on its first submission
  retries: number // REQ: DEC-108 — submissions after the first, in every phase
  retriesExhausted: number
  /** Unfinished sessions (PROCESSING) by the last phase reached. Selfie only for flows with a selfie step (V1). */
  dropOff: { idCapture: number; selfie?: number; liveness: number }
}

export interface IntelligenceStats {
  sessions: number
  submitted: number
  firstAttemptPass: number
  retriedSessions: number
  retries: number
  retriesByPhase: Record<RetryPhase, number>
  retriesExhausted: number
  /** Last score per check and session. */
  histograms: Record<Check, number[]>
  riskResults: Record<RiskResult, number> // REQ: DEC-107 — Low risk vs High risk
  byFlow: FlowIntel[]
}

const submittedAny = (v: Pick<Verification, 'submissions'>) => CHECKS.some((c) => (v.submissions[c]?.length ?? 0) > 0)
// REQ: DEC-18 / DEC-108 — first attempt: every check passed on its first submission and no phase used a retry.
const firstPass = (ctx: CaseContext) => ctx.checks.length > 0 && ctx.checks.every((c) => c.submissions === 1 && c.state === 'PASS') && ctx.phases.every((p) => p.retriesUsed === 0)
const exhausted = (ctx: CaseContext) => !!ctx.exhaustedPhase

export function intelligenceStats(records: readonly Verification[], range: DateRange, contextOf: (v: Verification) => CaseContext): IntelligenceStats {
  const rows = records.filter((v) => inRange(v, range))
  const bins = Math.ceil(100 / HISTOGRAM_BIN)
  const histograms = Object.fromEntries(CHECKS.map((c) => [c, Array<number>(bins).fill(0)])) as Record<Check, number[]>
  const retriesByPhase = Object.fromEntries(RETRY_PHASES.map((p) => [p, 0])) as Record<RetryPhase, number>
  const riskResults = Object.fromEntries(RISK_RESULTS.map((l) => [l, 0])) as Record<RiskResult, number>
  const flows = new Map<string, FlowIntel>()
  const out = { sessions: rows.length, submitted: 0, firstAttemptPass: 0, retriedSessions: 0, retries: 0, retriesExhausted: 0 }

  for (const v of rows) {
    const ctx = contextOf(v)
    const f = flows.get(v.flowId) ?? { flowId: v.flowId, sessions: 0, submitted: 0, firstAttemptPass: 0, retries: 0, retriesExhausted: 0, dropOff: { idCapture: 0, ...(ctx.hasSelfie ? { selfie: 0 } : {}), liveness: 0 } }
    f.sessions++
    const retries = ctx.phases.reduce((n, p) => n + p.retriesUsed, 0)
    for (const p of ctx.phases) retriesByPhase[p.phase] += p.retriesUsed
    for (const c of CHECKS) {
      const last = v.submissions[c]?.at(-1)
      if (last !== undefined) histograms[c][Math.min(bins - 1, Math.floor(last / HISTOGRAM_BIN))]++
    }
    if (submittedAny(v)) {
      out.submitted++
      f.submitted++
    }
    if (firstPass(ctx)) {
      out.firstAttemptPass++
      f.firstAttemptPass++
    }
    if (retries) out.retriedSessions++
    out.retries += retries
    f.retries += retries
    if (exhausted(ctx)) {
      out.retriesExhausted++
      f.retriesExhausted++
    }
    if (v.status === 'PROCESSING') {
      // The last phase reached: nothing submitted = ID capture; a selfie match but no liveness yet = selfie (V1).
      if (!submittedAny(v)) f.dropOff.idCapture++
      else if (ctx.hasSelfie && !(v.submissions.LIVENESS?.length ?? 0)) f.dropOff.selfie = (f.dropOff.selfie ?? 0) + 1
      else f.dropOff.liveness++
    }
    if (v.riskResult) riskResults[v.riskResult]++
    flows.set(v.flowId, f)
  }
  return { ...out, retriesByPhase, histograms, riskResults, byFlow: [...flows.values()].sort((a, b) => b.sessions - a.sessions) }
}

// ----- Billing -----------------------------------------------------------------------------------------------------------

/** REQ: DEC-60 — tokens = document (OCR) + V1 selfie + liveness submissions, whatever the final status (DEC-108, OQ-35). */
export interface BillingLine {
  verificationId: string
  sessionNo: number // REQ: DEC-60 / DEC-113 — one line per session of the case
  referenceId: string
  merchantId: string
  projectId: string
  flowId: string
  chargedAt: string // session started
  workflowVersion: string
  status: VerificationStatus // "Verification Status" column: how the session ended; the current one shows the case's status
  tokens: number
  retryTokens: number // submissions after the first in each phase: "Cost of retries"
  cost: number
}

export interface BillingTotals {
  verifications: number // cases, each counted once however many sessions it had
  tokens: number
  retryTokens: number
  cost: number
  retryCost: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** REQ: DEC-60 — tokens of the case's current session: document (OCR), V1 selfie and liveness submissions. */
export function sessionTokens(v: Verification): { tokens: number; retryTokens: number } {
  // REQ: DEC-60 / DEC-56 — sessions on an Internal testing version are not charged.
  const documents = v.charged && v.idCapture ? v.idCaptureSoftRejects + 1 : 0
  // V1: every submitted selfie, the ones the engine rejected and the ones compared with the ID (OQ-35).
  const selfies = v.charged ? v.attempts.reduce((n, a) => n + (a.telemetry?.selfieRetakes?.length ?? 0) + (a.telemetry?.selfie ? 1 : 0), 0) : 0
  const liveness = v.charged ? (v.submissions.LIVENESS?.length ?? 0) : 0
  return { tokens: documents + selfies + liveness, retryTokens: Math.max(documents - 1, 0) + Math.max(selfies - 1, 0) + Math.max(liveness - 1, 0) }
}

/** REQ: DEC-60 / DEC-113 — one line per session, in the month the session started: the ended ones from their history. */
export function billingLines(v: Verification, tokenPrice: number): BillingLine[] {
  const current = sessionTokens(v)
  return v.sessions.map((s) => {
    const { tokens, retryTokens } = s.ended ?? current
    return {
      verificationId: v.verificationId,
      sessionNo: s.sessionNo,
      referenceId: v.referenceId,
      merchantId: v.merchantId,
      projectId: v.projectId,
      flowId: s.flowId,
      chargedAt: s.startedAt,
      workflowVersion: s.workflowVersion,
      status: s.ended?.status ?? v.status,
      tokens,
      retryTokens,
      cost: round2(tokens * tokenPrice),
    }
  })
}

export function billingTotals(lines: readonly BillingLine[], tokenPrice: number): BillingTotals {
  const tokens = lines.reduce((n, l) => n + l.tokens, 0)
  const retryTokens = lines.reduce((n, l) => n + l.retryTokens, 0)
  return { verifications: new Set(lines.map((l) => l.verificationId)).size, tokens, retryTokens, cost: round2(tokens * tokenPrice), retryCost: round2(retryTokens * tokenPrice) }
}

export function billingBy(lines: readonly BillingLine[], key: (l: BillingLine) => string, tokenPrice: number): (BillingTotals & { key: string })[] {
  const groups = new Map<string, BillingLine[]>()
  for (const l of lines) groups.set(key(l), [...(groups.get(key(l)) ?? []), l])
  return [...groups].map(([k, ls]) => ({ key: k, ...billingTotals(ls, tokenPrice) })).sort((a, b) => b.cost - a.cost || a.key.localeCompare(b.key))
}

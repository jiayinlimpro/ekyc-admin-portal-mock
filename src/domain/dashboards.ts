// Dashboard and billing aggregations (pure). DEC-18, DEC-60, DEC-86. Sessions are counted by `createdAt` (DEC-04);
// days and billing months are MYT calendar days. Check evaluations (threshold, retries) come from the caller, who knows
// each case's flow revision.
import type { CheckEvaluation } from './checkRules'
import { isClaimActive } from './claimRules'
import { CHECKS, RISK_RESULTS, VERIFICATION_STATUSES, type Check, type RiskResult, type Verification, type VerificationStatus } from './types'

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
  /** APPROVED out of completed (APPROVED + REJECTED); undefined when nothing is completed. */
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
      const done = byStatus.APPROVED + byStatus.REJECTED
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
  hasSelfie: boolean
}

export interface FlowIntel {
  flowId: string
  sessions: number
  submitted: number // reached a face match or liveness submission
  firstAttemptPass: number // every check passed on its first submission
  retries: number // REQ: DEC-18 — face match + liveness submissions after the first
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
  retriesByCheck: Record<Check, number>
  retriesExhausted: number
  /** Last score per check and session. */
  histograms: Record<Check, number[]>
  riskResults: Record<RiskResult, number> // REQ: DEC-107 — Low risk vs High risk
  byFlow: FlowIntel[]
}

const retriesOf = (v: Pick<Verification, 'submissions'>, c: Check) => Math.max((v.submissions[c]?.length ?? 0) - 1, 0)
const submittedAny = (v: Pick<Verification, 'submissions'>) => CHECKS.some((c) => (v.submissions[c]?.length ?? 0) > 0)
const firstPass = (ctx: CaseContext) => ctx.checks.length > 0 && ctx.checks.every((c) => c.submissions > 0) && ctx.checks.every((c) => c.submissions === 1 && c.state === 'PASS')
const exhausted = (ctx: CaseContext) => ctx.checks.some((c) => (c.state === 'REVIEW' || c.state === 'REJECT') && c.retriesUsed >= c.retriesAllowed)

export function intelligenceStats(records: readonly Verification[], range: DateRange, contextOf: (v: Verification) => CaseContext): IntelligenceStats {
  const rows = records.filter((v) => inRange(v, range))
  const bins = Math.ceil(100 / HISTOGRAM_BIN)
  const histograms = Object.fromEntries(CHECKS.map((c) => [c, Array<number>(bins).fill(0)])) as Record<Check, number[]>
  const retriesByCheck = Object.fromEntries(CHECKS.map((c) => [c, 0])) as Record<Check, number>
  const riskResults = Object.fromEntries(RISK_RESULTS.map((l) => [l, 0])) as Record<RiskResult, number>
  const flows = new Map<string, FlowIntel>()
  const out = { sessions: rows.length, submitted: 0, firstAttemptPass: 0, retriedSessions: 0, retries: 0, retriesExhausted: 0 }

  for (const v of rows) {
    const ctx = contextOf(v)
    const f = flows.get(v.flowId) ?? { flowId: v.flowId, sessions: 0, submitted: 0, firstAttemptPass: 0, retries: 0, retriesExhausted: 0, dropOff: { idCapture: 0, ...(ctx.hasSelfie ? { selfie: 0 } : {}), liveness: 0 } }
    f.sessions++
    const retries = CHECKS.reduce((n, c) => n + retriesOf(v, c), 0)
    for (const c of CHECKS) {
      retriesByCheck[c] += retriesOf(v, c)
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
  return { ...out, retriesByCheck, histograms, riskResults, byFlow: [...flows.values()].sort((a, b) => b.sessions - a.sessions) }
}

// ----- Billing -----------------------------------------------------------------------------------------------------------

/** REQ: DEC-60 — tokens = liveness submissions, whatever the final status; ID capture and selfie retakes are free. */
export interface BillingLine {
  caseId: string
  referenceNo: string
  merchantId: string
  projectId: string
  flowId: string
  chargedAt: string // session created
  workflowVersion: string
  status: VerificationStatus // "Verification Status" column
  tokens: number
  retryTokens: number // liveness submissions after the first: "Cost of retries"
  cost: number
}

export interface BillingTotals {
  verifications: number
  tokens: number
  retryTokens: number
  cost: number
  retryCost: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function billingLine(v: Verification, tokenPrice: number): BillingLine {
  const tokens = v.submissions.LIVENESS?.length ?? 0
  return {
    caseId: v.caseId,
    referenceNo: v.referenceNo,
    merchantId: v.merchantId,
    projectId: v.projectId,
    flowId: v.flowId,
    chargedAt: v.createdAt,
    workflowVersion: v.workflowVersion,
    status: v.status,
    tokens,
    retryTokens: Math.max(tokens - 1, 0),
    cost: round2(tokens * tokenPrice),
  }
}

export function billingTotals(lines: readonly BillingLine[], tokenPrice: number): BillingTotals {
  const tokens = lines.reduce((n, l) => n + l.tokens, 0)
  const retryTokens = lines.reduce((n, l) => n + l.retryTokens, 0)
  return { verifications: lines.length, tokens, retryTokens, cost: round2(tokens * tokenPrice), retryCost: round2(retryTokens * tokenPrice) }
}

export function billingBy(lines: readonly BillingLine[], key: (l: BillingLine) => string, tokenPrice: number): (BillingTotals & { key: string })[] {
  const groups = new Map<string, BillingLine[]>()
  for (const l of lines) groups.set(key(l), [...(groups.get(key(l)) ?? []), l])
  return [...groups].map(([k, ls]) => ({ key: k, ...billingTotals(ls, tokenPrice) })).sort((a, b) => b.cost - a.cost || a.key.localeCompare(b.key))
}

// SYSTEM status for a case in a flow (DEC-11 … DEC-16).
// Manual decisions are not derived; they are applied by claimRules.
import { checkCondition } from './conditions'
import { POLICY, type PhaseCombination } from './openQuestions'
import { resolveThreshold, type Thresholds } from './thresholds'
import { RISK_CATEGORIES, RISK_CATEGORY_LABELS, type Check, type FaceMatchMethod, type FlowSettings, type RiskConfig, type RiskResult, type RiskScores, type VerificationStatus } from './types'

/** PENDING = no submission yet; RETRY = below Auto-Pass with retries left; the rest are final. */
export type CheckState = 'PENDING' | 'RETRY' | 'PASS' | 'REVIEW' | 'REJECT'

export interface CheckEvaluation {
  check: Check
  state: CheckState
  thresholds: Thresholds
  submissions: number
  retriesUsed: number // submissions after the first (DEC-18)
  retriesAllowed: number
  lastScore?: number
}

export interface CaseEvaluation {
  status: VerificationStatus
  /** Condition label (DEC-35) or the risk reason; set for PENDING_REVIEW and REJECTED, and for PROCESSING while retrying. */
  reason?: string
  /** e.g. "Auto-Reject < 85 · Auto-Pass ≥ 95 · Actual 78" */
  detail?: string
  checks: CheckEvaluation[]
}

export interface FlowContext {
  checks: readonly Check[] // the registry's configurable checks, in flow order
  faceMatchMethod: FaceMatchMethod
  hasRisk: boolean
  settings: Pick<FlowSettings, 'checks' | 'risk'>
}

export interface CaseInput {
  /** Scores per check, in submission order. ID capture and selfie retakes are not here: they are unlimited and free. */
  submissions: Partial<Record<Check, readonly number[]>>
  riskScores?: RiskScores // REQ: DEC-107 — set once risk ran
}

export const RISK_NOT_PASSED = 'Risk Assessment: high risk'

// REQ: DEC-11 / DEC-15 / DEC-16 / DEC-18
export function evaluateCheck(check: Check, scores: readonly number[], settings: FlowSettings['checks'][Check]): CheckEvaluation {
  const thresholds = resolveThreshold(check, settings.threshold)
  const base = { check, thresholds, submissions: scores.length, retriesUsed: Math.max(scores.length - 1, 0), retriesAllowed: settings.retriesAllowed }
  const last = scores.at(-1)
  if (last === undefined) return { ...base, state: 'PENDING' }
  if (last >= thresholds.autoPass) return { ...base, state: 'PASS', lastScore: last }
  if (base.retriesUsed < settings.retriesAllowed) return { ...base, state: 'RETRY', lastScore: last }
  // Retries used up: the last attempt decides.
  return { ...base, state: last < thresholds.autoReject ? 'REJECT' : 'REVIEW', lastScore: last }
}

function detail(e: CheckEvaluation): string {
  return `Auto-Reject < ${e.thresholds.autoReject} · Auto-Pass ≥ ${e.thresholds.autoPass} · Actual ${e.lastScore}`
}

export interface RiskEvaluation {
  result: RiskResult
  below: { category: (typeof RISK_CATEGORIES)[number]; score: number; minimum: number }[]
}

// REQ: DEC-107 / MOCK-02 — Low risk when every category is at or above its minimum; otherwise High risk. Risk never rejects.
export function evaluateRisk(scores: RiskScores, risk: RiskConfig | undefined): RiskEvaluation {
  if (!risk?.enabled) return { result: 'LOW', below: [] }
  const below = RISK_CATEGORIES.filter((c) => scores[c] < risk.minimums[c]).map((c) => ({ category: c, score: scores[c], minimum: risk.minimums[c] }))
  return { result: below.length ? 'HIGH' : 'LOW', below }
}

/** "OSINT Score 22 < 30 · EXIF Score 40 < 50" */
export const riskDetail = (r: RiskEvaluation) => r.below.map((b) => `${RISK_CATEGORY_LABELS[b.category]} ${b.score} < ${b.minimum}`).join(' · ')

export function evaluateCase(input: CaseInput, flow: FlowContext, combination: PhaseCombination = POLICY.phaseCombination): CaseEvaluation {
  const checks = flow.checks.map((c) => evaluateCheck(c, input.submissions[c] ?? [], flow.settings.checks[c]))
  const reasonFor = (e: CheckEvaluation, retryAllowed: boolean) => ({ reason: checkCondition(e.check, flow.faceMatchMethod, retryAllowed).label, detail: detail(e) })

  const firstReject = checks.find((e) => e.state === 'REJECT')
  const firstReview = checks.find((e) => e.state === 'REVIEW')
  const allFinal = checks.every((e) => e.state === 'PASS' || e.state === 'REVIEW' || e.state === 'REJECT')

  // A final reject ends the session (the engine aborts), so it decides at once when rejects win (OQ-01).
  if (firstReject && combination === 'REJECT_WINS') return { status: 'REJECTED', ...reasonFor(firstReject, false), checks }

  if (!allFinal) {
    const retrying = checks.find((e) => e.state === 'RETRY')
    return { status: 'PROCESSING', ...(retrying ? reasonFor(retrying, true) : {}), checks }
  }

  // REQ: DEC-12 — combine when every check has a final result.
  if (combination === 'REJECT_WINS') {
    if (firstReview) return { status: 'PENDING_REVIEW', ...reasonFor(firstReview, false), checks }
  } else {
    if (firstReview) return { status: 'PENDING_REVIEW', ...reasonFor(firstReview, false), checks }
    if (firstReject) return { status: 'REJECTED', ...reasonFor(firstReject, false), checks }
  }

  if (flow.hasRisk) {
    if (!input.riskScores) return { status: 'PROCESSING', checks } // risk has not run yet
    // REQ: DEC-107 — biometrics approve + High risk → PENDING_REVIEW (a biometric reject or review is decided above).
    const risk = evaluateRisk(input.riskScores, flow.settings.risk)
    if (risk.result === 'HIGH') return { status: 'PENDING_REVIEW', reason: RISK_NOT_PASSED, detail: riskDetail(risk), checks }
  }
  return { status: 'APPROVED', checks } // REQ: DEC-14 — lastUpdatedBy = SYSTEM
}

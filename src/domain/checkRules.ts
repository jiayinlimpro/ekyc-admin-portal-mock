// SYSTEM status for a case in a flow (DEC-11 … DEC-16, DEC-108).
// Manual decisions are not derived; they are applied by claimRules.
import { checkCondition } from './conditions'
import { POLICY, type PhaseCombination } from './openQuestions'
import { resolveThreshold, type Thresholds } from './thresholds'
import { RISK_CATEGORIES, RISK_CATEGORY_LABELS, type Check, type FaceMatchMethod, type FlowSettings, type RetryPhase, type RiskConfig, type RiskResult, type RiskScores, type ThresholdChoice, type VerificationStatus } from './types'

/** PENDING = no submission yet; RETRY = below Auto-Pass with retries left; the rest are final. */
export type CheckState = 'PENDING' | 'RETRY' | 'PASS' | 'REVIEW' | 'REJECT'

export interface CheckEvaluation {
  check: Check
  state: CheckState
  thresholds: Thresholds
  submissions: number
  retriesUsed: number // REQ: DEC-108 — of the check's phase (Selfie for the V1 face match, else Liveness)
  retriesAllowed: number
  lastScore?: number
}

/** REQ: DEC-108 — submissions and retries of one phase of the case. */
export interface PhaseEvaluation {
  phase: RetryPhase
  submissions: number
  retriesUsed: number
  retriesAllowed: number
}

export interface CaseEvaluation {
  status: VerificationStatus
  /** Condition label (DEC-35) or the risk reason; set for PENDING_REVIEW and REJECTED, and for PROCESSING while retrying. */
  reason?: string
  /** e.g. "Auto-Reject < 85 · Auto-Pass ≥ 95 · Actual 78" */
  detail?: string
  checks: CheckEvaluation[]
  phases: PhaseEvaluation[] // the phases the version has, in order
  /** The phase whose retries ran out with a failing or non-passing last submission. */
  exhaustedPhase?: RetryPhase
}

export interface FlowContext {
  checks: readonly Check[] // the registry's configurable checks, in flow order
  faceMatchMethod: FaceMatchMethod
  hasRisk: boolean
  settings: Pick<FlowSettings, 'checks' | 'retries' | 'risk'>
}

export interface CaseInput {
  /** Scores per check, in submission order (retakes before submitting are never sent, so never counted). */
  submissions: Partial<Record<Check, readonly number[]>>
  riskScores?: RiskScores // REQ: DEC-107 — set once risk ran
  /** REQ: DEC-108 — submitted ID images that failed (the last one too when it failed) and its condition. Omitted = one that passed. */
  document?: { failed: number; lastFailed?: string }
  /** REQ: DEC-108 — V1: submitted selfies that failed the quality check; `lastFailed` when the last one did (nothing compared after it). */
  selfie?: { failed: number; lastFailed?: string }
}

/** REQ: DEC-108 — the phase whose retries a check uses: the V1 face match is part of the selfie phase. */
export const retryPhaseOf = (check: Check, method: FaceMatchMethod): RetryPhase => (check === 'FACE_MATCH' && method === 'ID_VS_SELFIE' ? 'SELFIE' : 'LIVENESS')

export const RISK_NOT_PASSED = 'Risk Assessment: high risk'

// REQ: DEC-11 / DEC-15 / DEC-16 / DEC-108 — `retriesUsed` is the phase's (it can include failed selfies before these scores).
export function evaluateCheck(check: Check, scores: readonly number[], threshold: ThresholdChoice, retriesAllowed: number, retriesUsed = Math.max(scores.length - 1, 0)): CheckEvaluation {
  const thresholds = resolveThreshold(check, threshold)
  const base = { check, thresholds, submissions: scores.length, retriesUsed, retriesAllowed }
  const last = scores.at(-1)
  if (last === undefined) return { ...base, state: 'PENDING' }
  if (last >= thresholds.autoPass) return { ...base, state: 'PASS', lastScore: last }
  if (retriesUsed < retriesAllowed) return { ...base, state: 'RETRY', lastScore: last }
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
  // REQ: DEC-108 — submissions per phase; each failed submission after the first uses one of the phase's retries.
  const v1 = flow.faceMatchMethod === 'ID_VS_SELFIE'
  const fm = input.submissions.FACE_MATCH ?? []
  const lv = input.submissions.LIVENESS ?? []
  const doc = input.document ?? { failed: 0 }
  const phase = (p: RetryPhase, submissions: number): PhaseEvaluation => ({ phase: p, submissions, retriesUsed: Math.max(submissions - 1, 0), retriesAllowed: flow.settings.retries[p] })
  const phases = [
    phase('DOCUMENT', doc.failed + (doc.lastFailed ? 0 : 1)),
    ...(v1 ? [phase('SELFIE', (input.selfie?.failed ?? 0) + fm.length)] : []),
    phase('LIVENESS', v1 ? lv.length : Math.max(fm.length, lv.length)),
  ]
  const of = (p: RetryPhase) => phases.find((x) => x.phase === p)!
  const checks = flow.checks.map((c) => {
    const p = of(retryPhaseOf(c, flow.faceMatchMethod))
    return evaluateCheck(c, input.submissions[c] ?? [], flow.settings.checks[c].threshold, p.retriesAllowed, p.retriesUsed)
  })
  const reasonFor = (e: CheckEvaluation, retryAllowed: boolean) => ({ reason: checkCondition(e.check, flow.faceMatchMethod, retryAllowed).label, detail: detail(e) })

  // REQ: DEC-108 / DEC-16 / DEC-112 — a document (then a V1 selfie) whose last submission failed: retry pending, or UNSUCCESSFUL
  // (no usable image) when the phase's retries are used up. Nothing after it ran.
  for (const [p, failed] of [['DOCUMENT', doc.lastFailed], ['SELFIE', v1 ? input.selfie?.lastFailed : undefined]] as const) {
    if (!failed) continue
    const out = of(p).retriesUsed >= of(p).retriesAllowed
    // REQ: DEC-112 — V1: once a selfie of the session was compared with the ID, the last face match score decides (below),
    // so a blurry last selfie can't turn a face mismatch into UNSUCCESSFUL.
    if (out && p === 'SELFIE' && fm.length > 0) break
    return { status: out ? 'UNSUCCESSFUL' : 'PROCESSING', reason: `${failed} (Retry ${out ? 'Not ' : ''}Allowed)`, checks, phases, exhaustedPhase: out ? p : undefined }
  }
  const final = checks.find((e) => e.state === 'REVIEW' || e.state === 'REJECT')
  const exhaustedPhase = final ? retryPhaseOf(final.check, flow.faceMatchMethod) : undefined
  const done = { checks, phases, exhaustedPhase }

  const firstReject = checks.find((e) => e.state === 'REJECT')
  const firstReview = checks.find((e) => e.state === 'REVIEW')
  const allFinal = checks.every((e) => e.state === 'PASS' || e.state === 'REVIEW' || e.state === 'REJECT')

  // A final reject ends the session (the engine aborts), so it decides at once when rejects win (OQ-01).
  if (firstReject && combination === 'REJECT_WINS') return { status: 'REJECTED', ...reasonFor(firstReject, false), ...done }

  if (!allFinal) {
    const retrying = checks.find((e) => e.state === 'RETRY')
    return { status: 'PROCESSING', ...(retrying ? reasonFor(retrying, true) : {}), ...done }
  }

  // REQ: DEC-12 — combine when every check has a final result.
  if (combination === 'REJECT_WINS') {
    if (firstReview) return { status: 'PENDING_REVIEW', ...reasonFor(firstReview, false), ...done }
  } else {
    if (firstReview) return { status: 'PENDING_REVIEW', ...reasonFor(firstReview, false), ...done }
    if (firstReject) return { status: 'REJECTED', ...reasonFor(firstReject, false), ...done }
  }

  if (flow.hasRisk) {
    if (!input.riskScores) return { status: 'PROCESSING', ...done } // risk has not run yet
    // REQ: DEC-107 — biometrics approve + High risk → PENDING_REVIEW (a biometric reject or review is decided above).
    const risk = evaluateRisk(input.riskScores, flow.settings.risk)
    if (risk.result === 'HIGH') return { status: 'PENDING_REVIEW', reason: RISK_NOT_PASSED, detail: riskDetail(risk), ...done }
  }
  return { status: 'APPROVED', ...done } // REQ: DEC-14 — lastUpdatedBy = SYSTEM
}

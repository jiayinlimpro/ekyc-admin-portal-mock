import { POLICY, type PhaseCombination } from './openQuestions'
import {
  PHASE_LABELS,
  RISK_LEVELS,
  type Attempt,
  type CapturePhase,
  type MerchantConfig,
  type PhaseConfig,
  type Verification,
  type VerificationStatus,
} from './types'

export type PhaseResult = 'PASS' | 'REVIEW' | 'REJECT'

export const REASONS = {
  BELOW_AUTO_REJECT: 'Below Auto-Reject',
  BETWEEN_THRESHOLDS: 'Between thresholds',
  RISK_NOT_PASSED: 'Risk Assessment not passed',
  attemptLimit: (phase: CapturePhase) => `Attempt limit reached – ${PHASE_LABELS[phase]}`,
} as const

// REQ: DEC-11
export function derivePhaseResult(score: number, c: Pick<PhaseConfig, 'autoPass' | 'autoReject'>): PhaseResult {
  if (score >= c.autoPass) return 'PASS'
  if (score < c.autoReject) return 'REJECT'
  return 'REVIEW'
}

export function thresholdLabel(c: Pick<PhaseConfig, 'autoPass' | 'autoReject'>): string {
  return `Pass ≥ ${c.autoPass} · Reject < ${c.autoReject}`
}

// REQ: DEC-15 / DEC-16 — MOCK-01: limit reached when the last attempt is not COMPLETED and the attempts that
// stopped at that phase reach that phase's maxAttempts.
export function attemptsExhausted(
  attempts: Attempt[],
  cfg: Pick<MerchantConfig, 'phases'>,
): { phase: CapturePhase } | undefined {
  const last = attempts.at(-1)
  if (!last || last.outcome === 'COMPLETED') return undefined
  const phaseCfg = cfg.phases.find((p) => p.phase === last.phase)
  if (!phaseCfg) return undefined
  const used = attempts.filter((a) => a.phase === last.phase).length
  return used >= phaseCfg.maxAttempts ? { phase: last.phase } : undefined
}

// REQ: DEC-13 / MOCK-02
export function riskPasses(v: Pick<Verification, 'riskLevel'>, cfg: Pick<MerchantConfig, 'risk'>): boolean {
  if (!cfg.risk?.enabled) return true
  if (!v.riskLevel) return false // V4 with risk enabled but no result yet: cannot auto-approve
  return RISK_LEVELS.indexOf(v.riskLevel) <= RISK_LEVELS.indexOf(cfg.risk.maxAllowedLevel)
}

export interface DerivedStatus {
  status: VerificationStatus
  reason?: string
}

/**
 * The status the SYSTEM assigns from attempts, phase scores and config.
 * Manual decisions are not derived; they are applied by claimRules.applyDecision.
 */
export function deriveStatus(
  v: Pick<Verification, 'attempts' | 'riskLevel'>,
  cfg: Pick<MerchantConfig, 'phases' | 'risk' | 'workflowVersion'>,
  combination: PhaseCombination = POLICY.phaseCombination,
): DerivedStatus {
  const last = v.attempts.at(-1)
  const exhausted = attemptsExhausted(v.attempts, cfg)
  if (exhausted) return { status: 'PENDING_REVIEW', reason: REASONS.attemptLimit(exhausted.phase) }
  if (!last || last.outcome !== 'COMPLETED') return { status: 'PROCESSING' }

  const results = cfg.phases
    .filter((p) => p.enabled)
    .map((p) => derivePhaseResult(last.phaseScores[p.phase] ?? 0, p))

  // REQ: DEC-12 (precedence is OQ-01)
  const hasReject = results.includes('REJECT')
  const hasReview = results.includes('REVIEW')
  if (combination === 'REJECT_WINS') {
    if (hasReject) return { status: 'REJECTED', reason: REASONS.BELOW_AUTO_REJECT }
    if (hasReview) return { status: 'PENDING_REVIEW', reason: REASONS.BETWEEN_THRESHOLDS }
  } else {
    if (hasReview) return { status: 'PENDING_REVIEW', reason: REASONS.BETWEEN_THRESHOLDS }
    if (hasReject) return { status: 'REJECTED', reason: REASONS.BELOW_AUTO_REJECT }
  }

  if (cfg.workflowVersion === 'V4' && !riskPasses(v, cfg)) {
    return { status: 'PENDING_REVIEW', reason: REASONS.RISK_NOT_PASSED }
  }
  return { status: 'APPROVED' } // REQ: DEC-14 — lastUpdatedBy = SYSTEM
}

export function isManual(v: Pick<Verification, 'lastUpdatedBy'>): boolean {
  return v.lastUpdatedBy.kind === 'USER'
}

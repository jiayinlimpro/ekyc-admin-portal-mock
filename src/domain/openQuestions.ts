// Every value in this file is an OPEN QUESTION (docs/OPEN_QUESTIONS.md), not a signed-off requirement.
// The UI must label anything read from here "OPEN QUESTION".
import type { CapturePhase, PhaseConfig, RiskLevel } from './types'

export type PhaseCombination = 'REJECT_WINS' | 'REVIEW_WINS'

export interface Policy {
  /** OQ-01: REJECT_WINS = any reject → REJECTED; REVIEW_WINS = any review → PENDING_REVIEW even if another phase rejects. */
  phaseCombination: PhaseCombination
  /** OQ-06: risk score (0–100, higher = riskier) → level. */
  riskBands: { mediumFrom: number; highFrom: number }
  /** OQ-07: are user retakes charged per attempt? */
  chargePerAttempt: boolean
  /** OQ-08: can Platform Admin claim and decide? */
  adminCanReview: boolean
}

export const POLICY: Policy = {
  phaseCombination: 'REJECT_WINS',
  riskBands: { mediumFrom: 40, highFrom: 70 },
  chargePerAttempt: false,
  adminCanReview: true,
}

/** OQ-02 / OQ-03 */
export const DEFAULT_PHASE_THRESHOLDS: Record<CapturePhase, Omit<PhaseConfig, 'phase' | 'enabled'>> = {
  DOCUMENT: { autoPass: 80, autoReject: 60, maxAttempts: 3, cooldownSec: 30 },
  SELFIE: { autoPass: 80, autoReject: 50, maxAttempts: 3, cooldownSec: 30 },
  FACE_MATCH: { autoPass: 85, autoReject: 70, maxAttempts: 3, cooldownSec: 30 },
  LIVENESS: { autoPass: 90, autoReject: 70, maxAttempts: 3, cooldownSec: 30 },
}

/** OQ-04 */
export const DEFAULT_CLAIM_TIMEOUT_MIN = 30
export const DEFAULT_CLAIM_WARNING_MIN = 5

/** OQ-05 */
export const DEFAULT_RISK_MAX_ALLOWED: RiskLevel = 'MEDIUM'

/** OQ-10: mock reason codes. */
export interface ReasonCode {
  code: string
  label: string
}

export const REASON_CODES: Record<'APPROVE' | 'REJECT', readonly ReasonCode[]> = {
  APPROVE: [
    { code: 'DOC_VERIFIED_MANUALLY', label: 'Document verified manually' },
    { code: 'FACE_MATCH_CONFIRMED', label: 'Face match confirmed by reviewer' },
    { code: 'RISK_ACCEPTED', label: 'Risk reviewed and accepted' },
  ],
  REJECT: [
    { code: 'DOC_TAMPERED', label: 'Document appears tampered' },
    { code: 'FACE_MISMATCH', label: 'Selfie does not match document' },
    { code: 'SPOOF_SUSPECTED', label: 'Liveness spoof suspected' },
    { code: 'HIGH_RISK', label: 'Risk too high' },
  ],
}

export function reasonLabel(code: string): string | undefined {
  return [...REASON_CODES.APPROVE, ...REASON_CODES.REJECT].find((r) => r.code === code)?.label
}

export function riskLevelFromScore(score: number, bands = POLICY.riskBands): RiskLevel {
  if (score >= bands.highFrom) return 'HIGH'
  if (score >= bands.mediumFrom) return 'MEDIUM'
  return 'LOW'
}

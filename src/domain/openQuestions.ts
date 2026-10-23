// Every value in this file is an OPEN QUESTION (docs/OPEN_QUESTIONS.md), not a signed-off requirement.
// The UI must label anything read from here "OPEN QUESTION".
import type { Check, RiskCategory, RiskLevel, ThresholdPreset } from './types'

export type PhaseCombination = 'REJECT_WINS' | 'REVIEW_WINS'

export interface Policy {
  /** OQ-01: REJECT_WINS = any reject → REJECTED; REVIEW_WINS = any review → PENDING_REVIEW even if another phase rejects. */
  phaseCombination: PhaseCombination
  /** OQ-06: risk score (0–100, higher = riskier) → level. */
  riskBands: { mediumFrom: number; highFrom: number }
}

export const POLICY: Policy = {
  phaseCombination: 'REJECT_WINS',
  riskBands: { mediumFrom: 40, highFrom: 70 },
}

/** OQ-02: preset values per check (DEC-19). Low = lenient, High = strict. */
export const THRESHOLD_PRESETS: Record<Check, Record<ThresholdPreset, { autoReject: number; autoPass: number }>> = {
  FACE_MATCH: { LOW: { autoReject: 80, autoPass: 90 }, STANDARD: { autoReject: 85, autoPass: 95 }, HIGH: { autoReject: 90, autoPass: 97 } },
  LIVENESS: { LOW: { autoReject: 60, autoPass: 80 }, STANDARD: { autoReject: 70, autoPass: 85 }, HIGH: { autoReject: 80, autoPass: 92 } },
}

/** OQ-03: "Retries allowed" per check (DEC-18). Default 3 retries = up to 4 submissions. */
export const RETRY_LIMITS = { min: 1, max: 5, default: 3 } as const

/** DEC-26 (FRS default); what counts as the "same end user" is OQ-22. */
export const DEFAULT_COOLDOWN_MIN = 0

/** OQ-04 */
export const DEFAULT_CLAIM_TIMEOUT_SEC = 30 * 60 // 30 minutes
export const DEFAULT_CLAIM_WARNING_MIN = 5

/** OQ-05 */
export const DEFAULT_RISK_MAX_ALLOWED: RiskLevel = 'MEDIUM'

export function riskLevelFromScore(score: number, bands = POLICY.riskBands): RiskLevel {
  if (score >= bands.highFrom) return 'HIGH'
  if (score >= bands.mediumFrom) return 'MEDIUM'
  return 'LOW'
}

/**
 * OQ-25: reason codes each risk category can return (DEC-105). Sample codes until the risk engine's list is confirmed.
 * Mock: a category shows codes from the medium band (`POLICY.riskBands.mediumFrom`) up, and the overall score is the
 * highest category score.
 */
export const RISK_REASON_CODES: Record<RiskCategory, readonly { code: string; label: string }[]> = {
  EXIF: [
    { code: 'EXIF_MISSING', label: 'Image has no camera metadata' },
    { code: 'EXIF_EDITING_SOFTWARE', label: 'Image saved by editing software' },
    { code: 'EXIF_DATE_MISMATCH', label: 'Capture time differs from the session time' },
  ],
  NOISE: [
    { code: 'NOISE_INCONSISTENT', label: 'Noise differs between image regions (possible splicing)' },
    { code: 'NOISE_SCREEN_PATTERN', label: 'Screen pattern detected (photo of a screen)' },
    { code: 'NOISE_RECOMPRESSED', label: 'Image compressed more than once' },
  ],
  EMAIL_VALIDITY: [
    { code: 'EMAIL_DISPOSABLE', label: 'Disposable email domain' },
    { code: 'EMAIL_NO_MAILBOX', label: 'Domain has no mail server' },
    { code: 'EMAIL_RECENTLY_CREATED', label: 'Email address first seen recently' },
  ],
  OSINT: [
    { code: 'OSINT_NO_FOOTPRINT', label: 'No public footprint for the email' },
    { code: 'OSINT_DATA_BREACH', label: 'Email found in data breaches' },
    { code: 'OSINT_NAME_MISMATCH', label: 'Public profiles show a different name' },
  ],
}

/** OQ-14: mock token price (RM per liveness submission, DEC-60). */
export const TOKEN_PRICE = 0.5

/** OQ-31: the company staff email domain (DEC-99): platform staff and super admins must use it; merchant users may not. */
export const STAFF_EMAIL_DOMAIN = 'ekyc-platform.example'

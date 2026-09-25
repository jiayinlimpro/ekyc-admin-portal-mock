// Domain contract for the eKYC Admin Portal mock. Source of truth: docs/DECISIONS.md.
// Const arrays + derived types (not TS enums): loopable for dropdowns/badges and compatible with erasableSyntaxOnly.

// REQ: DEC-01 — exactly 4 statuses. Never add more.
export const VERIFICATION_STATUSES = ['PROCESSING', 'PENDING_REVIEW', 'APPROVED', 'REJECTED'] as const
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number]

// REQ: DEC-10 — DOCUMENT = Capture & OCR; RISK_ASSESSMENT = internal engine, V4 only.
export const PHASES = ['DOCUMENT', 'SELFIE', 'FACE_MATCH', 'LIVENESS', 'RISK_ASSESSMENT'] as const
export type Phase = (typeof PHASES)[number]

// Phases the end user goes through, which have Auto-Pass / Auto-Reject thresholds and attempts.
export const CAPTURE_PHASES = ['DOCUMENT', 'SELFIE', 'FACE_MATCH', 'LIVENESS'] as const
export type CapturePhase = (typeof CAPTURE_PHASES)[number]

export const PHASE_LABELS: Record<Phase, string> = {
  DOCUMENT: 'Document',
  SELFIE: 'Selfie',
  FACE_MATCH: 'Face Match',
  LIVENESS: 'Liveness',
  RISK_ASSESSMENT: 'Risk Assessment',
}

export const WORKFLOW_VERSIONS = ['V1', 'V2', 'V3', 'V4'] as const
export type WorkflowVersion = (typeof WORKFLOW_VERSIONS)[number]

export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const
export type RiskLevel = (typeof RISK_LEVELS)[number]

// REQ: DEC-70 — 2 roles only (names are OQ-09).
export const ROLES = ['PLATFORM_ADMIN', 'MERCHANT_REVIEWER'] as const
export type RoleType = (typeof ROLES)[number]

export interface Actor {
  userId: string
  fullName: string
  role: RoleType
  merchantId?: string // required for MERCHANT_REVIEWER
}

// REQ: DEC-02 — manual vs automated is read from lastUpdatedBy.
export type UpdatedBy = { kind: 'SYSTEM' } | { kind: 'USER'; userId: string; fullName: string }

export type DocumentType = 'MYKAD' | 'PASSPORT'

export type MetricResult = 'PASS' | 'REVIEW' | 'FAIL'

// Display-only (DEC-10). The phase score, not individual metrics, drives the status.
export interface PhaseMetric {
  phase: Phase
  name: string
  detected: number | string
  threshold?: string // e.g. "Pass ≥ 85 · Reject < 70"
  result: MetricResult
}

export type AttemptOutcome = 'COMPLETED' | 'ABORTED' | 'TIMED_OUT' | 'FAILED_RETAKE'

export interface Attempt {
  attemptNo: number
  phase: CapturePhase // phase where the attempt stopped (last phase if COMPLETED) — MOCK-01
  startedAt: string // ISO UTC
  outcome: AttemptOutcome
  isUserRetake: boolean // REQ: DEC-18 — Retry KPI counts only these
  phaseScores: Partial<Record<CapturePhase, number>>
}

export interface Pii {
  fullName: string
  nric?: string // MYKAD only
  passportNo?: string // PASSPORT only
  gender: 'LELAKI' | 'PEREMPUAN'
  dob: string // yyyy-MM-dd
  nationality: string
  religion?: string
  address: string
}

export interface ClientMetadata {
  sdk: string
  os: string
  device: string
  ip: string
  geo?: string
}

export interface ClaimHolder {
  userId: string
  fullName: string
}

export interface Verification {
  referenceNo: string // KYC-YYMMDD-NNNNNN, unchanged across retries (DEC-17)
  merchantId: string
  workflowVersion: WorkflowVersion
  configVersion: string // config the record was evaluated with (DEC-52)
  status: VerificationStatus
  statusReason?: string // e.g. "Attempt limit reached – Liveness"
  lastUpdatedBy: UpdatedBy // changes ONLY when status changes (DEC-03)
  lastUpdatedAt: string // the only lifecycle timestamp (DEC-04)
  // REQ: DEC-20 — claim is NOT a status
  claimedBy?: ClaimHolder
  claimedAt?: string
  claimExpiresAt?: string
  attempts: Attempt[]
  riskLevel?: RiskLevel // V4 only
  riskScore?: number // V4 only
  documentType: DocumentType
  pii: Pii
  clientMetadata: ClientMetadata
  metrics: PhaseMetric[]
  images: { docFront: string; selfie: string }
  charged: true // REQ: DEC-60 — every verification is charged
}

// REQ: DEC-40 — list rows carry no PII beyond name/ref and no client metadata.
export interface VerificationSummary {
  referenceNo: string
  merchantId: string
  merchantName: string
  fullName: string
  documentType: DocumentType
  workflowVersion: WorkflowVersion
  status: VerificationStatus
  riskLevel?: RiskLevel
  claimedBy?: ClaimHolder // only while the claim is active
  claimExpiresAt?: string
  lastUpdatedBy: UpdatedBy
  lastUpdatedAt: string
  submittedAt: string // derived from attempts[0].startedAt (DEC-04)
}

// REQ: DEC-41 — detail carries full PII + client metadata.
export type VerificationDetail = Verification & { merchantName: string }

export interface PhaseConfig {
  phase: CapturePhase
  enabled: boolean
  autoPass: number // score >= autoPass → pass
  autoReject: number // score < autoReject → reject; between → review
  maxAttempts: number // OQ-03
  cooldownSec: number // OQ-03
}

export interface RiskConfig {
  enabled: boolean
  maxAllowedLevel: RiskLevel // OQ-05
}

export interface MerchantConfig {
  merchantId: string
  version: string // e.g. v1.2.0
  state: 'DRAFT' | 'DEPLOYED'
  workflowVersion: WorkflowVersion
  phases: PhaseConfig[]
  risk?: RiskConfig // V4 only
  claimTimeoutMin: number // OQ-04
  claimWarningMin: number // OQ-04
  updatedAt: string
  updatedBy: ClaimHolder | { userId: 'SYSTEM'; fullName: 'SYSTEM' }
  deployedAt?: string
}

export interface Merchant {
  merchantId: string
  name: string
  workflowVersion: WorkflowVersion
}

export type Decision =
  | { outcome: 'APPROVE'; reasonCode: string; comment: string } // "Confirm Manual Pass"
  | { outcome: 'REJECT'; reasonCode: string; comment: string } // "Maintain Automated Rejection"

// REQ: DEC-42
export const AUDIT_ACTIONS = [
  'PII_VIEW',
  'CLAIM',
  'CLAIM_RELEASE',
  'CLAIM_TIMEOUT',
  'DECISION',
  'OWNERSHIP_CONFLICT',
  'CONFIG_DRAFT_SAVE',
  'CONFIG_DISCARD',
  'CONFIG_DEPLOY',
  'CREDENTIAL_ROTATION',
] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export interface AuditEntry {
  id: string
  at: string // ISO UTC
  action: AuditAction
  actor: UpdatedBy
  merchantId?: string
  referenceNo?: string
  ip: string
  details: Record<string, unknown>
}

export interface Paged<T> {
  items: T[]
  page: number // 1-based
  pageSize: number
  total: number
}

/** Stored user (UAM). The session only needs the Actor part. */
export interface UserRecord extends Actor {
  active: boolean
  createdAt: string
}

/** Merchant API credential. The secret is mock-only (sk_mock_…) and never real. */
export interface ApiCredential {
  merchantId: string
  keyId: string
  secret: string
  createdAt: string
  createdBy: string // fullName, or SYSTEM
}

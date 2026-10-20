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

// REQ: DEC-58 — known registry codes (no V2). Version-dependent behaviour comes from the registry entry, not this list.
export const WORKFLOW_VERSIONS = ['V1', 'V3', 'V4', 'V5'] as const
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
  // Projects & Flows (DEC-44, DEC-52). `status` and `statusReason` come from checkRules.evaluateCase over `submissions`
  // with the settings of `configRevision`; `attempts`, `metrics` and `configVersion` remain for the current screens.
  projectId: string
  flowId: string
  configRevision: number // the flow revision live when the session started ("Rules applied")
  createdAt: string // session started (DEC-04)
  submissions: Partial<Record<Check, number[]>> // scores per check, in submission order
  idCaptureSoftRejects: number // ID capture retakes: unlimited, free, not counted as retries (DEC-18)
  statusDetail?: string // e.g. "Auto-Reject < 70 · Auto-Pass ≥ 85 · Actual 78"
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

// REQ: DEC-42 — event names, grouped as in DECISIONS.md.
export const AUDIT_ACTION_GROUPS = {
  Cases: ['SENSITIVE_PII_VIEW', 'CASE_CLAIMED', 'CASE_RELEASED', 'CASE_CLAIM_EXPIRED', 'CASE_DECISION_APPROVED', 'CASE_DECISION_REJECTED', 'CASE_DECISION_BLOCKED'],
  Flows: ['FLOW_CREATED', 'FLOW_ACTIVATED', 'FLOW_RETIRED', 'FLOW_DEFAULT_CHANGED', 'FLOW_SETTING_CHANGED'],
  Projects: ['PROJECT_CREATED', 'PROJECT_RENAMED', 'PROJECT_ARCHIVED', 'PROJECT_SETTING_CHANGED'],
  Integration: ['API_KEY_CREATED', 'API_KEY_ROTATED', 'API_KEY_REVOKED', 'WEBHOOK_CHANGED'],
  Users: ['USER_INVITED', 'USER_ROLE_CHANGED', 'USER_REMOVED', 'USER_DEACTIVATED'],
  Registry: ['WORKFLOW_REGISTERED', 'WORKFLOW_UPDATED', 'WORKFLOW_STATUS_CHANGED', 'WORKFLOW_DEFAULT_CHANGED'],
  Merchants: ['MERCHANT_CREATED', 'MERCHANT_UPDATED', 'MERCHANT_STATUS_CHANGED'],
  // Legacy: the merchant-level eKYC Workflow and Developers screens, until Flows and Project Settings replace them.
  Legacy: ['CONFIG_DRAFT_SAVE', 'CONFIG_DISCARD', 'CONFIG_DEPLOY', 'CREDENTIAL_ROTATION'],
} as const
export type AuditAction = (typeof AUDIT_ACTION_GROUPS)[keyof typeof AUDIT_ACTION_GROUPS][number]
export const AUDIT_ACTIONS: readonly AuditAction[] = Object.values(AUDIT_ACTION_GROUPS).flat()

export interface AuditEntry {
  id: string
  at: string // ISO UTC
  action: AuditAction
  actor: UpdatedBy
  actorRole?: EffectiveRole // REQ: DEC-42 — the actor's role in the project (or Platform Admin); absent for SYSTEM
  merchantId?: string
  projectId?: string
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

// ---------------------------------------------------------------------------------------------------------------------
// Projects & Flows (DEC-90 … DEC-96). Added alongside the merchant-level model above; services move over in Phase 4.
// ---------------------------------------------------------------------------------------------------------------------

/** Registry code, e.g. "V4". A string because Platform Admin can register new codes (DEC-56). */
export type WorkflowCode = string

// REQ: DEC-10 — the only checks with configurable thresholds.
export const CHECKS = ['FACE_MATCH', 'LIVENESS'] as const
export type Check = (typeof CHECKS)[number]

export const PROJECT_STATUSES = ['ACTIVE', 'ARCHIVED'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export interface Project {
  projectId: string // PRJ-0001
  merchantId: string
  name: string
  status: ProjectStatus
  isDefault: boolean // the merchant's Default project (DEC-92)
  defaultFlowId: string // exactly one default flow per project (DEC-94)
  claimTimeoutMin: number // REQ: DEC-22 — OQ-04
  createdAt: string
  createdBy: string // fullName, or SYSTEM
}

// REQ: DEC-94
export const FLOW_STATUSES = ['DRAFT', 'ACTIVE', 'RETIRING', 'INACTIVE'] as const
export type FlowStatus = (typeof FLOW_STATUSES)[number]

// REQ: DEC-19 — a preset, or custom values set by Platform Admin.
export const THRESHOLD_PRESETS_ORDER = ['LOW', 'STANDARD', 'HIGH'] as const
export type ThresholdPreset = (typeof THRESHOLD_PRESETS_ORDER)[number]
export type ThresholdChoice = { preset: ThresholdPreset } | { preset: 'ADVANCED'; autoReject: number; autoPass: number }

export interface CheckSettings {
  threshold: ThresholdChoice
  retriesAllowed: number // REQ: DEC-18 — retries after the first submission
}

export interface FlowSettings {
  checks: Record<Check, CheckSettings>
  cooldownMin: number // REQ: DEC-26
  acceptedDocuments: DocumentType[]
  sessionExpiryMin: number
  risk?: RiskConfig // V4 (V5 is OQ-05)
}

/**
 * How sessions reach this flow besides being the project default (DEC-95). Set by the merchant through the API; read-only
 * in the portal. "Default" is not stored here: it comes from `Project.defaultFlowId`.
 */
export type FlowRouting = { kind: 'NONE' } | { kind: 'RULE'; priority: number; summary: string } | { kind: 'SHARE'; percent: number }

export interface Flow {
  flowId: string // FLW-0001
  projectId: string
  merchantId: string
  name: string
  description: string // who this flow is for
  workflowVersion: WorkflowCode // locked once the flow has been active (DEC-94)
  status: FlowStatus
  settings: FlowSettings
  revision: number // REQ: DEC-51 — 0 until first activated; shown as `${workflowVersion}-R${revision}`
  routing: FlowRouting
  createdAt: string
  updatedAt: string
  updatedBy: ClaimHolder | { userId: 'SYSTEM'; fullName: 'SYSTEM' }
}

// REQ: DEC-70 — per-project roles. Merchant Owner and Platform Admin are not project roles: they apply to all projects.
export const PROJECT_ROLES = ['PROJECT_ADMIN', 'REVIEWER', 'VIEWER'] as const
export type ProjectRole = (typeof PROJECT_ROLES)[number]
export type AccessLevel = 'PLATFORM_ADMIN' | 'MERCHANT_OWNER' | 'MEMBER'
/** A user's role in one project: Platform Admin and Merchant Owner apply to every project they reach. */
export type EffectiveRole = 'PLATFORM_ADMIN' | 'MERCHANT_OWNER' | ProjectRole

export interface ProjectMembership {
  projectId: string
  role: ProjectRole // one role per project (DEC-74)
}

/** What a user may reach: their level, their merchant, and (for members) one role per project. */
export interface UserAccess {
  userId: string
  level: AccessLevel
  merchantId?: string // required unless PLATFORM_ADMIN
  memberships: ProjectMembership[] // only used for MEMBER
}

// REQ: DEC-56 / DEC-58
export const REGISTRY_STATUSES = ['DRAFT', 'ACTIVE', 'DEPRECATED'] as const
export type RegistryStatus = (typeof REGISTRY_STATUSES)[number]
export const ONBOARDING_PHASES = ['ID_CAPTURE', 'SELFIE_CAPTURE', 'LIVENESS_CHECK', 'RISK_ASSESSMENT'] as const
export type OnboardingPhase = (typeof ONBOARDING_PHASES)[number]
export type FaceMatchMethod = 'ID_VS_SELFIE' | 'ID_VS_LIVENESS'
export type SessionInput = 'EMAIL'

export interface RegistryEntry {
  code: WorkflowCode
  name: string
  description: string // purpose, e.g. "V3 + risk assessment"
  phases: OnboardingPhase[] // ordered; ID_CAPTURE first
  faceMatchMethod: FaceMatchMethod
  requiredInputs: SessionInput[]
  configurableChecks: Check[]
  stateMachineSandbox?: string // record only, never called
  stateMachineProduction?: string
  releaseNotes: { at: string; by: string; text: string }[] // append-only
  status: RegistryStatus
  isDefault: boolean // REQ: DEC-57 — "Default for new merchants"
  activatedAt?: string // set the first time it becomes Active; locks most fields
  registeredAt: string
  registeredBy: string
  updatedAt: string
  updatedBy: string
}

/** A validation or rule failure, shown next to `field` (or as a toast when the field is not on screen). */
export interface RuleError {
  field: string
  message: string
}

/** One field's old and new value, worded for History and audit (DEC-42, DEC-50). */
export interface SettingChange {
  field: string
  from: string
  to: string
}

// REQ: DEC-51 — every saved revision of an active flow, oldest first. A case's "Rules applied" is its revision's settings.
export interface FlowRevision {
  flowId: string
  revision: number // 1, 2, …
  savedAt: string
  savedBy: ClaimHolder | { userId: 'SYSTEM'; fullName: 'SYSTEM' }
  reason: string // "Reason for change"; the first revision records the activation
  settings: FlowSettings
  changes: SettingChange[]
}

// REQ: DEC-74
export const USER_STATUSES = ['INVITED', 'ACTIVE', 'DEACTIVATED'] as const
export type UserStatus = (typeof USER_STATUSES)[number]

/** A portal account under the per-project model. Replaces UserRecord once services move over (Phase 4). */
export interface UserAccount extends UserAccess {
  fullName: string
  email: string
  status: UserStatus
  invitedAt: string
  lastActiveAt?: string
}

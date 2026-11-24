// Domain contract for the eKYC Admin Portal mock. Source of truth: docs/DECISIONS.md.
import type { CheckEvaluation, PhaseEvaluation } from './checkRules'
// Const arrays + derived types (not TS enums): loopable for dropdowns/badges and compatible with erasableSyntaxOnly.

// REQ: DEC-01 — exactly 4 statuses. Never add more.
// REQ: DEC-01 / DEC-112 — exactly these five, in lifecycle order (UNSUCCESSFUL = no usable image when retries ran out).
export const VERIFICATION_STATUSES = ['PROCESSING', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'UNSUCCESSFUL'] as const
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
  FACE_MATCH: 'Face match', // REQ: DEC-10 — the configurable band on the similarity (face vs ID photo)
  LIVENESS: 'Liveness',
  RISK_ASSESSMENT: 'Risk Assessment',
}

// REQ: DEC-58 — known registry codes (no V2). Version-dependent behaviour comes from the registry entry, not this list.
export const WORKFLOW_VERSIONS = ['V1', 'V3', 'V4', 'V5', 'V6'] as const
export type WorkflowVersion = (typeof WORKFLOW_VERSIONS)[number]

// REQ: DEC-107 — the risk result. Low risk / High risk, never pass / fail, so it is not confused with the case status.
export const RISK_RESULTS = ['LOW', 'HIGH'] as const
export type RiskResult = (typeof RISK_RESULTS)[number]

// REQ: DEC-107 — the risk engine's four categories, each scored 0–100, higher = more genuine (how: OQ-25).
export const RISK_CATEGORIES = ['EXIF', 'NOISE', 'EMAIL_VALIDITY', 'OSINT'] as const
export type RiskCategory = (typeof RISK_CATEGORIES)[number]
export type RiskScores = Record<RiskCategory, number>
export const RISK_CATEGORY_LABELS: Record<RiskCategory, string> = { EXIF: 'EXIF Score', NOISE: 'Noise Score', EMAIL_VALIDITY: 'Email Validity Score', OSINT: 'OSINT Score' }

/** Who is signed in. What they may do is read from their account and project roles (UserAccount, DEC-70), never from the session. */
export interface Actor {
  userId: string
  fullName: string
}

// REQ: DEC-02 — manual vs automated is read from lastUpdatedBy.
export type UpdatedBy = { kind: 'SYSTEM' } | { kind: 'USER'; userId: string; fullName: string }

// REQ: DEC-50 — accepted documents: MyKad, Passport, Driving License.
export type DocumentType = 'MYKAD' | 'PASSPORT' | 'DRIVING_LICENSE'

export type AttemptOutcome = 'COMPLETED' | 'ABORTED' | 'TIMED_OUT' | 'FAILED_RETAKE'

/**
 * REQ: DEC-113 — one session of a case. A returning Reference ID starts a new session on the same case; the case's own
 * fields (flow, revision, scores, attempts, telemetry, status) always describe the current (last) session.
 */
export interface CaseSession {
  sessionNo: number // shown as "Session 1, 2, 3"
  startedAt: string
  flowId: string // the flow it ran on: a case can move to another flow of its project
  workflowVersion: WorkflowVersion
  configRevision: number // its "Rules applied"
  ended?: SessionEnd // set when a later session started; the current session has none
}

/** REQ: DEC-113 / DEC-60 — how an earlier session ended, what it cost, and its attempts (kept for the history). */
export interface SessionEnd {
  status: 'REJECTED' | 'UNSUCCESSFUL'
  reason?: string
  at: string
  by: UpdatedBy
  tokens: number
  retryTokens: number
  attempts: Attempt[]
}

export interface Attempt {
  attemptId: string // att_… (DEC-97); shown as "Attempt 1, 2, 3", never by ID
  attemptNo: number
  phase: CapturePhase // phase where the attempt stopped (last phase if COMPLETED) — MOCK-01
  startedAt: string // ISO UTC
  outcome: AttemptOutcome
  isUserRetake: boolean // REQ: DEC-18 — Retry KPI counts only these
  phaseScores: Partial<Record<CapturePhase, number>> // FACE_MATCH = the similarity it judges (face vs ID photo), LIVENESS = liveness confidence
  faceImage?: StoredFile // the face matched in this attempt: the selfie (V1) or the liveness frame (V3/V4/V5)
  telemetry?: AttemptTelemetry // REQ: DEC-105
}

// REQ: DEC-105 — engine metrics, shown on Verification Detail with their fixed thresholds (`ENGINE_THRESHOLDS`).
/** The accepted ID image (or the last one, if the session stopped at ID capture). Retakes before it are `idCaptureSoftRejects`. */
export interface IdCaptureTelemetry {
  facesFound: number
  faceConfidence: number // 0–100: face detection confidence on the ID (≥ 90); not a similarity
  eyesOpen: boolean
  occluded: boolean // face covered (mask, hand, glare)
  imageWidth: number // px
  imageHeight: number // px
  ocrFieldsMissing: string[] // required fields of the document type (`OCR_FIELDS`) that were not read
}

/** V1 selfie quality (the engine's "Selfie Quality Check"). A selfie that fails it ends the run: no similarity. */
export interface SelfieTelemetry {
  eyesOpen: boolean
  occluded: boolean
  sharpness: number // 0–100
  brightness: number // 0–100
  yaw: number // degrees, signed
  pitch: number // degrees, signed
  faceSizePx: number // shorter side of the face box; not part of the selfie check (OQ-32)
}

export interface AttemptTelemetry {
  selfie?: SelfieTelemetry // V1 only: the selfie that passed and was compared
  /** V1 only: submitted selfies the engine rejected before that one; each used a selfie retry and a token (DEC-108, DEC-60). None was compared with the ID. */
  selfieRetakes?: SelfieTelemetry[]
  /** Face detection confidence: a face is clearly detected in the compared image (> 90, engine). Not the similarity. */
  faceMatchConfidence?: number
}

/** REQ: DEC-105 — the face search across the merchant's users. Information only: never changes a check or the status. */
export interface DuplicateUserCheck {
  existingUser: boolean // best similarity ≥ ENGINE_THRESHOLDS.duplicateSimilarityMin
  similarity?: number // best match found; absent when no face was searched against yet
}

/** An uploaded image (ID document, selfie, liveness frame). `url` is a sample image in the mock. */
export interface StoredFile {
  fileId: string // file_…
  url: string
}

export interface Pii {
  fullName: string
  nric?: string // MYKAD and DRIVING_LICENSE (the IC field)
  passportNo?: string // PASSPORT only
  licenceClass?: string // DRIVING_LICENSE only, e.g. "B2 D"
  licenceValidUntil?: string // DRIVING_LICENSE only, yyyy-MM-dd
  email?: string // REQ: DEC-44 — V4/V5: the session's required EMAIL input
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
  verificationId: string // vrf_… — the case's own ID: URLs, webhooks, audit (DEC-97)
  referenceId: string // the merchant's own Reference ID, sent at session creation; never the key (DEC-97, OQ-28)
  merchantId: string
  workflowVersion: WorkflowVersion
  status: VerificationStatus
  statusReason?: string // e.g. "Attempt limit reached – Liveness"
  lastUpdatedBy: UpdatedBy // changes ONLY when status changes (DEC-03)
  lastUpdatedAt: string // the only lifecycle timestamp (DEC-04)
  // REQ: DEC-20 — claim is NOT a status
  claimedBy?: ClaimHolder
  claimedAt?: string
  claimExpiresAt?: string
  attempts: Attempt[]
  riskScores?: RiskScores // REQ: DEC-107 — V4/V5, once risk ran: the engine's four category scores
  riskResult?: RiskResult // REQ: DEC-107 — against the minimums of the rules applied
  idCapture?: IdCaptureTelemetry // REQ: DEC-105 — absent when no ID image was submitted
  duplicateUser?: DuplicateUserCheck // REQ: DEC-105 — absent until a face was searched; never in VerificationSummary (DEC-40)
  documentType: DocumentType
  pii: Pii
  clientMetadata: ClientMetadata
  images: { docFront: StoredFile; selfie: StoredFile } // REQ: DEC-97 — uploaded files have their own ID
  charged: boolean // REQ: DEC-60 / DEC-56 — false only for sessions on an Internal testing version
  // Projects & Flows (DEC-44, DEC-52). `status` and `statusReason` come from checkRules.evaluateCase over `submissions`
  // with the settings of `configRevision`.
  projectId: string
  flowId: string
  configRevision: number // the flow revision live when the session started ("Rules applied")
  createdAt: string // session started (DEC-04)
  submissions: Partial<Record<Check, number[]>> // scores per check, in submission order
  idCaptureSoftRejects: number // REQ: DEC-108 — submitted ID images that failed before the last one: each used a Document retry
  statusDetail?: string // e.g. "Auto-Reject < 70 · Auto-Pass ≥ 85 · Actual 78"
  decidedReasons?: DecisionReasonRef[] // REQ: DEC-106 — set by a manual decision
  sessions: CaseSession[] // REQ: DEC-113 — oldest first; the last one is the current session
}

// REQ: DEC-40 — list rows carry no PII beyond name/ref, no client metadata and no duplicate-user information.
export interface VerificationSummary {
  verificationId: string
  referenceId: string
  merchantId: string
  merchantName: string
  projectId: string
  projectName: string
  flowId: string
  flowName: string
  fullName: string
  documentType: DocumentType
  workflowVersion: WorkflowVersion
  status: VerificationStatus
  riskResult?: RiskResult // REQ: DEC-107 — Low risk / High risk; no scores in the list
  claimedBy?: ClaimHolder // only while the claim is active
  claimExpiresAt?: string
  lastUpdatedBy: UpdatedBy
  lastUpdatedAt: string
  createdAt: string // session started (DEC-04)
}

// REQ: DEC-41 / DEC-44 — detail carries full PII + client metadata, and everything the Detail sections show.
export type VerificationDetail = Verification & {
  merchantName: string
  projectName: string
  flowName: string
  revisionLabel: string // "Rules applied", e.g. V4-R1 (DEC-51, DEC-52)
  rulesApplied: FlowSettings // the revision's settings: the snapshot at session start
  steps: { phases: OnboardingPhase[]; faceMatchMethod: FaceMatchMethod; runsRisk: boolean; riskMinimumsPerFlow: boolean } // from the registry version
  checks: CheckEvaluation[] // face match / liveness: threshold applied, result, retries used / allowed
  phases: PhaseEvaluation[] // REQ: DEC-108 — submissions and retries per phase
  newSessionAllowedAt?: string // REQ: DEC-26 / DEC-113 — REJECTED or UNSUCCESSFUL with a cooldown: when the same Reference ID may start a new session
  sessionRows: (CaseSession & { flowName: string; revisionLabel: string; tokens: number })[] // REQ: DEC-113 — for the Sessions section
  reasonOptions: DecisionReason[] // REQ: DEC-106 — the project's active decision reasons, for the decision panel
}

/** REQ: DEC-107 — one minimum per category: below any of them, the risk result is High risk. Fixed for V4, per flow for V5. */
export interface RiskConfig {
  enabled: boolean
  minimums: RiskScores
}

// REQ: DEC-98 — [FRS] merchant statuses: Onboarding (sandbox) → Active (live) → Suspended (freeze) → Terminated (final).
export const MERCHANT_STATUSES = ['ONBOARDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED'] as const
export type MerchantStatus = (typeof MERCHANT_STATUSES)[number]

/** REQ: DEC-90 / DEC-98 — the top level, a business client. Workflow versions are chosen per flow, not per merchant. */
export interface Merchant {
  merchantId: string // mer_… (DEC-97)
  name: string
  registrationNo: string // locked after creation; SSM 12-digit for Malaysia
  country: string // country of incorporation, ISO 3166-1 alpha-2; locked after creation
  primaryContact: { fullName: string; email: string; phone?: string } // the first Merchant Owner; email locked
  status: MerchantStatus
  createdAt: string
  createdBy: string
}

// REQ: DEC-30 / DEC-31 — "Confirm Manual Pass" needs no reason code; "Reject" needs one or more DEC-35 failure conditions
// (codes from the project's decision reasons, DEC-106): Reject one or more, Approve exactly one. The note is optional
// unless a chosen reason requires it.
export type DecisionOutcome = 'APPROVE' | 'REJECT'
export interface Decision {
  outcome: DecisionOutcome
  reasonCodes: string[]
  note?: string
}

// REQ: DEC-106 — what a reviewer picks; separate from the engine's conditions (DEC-35).
export const REJECT_REASON_GROUPS = ['DOCUMENT', 'FACE_LIVENESS', 'IDENTITY', 'FRAUD_RISK', 'OTHER'] as const
export type RejectReasonGroup = (typeof REJECT_REASON_GROUPS)[number]

export interface DecisionReason {
  code: string // stable: System Default codes are shared by every project; Custom ones are generated (CUSTOM_…)
  name: string
  outcome: DecisionOutcome
  group?: RejectReasonGroup // Reject reasons only
  noteRequired: boolean
  system: boolean // System Default: locked, can only be turned off
  active: boolean
}

/** Stored per project: which System Default reasons are off, and the project's own reasons. */
export interface ProjectDecisionReasons {
  disabledSystemCodes: string[]
  custom: DecisionReason[] // never deleted (past decisions refer to them)
}

/** The reasons a decision was saved with, as named at the time. */
export interface DecisionReasonRef {
  code: string
  name: string
}

// REQ: DEC-42 — event names, grouped as in DECISIONS.md.
export const AUDIT_ACTION_GROUPS = {
  Cases: ['SENSITIVE_PII_VIEW', 'CASE_CLAIMED', 'CASE_RELEASED', 'CASE_CLAIM_EXPIRED', 'CASE_DECISION_APPROVED', 'CASE_DECISION_REJECTED', 'CASE_DECISION_BLOCKED', 'CASE_RESUMED'],
  Flows: ['FLOW_CREATED', 'FLOW_ACTIVATED', 'FLOW_RETIRED', 'FLOW_SETTING_CHANGED'],
  Projects: ['PROJECT_CREATED', 'PROJECT_RENAMED', 'PROJECT_ARCHIVED', 'PROJECT_SETTING_CHANGED'],
  Integration: ['API_KEY_CREATED', 'API_KEY_ROTATED', 'API_KEY_REVOKED', 'WEBHOOK_CHANGED'],
  Users: ['USER_INVITED', 'USER_INVITATION_RESENT', 'USER_ACCESS_ADDED', 'USER_ACCESS_CHANGED', 'USER_ACCESS_REMOVED', 'USER_SUSPENDED', 'USER_REACTIVATED'],
  Roles: ['ROLE_CREATED', 'ROLE_UPDATED', 'ROLE_STATUS_CHANGED'],
  Registry: ['WORKFLOW_REGISTERED', 'WORKFLOW_UPDATED', 'WORKFLOW_STATUS_CHANGED', 'WORKFLOW_DEFAULT_CHANGED'],
  Merchants: ['MERCHANT_CREATED', 'MERCHANT_UPDATED', 'MERCHANT_STATUS_CHANGED'],
} as const
export type AuditAction = (typeof AUDIT_ACTION_GROUPS)[keyof typeof AUDIT_ACTION_GROUPS][number]
export const AUDIT_ACTIONS: readonly AuditAction[] = Object.values(AUDIT_ACTION_GROUPS).flat()

export interface AuditEntry {
  id: string
  at: string // ISO UTC
  action: AuditAction
  actor: UpdatedBy
  actorRole?: string // REQ: DEC-42 — the actor's role names in the project, or "Super admin"; absent for SYSTEM
  merchantId?: string
  projectId?: string
  verificationId?: string // REQ: DEC-97 — the case this entry is about; Reference ID kept for search and display
  referenceId?: string
  ip: string
  details: Record<string, unknown>
}

export interface Paged<T> {
  items: T[]
  page: number // 1-based
  pageSize: number
  total: number
}

// ---------------------------------------------------------------------------------------------------------------------
// Projects & Flows (DEC-90 … DEC-96).
// ---------------------------------------------------------------------------------------------------------------------

/** Registry code, e.g. "V4". A string because Super admin can register new codes (DEC-56). */
export type WorkflowCode = string

// REQ: DEC-10 — the only checks with configurable thresholds.
export const CHECKS = ['FACE_MATCH', 'LIVENESS'] as const
export type Check = (typeof CHECKS)[number]

// REQ: DEC-108 — "Retries allowed" is per phase: every submitted attempt that fails in that phase uses one.
export const RETRY_PHASES = ['DOCUMENT', 'SELFIE', 'LIVENESS'] as const
export type RetryPhase = (typeof RETRY_PHASES)[number]
export const RETRY_PHASE_LABELS: Record<RetryPhase, string> = { DOCUMENT: 'Document (OCR)', SELFIE: 'Selfie', LIVENESS: 'Liveness' }

export const PROJECT_STATUSES = ['ACTIVE', 'ARCHIVED'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export interface Project {
  projectId: string // prj_… (DEC-97)
  merchantId: string
  name: string
  status: ProjectStatus
  isDefault: boolean // the merchant's Default project (DEC-92). No default flow: every session names its flow (DEC-95)
  claimTimeoutSec: number // REQ: DEC-22 / DEC-53 — seconds (entered in minutes); OQ-04
  createdAt: string
  createdBy: string // fullName, or SYSTEM
  // REQ: DEC-54 — Project Settings › General (blank = the merchant default) and › Integration.
  branding: { primaryColor?: string; logoUrl?: string }
  language?: 'en' | 'ms'
  redirectUrls: string[]
  allowedOrigins: string[]
  ipAllowlist: string[] // IPv4 or CIDR
  decisionReasons: ProjectDecisionReasons // REQ: DEC-106 — Project Settings › Review operations
}

/** REQ: DEC-54 — an API key of one project. The secret is shown once, when created or rotated; only a hint is kept. */
export interface ProjectApiKey {
  keyId: string // key_… — shown masked (key_…a91f); the secret is separate and never stored (DEC-97)
  projectId: string
  name: string
  secretHint: string // e.g. "sk_mock_…3f9a"
  status: 'ACTIVE' | 'REVOKED'
  createdAt: string
  createdBy: string
  lastUsedAt?: string
  revokedAt?: string
}

/** REQ: DEC-54 / DEC-55 — the project's webhook. Deliveries are simulated in the mock (MOCK-11). */
export interface ProjectWebhook {
  webhookId: string // whk_…
  projectId: string
  url: string
  events: 'verification.status_changed'[]
  secretHint: string
  updatedAt: string
  updatedBy: string
}

/**
 * REQ: DEC-55 — the body of a `verification.status_changed` delivery. One webhook serves every flow of the project, so it
 * names the case and the flow. IDs only: no personal data, no flow name (names change; IDs don't).
 */
export interface WebhookEvent {
  event: 'verification.status_changed'
  verificationId: string // vrf_…
  flowId: string // flw_… — the flow the session ran on
  referenceId: string // the merchant's own Reference ID, as they sent it
  status: Exclude<VerificationStatus, 'PROCESSING'>
  lastUpdatedBy: { kind: 'SYSTEM' } | { kind: 'USER'; fullName: string } // no user ID (DEC-97)
  occurredAt: string // ISO time of the status change
}

// REQ: DEC-94
export const FLOW_STATUSES = ['DRAFT', 'ACTIVE', 'RETIRING', 'INACTIVE'] as const
export type FlowStatus = (typeof FLOW_STATUSES)[number]

// REQ: DEC-19 — a preset, or custom values set by Super admin.
export const THRESHOLD_PRESETS_ORDER = ['LOW', 'STANDARD', 'HIGH'] as const
export type ThresholdPreset = (typeof THRESHOLD_PRESETS_ORDER)[number]
export type ThresholdChoice = { preset: ThresholdPreset } | { preset: 'ADVANCED'; autoReject: number; autoPass: number }

export interface CheckSettings {
  threshold: ThresholdChoice
}

export interface FlowSettings {
  checks: Record<Check, CheckSettings>
  retries: Record<RetryPhase, number> // REQ: DEC-108 — retries after the first submission, per phase (Selfie: V1 only)
  cooldownMin: number // REQ: DEC-26 — Cooldown after Rejected (min)
  unsuccessfulCooldownMin: number // REQ: DEC-26 / DEC-112 — Cooldown after Unsuccessful (min), whichever phase failed
  acceptedDocuments: DocumentType[]
  sessionExpiryMin: number
  risk?: RiskConfig // V4 / V5 (DEC-107)
}

export interface Flow {
  flowId: string // flw_… (DEC-97)
  projectId: string
  merchantId: string
  name: string
  description: string // who this flow is for
  workflowVersion: WorkflowCode // locked once the flow has been active (DEC-94)
  status: FlowStatus
  settings: FlowSettings
  revision: number // REQ: DEC-51 — 0 until first activated; shown as `${workflowVersion}-R${revision}`
  createdAt: string
  updatedAt: string
  updatedBy: ClaimHolder | { userId: 'SYSTEM'; fullName: 'SYSTEM' }
}

// REQ: DEC-102 / DEC-104 — permissions, one per module action (src/domain/permissionMatrix.ts lays them out as on the
// Roles screen). Merchant-wide ones only count from the user's merchant role (given on Users), never from a project role.
export const MERCHANT_PERMISSIONS = [
  'CREATE_PROJECTS',
  'RENAME_PROJECTS',
  'ARCHIVE_PROJECTS',
  'VIEW_USERS',
  'INVITE_USERS', // and resend the invitation
  'CHANGE_USER_ROLE', // the user's merchant role (DEC-104)
  'SUSPEND_USERS', // suspend and reactivate
  'VIEW_ROLES',
  'CREATE_ROLES', // and duplicate
  'EDIT_ROLES',
  'CHANGE_ROLE_STATUS', // activate and deactivate
  'VIEW_BILLING',
  'MANAGE_BILLING',
  'VIEW_MERCHANT_REPORTS',
  'EXPORT_MERCHANT_REPORTS',
] as const
export const PROJECT_PERMISSIONS = [
  // REQ: DEC-104 — no masking: each step needs the one before.
  'VIEW_CASE_LIST', // the list: no personal data (DEC-40)
  'VIEW_CASE_DETAILS', // the case page: name, ID number, images (every open audited, DEC-41)
  'CLAIM_CASES', // claim and release
  'DECIDE_CASES', // approve / reject
  'VIEW_FLOWS',
  'CREATE_FLOWS', // and duplicate
  'EDIT_FLOWS',
  'ACTIVATE_FLOWS', // activate, retire
  'CHANGE_VERIFICATION_LEVEL', // thresholds, retries allowed, risk level
  'VIEW_PROJECT_SETTINGS',
  'MANAGE_PROJECT_SETTINGS',
  'VIEW_INTEGRATION',
  'MANAGE_INTEGRATION', // API keys and webhook
  'VIEW_MEMBERS',
  'MANAGE_MEMBERS',
  // REQ: DEC-104 — the project's own role table (its Roles screen).
  'VIEW_PROJECT_ROLES',
  'CREATE_PROJECT_ROLES', // and duplicate, also from another project
  'EDIT_PROJECT_ROLES',
  'CHANGE_PROJECT_ROLE_STATUS', // activate, deactivate
  'VIEW_PROJECT_REPORTS',
  'EXPORT_PROJECT_REPORTS',
  'VIEW_AUDIT_LOG',
] as const
export type MerchantPermission = (typeof MERCHANT_PERMISSIONS)[number]
export type ProjectPermission = (typeof PROJECT_PERMISSIONS)[number]
// REQ: DEC-99 / DEC-104 — platform (internal staff) permissions: platform-wide, and merchant data (in every merchant).
export const PLATFORM_LEVEL_PERMISSIONS = [
  'P_MERCHANTS_VIEW',
  'P_MERCHANTS_CREATE',
  'P_MERCHANTS_SUSPEND',
  'P_REGISTRY_VIEW',
  'P_REGISTRY_MANAGE',
  'P_LEVELS_VIEW',
  'P_LEVELS_CALIBRATE',
  'P_BILLING_VIEW',
  'P_BILLING_MANAGE',
  'P_REPORTS_VIEW',
  'P_REPORTS_EXPORT',
] as const
// REQ: DEC-104 — every merchant module, in every merchant (same order as the merchant role table).
export const MERCHANT_DATA_PERMISSIONS = [
  'P_PROJECTS_CREATE',
  'P_PROJECTS_RENAME',
  'P_PROJECTS_ARCHIVE',
  'P_USERS_VIEW',
  'P_USERS_INVITE',
  'P_USERS_CHANGE_ROLE',
  'P_USERS_SUSPEND',
  'P_ROLES_VIEW',
  'P_ROLES_CREATE',
  'P_ROLES_EDIT',
  'P_ROLES_STATUS',
  'P_CASES_LIST',
  'P_CASES_DETAILS',
  'P_CASES_CLAIM',
  'P_CASES_DECIDE',
  'P_FLOWS_VIEW',
  'P_FLOWS_CREATE',
  'P_FLOWS_EDIT',
  'P_FLOWS_ACTIVATE',
  'P_FLOWS_LEVEL',
  'P_SETTINGS_VIEW',
  'P_SETTINGS_EDIT',
  'P_INTEGRATION_VIEW',
  'P_INTEGRATION_MANAGE',
  'P_MEMBERS_VIEW',
  'P_MEMBERS_MANAGE',
  'P_PROJECT_ROLES_VIEW',
  'P_PROJECT_ROLES_CREATE',
  'P_PROJECT_ROLES_EDIT',
  'P_PROJECT_ROLES_STATUS',
  'P_AUDIT_VIEW',
] as const
export type PlatformPermission = (typeof PLATFORM_LEVEL_PERMISSIONS)[number] | (typeof MERCHANT_DATA_PERMISSIONS)[number]

export type Permission = MerchantPermission | ProjectPermission | PlatformPermission
/** What a Merchant role may hold (DEC-70). */
export const MERCHANT_ROLE_PERMISSIONS: readonly Permission[] = [...MERCHANT_PERMISSIONS, ...PROJECT_PERMISSIONS]
/** What a Platform role may hold (DEC-99). */
export const PLATFORM_ROLE_PERMISSIONS: readonly Permission[] = [...PLATFORM_LEVEL_PERMISSIONS, ...MERCHANT_DATA_PERMISSIONS]
export const PERMISSIONS: readonly Permission[] = [...MERCHANT_ROLE_PERMISSIONS, ...PLATFORM_ROLE_PERMISSIONS]

// REQ: DEC-76
export type RoleType = 'SYSTEM_DEFAULT' | 'CUSTOM'
export type RoleStatus = 'ACTIVE' | 'INACTIVE'
/** REQ: DEC-99 — the form's "Type": a role for platform staff or for a merchant's users. Never changes. */
export type RoleAudience = 'PLATFORM' | 'MERCHANT'
/**
 * REQ: DEC-104 — which role table a merchant's role is in: a **merchant role** (Roles screen, given on Users, applies to
 * the whole merchant) or a **project role** (the project's Roles screen, given in Project › Members, that project only).
 */
export type RoleLevel = 'MERCHANT' | 'PROJECT'

/** What a user may do. System Default roles are shared by every merchant (no merchantId) and locked. */
export interface Role {
  roleId: string // rol_… (DEC-97)
  audience: RoleAudience // REQ: DEC-99
  /** REQ: DEC-104 — merchant roles and project roles are two tables; absent for platform roles. */
  level?: RoleLevel
  merchantId?: string // Custom merchant and project roles only; absent for System Default and Platform roles
  /** REQ: DEC-104 — a Custom project role belongs to one project; System Default project roles are in every project. */
  projectId?: string
  name: string
  type: RoleType
  permissions: Permission[]
  status: RoleStatus
  createdAt: string
  createdBy: Actor
  updatedAt: string
  updatedBy: Actor
}

/**
 * REQ: DEC-104 — where a role applies. A merchant user's **merchant role** (Users): `ALL_PROJECTS`, exactly one. Their
 * **project roles** (Project › Members): `PROJECTS` with one project each. A platform staff member's role:
 * `ALL_MERCHANTS` (no scope to choose), exactly one.
 */
export type AssignmentScope = { kind: 'ALL_PROJECTS' } | { kind: 'PROJECTS'; projectIds: string[] } | { kind: 'ALL_MERCHANTS' }

/** One role given to one user with a scope (DEC-74: Role | Scope | Added by | Date). */
export interface RoleAssignment {
  assignmentId: string
  roleId: string
  scope: AssignmentScope
  addedBy: Actor
  addedAt: string
}

/** Super admin is internal and works in every merchant; everyone else belongs to one merchant (DEC-70). */
export type AccessLevel = 'SUPER_ADMIN' | 'PLATFORM_STAFF' | 'MERCHANT_USER' // REQ: DEC-99

/** An assignment joined with its role: what the access checks work from. */
export interface Grant {
  roleId: string
  roleName: string
  permissions: readonly Permission[]
  scope: AssignmentScope
}

/** What a user may reach: their level, their merchant and their grants (DEC-70). */
export interface UserAccess {
  userId: string
  level: AccessLevel
  merchantId?: string // required unless SUPER_ADMIN
  grants: readonly Grant[] // empty for Super admin: its rights are fixed (roles.SUPER_ADMIN_PERMISSIONS)
}

// REQ: DEC-56 / DEC-58
// REQ: DEC-56 — who can choose a version for a new flow: nobody (Draft, Deprecated), internal users (Internal testing),
// internal users + listed merchants (Limited release), everyone (Active).
export const REGISTRY_STATUSES = ['DRAFT', 'INTERNAL_TESTING', 'LIMITED_RELEASE', 'ACTIVE', 'DEPRECATED'] as const
export type RegistryStatus = (typeof REGISTRY_STATUSES)[number]
export const ONBOARDING_PHASES = ['ID_CAPTURE', 'SELFIE_CAPTURE', 'LIVENESS_CHECK', 'RISK_ASSESSMENT'] as const
export type OnboardingPhase = (typeof ONBOARDING_PHASES)[number]
export type FaceMatchMethod = 'ID_VS_SELFIE' | 'ID_VS_LIVENESS'

export interface RegistryEntry {
  entryId: string // wfv_… — the internal key; people use the code (V1 … V5) (DEC-97)
  code: WorkflowCode
  name: string
  // REQ: DEC-115 — the workflow JSON pasted from the backend, as stored (pretty-printed). The workflow decides what runs;
  // the four fields below are only what the portal read from it at save (registryRules.readDefinition).
  definition: string
  phases: OnboardingPhase[] // `steps`, in order; ID_CAPTURE first
  faceMatchMethod: FaceMatchMethod // follows from the steps (SELFIE → ID vs selfie); labels the case page only
  configurableChecks: Check[] // `tunable` thresholds
  riskMinimumsPerFlow: boolean // REQ: DEC-107 — `tunable` has RISK_MINIMUMS: the flow sets them (V5); otherwise fixed (V4)
  accessMerchantIds: string[] // REQ: DEC-56 — Limited release: the merchants that may choose it (internal users always may)
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
  revisionId: string // rev_…; shown as V4-R2
  flowId: string
  revision: number // 1, 2, …
  savedAt: string
  savedBy: ClaimHolder | { userId: 'SYSTEM'; fullName: 'SYSTEM' }
  reason: string // "Reason for change"; the first revision records the activation
  settings: FlowSettings
  changes: SettingChange[]
}

// REQ: DEC-74 — [FRS] Pending until the invitation is accepted; Suspended instead of deleted.
export const USER_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED'] as const
export type UserStatus = (typeof USER_STATUSES)[number]

/** A portal account: level, merchant and its role assignments (DEC-70, DEC-74). */
export interface UserAccount {
  userId: string
  level: AccessLevel
  merchantId?: string // required unless SUPER_ADMIN
  assignments: RoleAssignment[] // empty for Super admin
  /** REQ: DEC-74 / DEC-97 — the open invitation while Pending; a resend replaces it. */
  invitationId?: string // inv_…
  fullName: string
  email: string
  status: UserStatus
  invitedAt: string
  lastActiveAt?: string
}

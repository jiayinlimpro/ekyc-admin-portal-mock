import type { Permission } from '@/domain/permissions'
import type { AttemptOutcome, AuditAction, DocumentType, RiskLevel, RoleType, VerificationStatus } from '@/domain/types'

// OQ-09: role display names still to be confirmed against the FRS.
export const ROLE_LABELS: Record<RoleType, string> = {
  PLATFORM_ADMIN: 'Platform Admin',
  MERCHANT_REVIEWER: 'Merchant Reviewer',
}

export const STATUS_LABELS: Record<VerificationStatus, string> = {
  PROCESSING: 'Processing',
  PENDING_REVIEW: 'Pending Review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
}

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  MYKAD: 'MyKad',
  PASSPORT: 'Passport',
}

export const RISK_LABELS: Record<RiskLevel, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
}

export const OUTCOME_LABELS: Record<AttemptOutcome, string> = {
  COMPLETED: 'Completed',
  ABORTED: 'Aborted',
  TIMED_OUT: 'Timed out',
  FAILED_RETAKE: 'Failed – retake',
}

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  PII_VIEW: 'PII viewed',
  CLAIM: 'Claimed',
  CLAIM_RELEASE: 'Claim cancelled',
  CLAIM_TIMEOUT: 'Claim timed out',
  DECISION: 'Decision saved',
  OWNERSHIP_CONFLICT: 'Ownership conflict',
  CONFIG_DRAFT_SAVE: 'Config draft saved',
  CONFIG_DISCARD: 'Config draft discarded',
  CONFIG_DEPLOY: 'Config deployed',
  CREDENTIAL_ROTATION: 'API key rotated',
}

export const PERMISSION_LABELS: Record<Permission, { label: string; description: string }> = {
  canViewAllMerchants: { label: 'All merchants', description: 'See every merchant (merchant selector). Otherwise own merchant only.' },
  canReview: { label: 'Review', description: 'Claim verifications and save decisions.' },
  canViewPII: { label: 'View PII', description: 'Open the detail page with unmasked personal data (each view is audited).' },
  canConfigureWorkflow: { label: 'Configure workflow', description: 'Edit, save and deploy the per-phase eKYC Workflow.' },
  canManageUAM: { label: 'Manage users', description: 'Merchants, roles and users.' },
  canRotateKeys: { label: 'API keys', description: 'Reveal and rotate merchant API credentials.' },
  canViewAudit: { label: 'Audit logs', description: 'Read the audit trail (scoped to own merchant for reviewers).' },
  canViewBilling: { label: 'Billing', description: 'Billing reports and exports.' },
}

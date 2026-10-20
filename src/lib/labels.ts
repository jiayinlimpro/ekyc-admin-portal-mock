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

// REQ: DEC-42
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  SENSITIVE_PII_VIEW: 'Personal data viewed',
  CASE_CLAIMED: 'Case claimed',
  CASE_RELEASED: 'Claim released',
  CASE_CLAIM_EXPIRED: 'Claim expired',
  CASE_DECISION_APPROVED: 'Case approved',
  CASE_DECISION_REJECTED: 'Case rejected',
  CASE_DECISION_BLOCKED: 'Decision blocked',
  FLOW_CREATED: 'Flow created',
  FLOW_ACTIVATED: 'Flow activated',
  FLOW_RETIRED: 'Flow retired',
  FLOW_DEFAULT_CHANGED: 'Default flow changed',
  FLOW_SETTING_CHANGED: 'Flow settings changed',
  PROJECT_CREATED: 'Project created',
  PROJECT_RENAMED: 'Project renamed',
  PROJECT_ARCHIVED: 'Project archived',
  PROJECT_SETTING_CHANGED: 'Project settings changed',
  API_KEY_CREATED: 'API key created',
  API_KEY_ROTATED: 'API key rotated',
  API_KEY_REVOKED: 'API key revoked',
  WEBHOOK_CHANGED: 'Webhook changed',
  USER_INVITED: 'User invited',
  USER_ROLE_CHANGED: 'User role changed',
  USER_REMOVED: 'User removed from project',
  USER_DEACTIVATED: 'User deactivated',
  WORKFLOW_REGISTERED: 'Workflow registered',
  WORKFLOW_UPDATED: 'Workflow updated',
  WORKFLOW_STATUS_CHANGED: 'Workflow status changed',
  WORKFLOW_DEFAULT_CHANGED: 'Default workflow changed',
  MERCHANT_CREATED: 'Merchant created',
  MERCHANT_UPDATED: 'Merchant updated',
  MERCHANT_STATUS_CHANGED: 'Merchant status changed',
  CONFIG_DRAFT_SAVE: 'Config draft saved (legacy)',
  CONFIG_DISCARD: 'Config draft discarded (legacy)',
  CONFIG_DEPLOY: 'Config deployed (legacy)',
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

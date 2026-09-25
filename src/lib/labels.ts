import type { AttemptOutcome, DocumentType, RiskLevel, RoleType, VerificationStatus } from '@/domain/types'

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

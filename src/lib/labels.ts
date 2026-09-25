import type { RoleType, VerificationStatus } from '@/domain/types'

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

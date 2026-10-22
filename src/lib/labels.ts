import type { AttemptOutcome, AuditAction, DocumentType, FlowStatus, MerchantStatus, Permission, RiskLevel, UserStatus, VerificationStatus } from '@/domain/types'

export const FLOW_STATUS_LABELS: Record<FlowStatus, string> = { DRAFT: 'Draft', ACTIVE: 'Active', RETIRING: 'Retiring', INACTIVE: 'Inactive' }

// REQ: DEC-70 — permission names on the Roles screen (the list is OQ-09).
export const PERMISSION_LABELS: Record<Permission, string> = {
  MANAGE_BILLING: 'Manage billing and contract',
  MANAGE_USERS_ROLES: 'Manage users and roles',
  MANAGE_PROJECTS: 'Create, rename, archive projects',
  VIEW_MERCHANT_REPORTS: 'View merchant-wide reports',
  VIEW_CASES: 'View cases',
  CLAIM_CASES: 'Claim cases',
  DECIDE_CASES: 'Approve / reject cases',
  MANAGE_PROJECT_SETTINGS: 'Manage project settings',
  MANAGE_INTEGRATION: 'Manage API keys and webhook',
  MANAGE_FLOWS: 'Manage flows',
  CHANGE_VERIFICATION_LEVEL: 'Change verification level and retries',
  MANAGE_MEMBERS: 'Manage project members',
  VIEW_PROJECT_REPORTS: 'View project reports',
  VIEW_AUDIT_LOG: 'View audit log',
  // REQ: DEC-99 — platform permissions, written "Module · action".
  P_MERCHANTS_VIEW: 'Merchants · View',
  P_MERCHANTS_CREATE: 'Merchants · Create',
  P_MERCHANTS_SUSPEND: 'Merchants · Suspend',
  P_REGISTRY_VIEW: 'Workflow Registry · View',
  P_REGISTRY_MANAGE: 'Workflow Registry · Manage',
  P_LEVELS_VIEW: 'Verification levels · View',
  P_LEVELS_CALIBRATE: 'Verification levels · Calibrate',
  P_BILLING_VIEW: 'Platform billing · View',
  P_BILLING_MANAGE: 'Platform billing · Manage',
  P_REPORTS_VIEW: 'Usage reports · View',
  P_REPORTS_EXPORT: 'Usage reports · Export',
  P_CASES_VIEW_MASKED: 'Verifications · View (masked)',
  P_CASES_VIEW_UNMASKED: 'Verifications · See unmasked ID data',
  P_CASES_DECIDE: 'Verifications · Claim / approve / reject',
  P_FLOWS_VIEW: 'Flows · View',
  P_FLOWS_EDIT: 'Flows · Edit',
  P_INTEGRATION_VIEW: 'API keys and webhook · View',
  P_INTEGRATION_MANAGE: 'API keys and webhook · Manage',
  P_AUDIT_VIEW: 'Audit log · View',
}

/** REQ: DEC-99 — the Roles form shows platform permissions grouped by module, with short action names. */
export const PLATFORM_PERMISSION_GROUPS: { title: string; hint: string; modules: { module: string; actions: [Permission, string][] }[] }[] = [
  {
    title: 'Platform-level',
    hint: 'Apply across the platform.',
    modules: [
      { module: 'Merchants', actions: [['P_MERCHANTS_VIEW', 'View'], ['P_MERCHANTS_CREATE', 'Create'], ['P_MERCHANTS_SUSPEND', 'Suspend']] },
      { module: 'Workflow Registry', actions: [['P_REGISTRY_VIEW', 'View'], ['P_REGISTRY_MANAGE', 'Manage']] },
      { module: 'Verification levels', actions: [['P_LEVELS_VIEW', 'View'], ['P_LEVELS_CALIBRATE', 'Calibrate']] },
      { module: 'Platform billing', actions: [['P_BILLING_VIEW', 'View'], ['P_BILLING_MANAGE', 'Manage']] },
      { module: 'Usage reports', actions: [['P_REPORTS_VIEW', 'View'], ['P_REPORTS_EXPORT', 'Export']] },
    ],
  },
  {
    title: 'Merchant access',
    hint: 'Apply in the merchants the user is given.',
    modules: [
      { module: 'Verifications', actions: [['P_CASES_VIEW_MASKED', 'View (masked)'], ['P_CASES_VIEW_UNMASKED', 'See unmasked ID data'], ['P_CASES_DECIDE', 'Claim / approve / reject']] },
      { module: 'Flows', actions: [['P_FLOWS_VIEW', 'View'], ['P_FLOWS_EDIT', 'Edit']] },
      { module: 'API keys and webhook', actions: [['P_INTEGRATION_VIEW', 'View'], ['P_INTEGRATION_MANAGE', 'Manage']] },
      { module: 'Audit log', actions: [['P_AUDIT_VIEW', 'View']] },
    ],
  },
]

/** REQ: DEC-99 — account types. */
export const ACCOUNT_TYPE_LABELS = { SUPER_ADMIN: 'Super admin', PLATFORM_STAFF: 'Platform (internal)', MERCHANT_USER: 'Merchant' } as const

export const permissionList = (ps: readonly Permission[]) => ps.map((p) => PERMISSION_LABELS[p]).join(', ') || 'None'

// REQ: DEC-74 — [FRS] user statuses.
export const USER_STATUS_LABELS: Record<UserStatus, string> = { PENDING: 'Pending', ACTIVE: 'Active', SUSPENDED: 'Suspended' }

// REQ: DEC-98 — [FRS] merchant statuses.
export const MERCHANT_STATUS_LABELS: Record<MerchantStatus, string> = { ONBOARDING: 'Onboarding', ACTIVE: 'Active', SUSPENDED: 'Suspended', TERMINATED: 'Terminated' }

export const STATUS_LABELS: Record<VerificationStatus, string> = {
  PROCESSING: 'Processing',
  PENDING_REVIEW: 'Pending Review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
}

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  MYKAD: 'MyKad',
  PASSPORT: 'Passport',
  DRIVING_LICENSE: 'Driving License',
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
  USER_INVITATION_RESENT: 'Invitation resent',
  USER_ACCESS_ADDED: 'Access added',
  USER_ACCESS_CHANGED: 'Access changed',
  USER_ACCESS_REMOVED: 'Access removed',
  USER_SUSPENDED: 'User suspended',
  USER_REACTIVATED: 'User reactivated',
  ROLE_CREATED: 'Role created',
  ROLE_UPDATED: 'Role updated',
  ROLE_STATUS_CHANGED: 'Role status changed',
  WORKFLOW_REGISTERED: 'Workflow registered',
  WORKFLOW_UPDATED: 'Workflow updated',
  WORKFLOW_STATUS_CHANGED: 'Workflow status changed',
  WORKFLOW_DEFAULT_CHANGED: 'Default workflow changed',
  MERCHANT_CREATED: 'Merchant created',
  MERCHANT_UPDATED: 'Merchant updated',
  MERCHANT_STATUS_CHANGED: 'Merchant status changed',
}


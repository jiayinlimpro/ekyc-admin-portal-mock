// REQ: DEC-70 / DEC-71 — UI-only checks. The real backend must enforce these. Role names and flags are OQ-09.
import { POLICY, type Policy } from './openQuestions'
import type { Actor, RoleType } from './types'

export const PERMISSIONS = [
  'canViewAllMerchants',
  'canReview', // claim + decide
  'canViewPII',
  'canConfigureWorkflow', // edit draft + deploy
  'canManageUAM',
  'canRotateKeys',
  'canViewAudit',
  'canViewBilling',
] as const
export type Permission = (typeof PERMISSIONS)[number]

const ROLE_PERMISSIONS: Record<RoleType, readonly Permission[]> = {
  PLATFORM_ADMIN: [
    'canViewAllMerchants',
    'canReview', // removed below when POLICY.adminCanReview is false (OQ-08)
    'canViewPII',
    'canConfigureWorkflow',
    'canManageUAM',
    'canRotateKeys',
    'canViewAudit',
    'canViewBilling',
  ],
  MERCHANT_REVIEWER: ['canReview', 'canViewPII', 'canViewAudit'],
}

export function can(actor: Pick<Actor, 'role'>, flag: Permission, policy: Pick<Policy, 'adminCanReview'> = POLICY): boolean {
  if (flag === 'canReview' && actor.role === 'PLATFORM_ADMIN' && !policy.adminCanReview) return false
  return ROLE_PERMISSIONS[actor.role].includes(flag)
}

/** Reviewers only see and act on their own merchant; admins see all. */
export function canAccessMerchant(actor: Pick<Actor, 'role' | 'merchantId'>, merchantId: string): boolean {
  return can(actor, 'canViewAllMerchants') || actor.merchantId === merchantId
}

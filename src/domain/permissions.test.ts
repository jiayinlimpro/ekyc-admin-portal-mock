import { describe, expect, it } from 'vitest'
import { ADMIN, ALI } from '@/test/factories'
import { can, canAccessMerchant } from './permissions'

describe('permissions (DEC-70)', () => {
  it('Given a Merchant Reviewer, then they can review and view PII but not configure, manage UAM or rotate keys', () => {
    expect(can(ALI, 'canReview')).toBe(true)
    expect(can(ALI, 'canViewPII')).toBe(true)
    expect(can(ALI, 'canConfigureWorkflow')).toBe(false)
    expect(can(ALI, 'canManageUAM')).toBe(false)
    expect(can(ALI, 'canRotateKeys')).toBe(false)
  })

  it('Given a Platform Admin, then they can configure and see all merchants', () => {
    expect(can(ADMIN, 'canConfigureWorkflow')).toBe(true)
    expect(can(ADMIN, 'canViewAllMerchants')).toBe(true)
  })

  it('Given adminCanReview = false (OQ-08), then the admin cannot review', () => {
    expect(can(ADMIN, 'canReview', { adminCanReview: false })).toBe(false)
    expect(can(ALI, 'canReview', { adminCanReview: false })).toBe(true)
  })

  it('Given a reviewer, then they only access their own merchant', () => {
    expect(canAccessMerchant(ALI, 'MER-0001')).toBe(true)
    expect(canAccessMerchant(ALI, 'MER-0002')).toBe(false)
    expect(canAccessMerchant(ADMIN, 'MER-0002')).toBe(true)
  })
})

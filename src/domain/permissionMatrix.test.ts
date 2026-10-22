import { describe, expect, it } from 'vitest'
import { MERCHANT_PERMISSIONS, MERCHANT_ROLE_PERMISSIONS, PLATFORM_ROLE_PERMISSIONS, PROJECT_PERMISSIONS } from './types'
import { groupsFor, modulePermissions, PERMISSION_MATRIX } from './permissionMatrix'
import { SYSTEM_DEFAULT_ROLES, withImpliedPermissions } from './roles'

const inGroup = (key: string) => PERMISSION_MATRIX.find((g) => g.key === key)!.modules.flatMap(modulePermissions)

describe('permission matrix (DEC-102)', () => {
  it('Given each role Type, then its matrix holds every permission of that Type exactly once', () => {
    const merchant = groupsFor('MERCHANT').flatMap((g) => g.modules.flatMap(modulePermissions))
    const platform = groupsFor('PLATFORM').flatMap((g) => g.modules.flatMap(modulePermissions))
    expect([...merchant].sort()).toEqual([...MERCHANT_ROLE_PERMISSIONS].sort())
    expect([...platform].sort()).toEqual([...PLATFORM_ROLE_PERMISSIONS].sort())
    expect(new Set(merchant).size).toBe(merchant.length)
  })

  it('Given the merchant groups, then merchant-level and project-level match the permission lists', () => {
    expect(inGroup('MERCHANT_LEVEL').sort()).toEqual([...MERCHANT_PERMISSIONS].sort())
    expect(inGroup('PROJECT_LEVEL').sort()).toEqual([...PROJECT_PERMISSIONS].sort())
  })

  it('Given the merchant-level rows, then Projects has no View and the rest follow the product (Suspend, Deactivate: never delete)', () => {
    const rows = PERMISSION_MATRIX.find((g) => g.key === 'MERCHANT_LEVEL')!.modules.map((m) => [m.module, m.view ?? '—', m.actions.map((x) => x.label).join(', ')])
    expect(rows).toEqual([
      ['Projects', '—', 'Create, Rename, Archive'],
      ['Users', 'VIEW_USERS', 'Invite, Change access, Suspend'],
      ['Roles', 'VIEW_ROLES', 'Create, Edit, Deactivate'],
      ['Billing and contract', 'VIEW_BILLING', 'Manage'],
      ['Merchant reports', 'VIEW_MERCHANT_REPORTS', 'Export'],
    ])
  })

  it('Given an action is ticked, then its module View is ticked too; Change verification level also ticks Edit flows', () => {
    expect(withImpliedPermissions(['INVITE_USERS'])).toEqual(['VIEW_USERS', 'INVITE_USERS'])
    expect(withImpliedPermissions(['CHANGE_VERIFICATION_LEVEL'])).toEqual(['VIEW_FLOWS', 'EDIT_FLOWS', 'CHANGE_VERIFICATION_LEVEL'])
    expect(withImpliedPermissions(['P_CASES_DECIDE'])).toEqual(['P_CASES_VIEW_MASKED', 'P_CASES_VIEW_UNMASKED', 'P_CASES_DECIDE'])
    expect(withImpliedPermissions(['CREATE_PROJECTS'])).toEqual(['CREATE_PROJECTS']) // Projects has no View
  })

  it('Given the System Default roles, then each already holds the Views its actions need', () => {
    for (const r of SYSTEM_DEFAULT_ROLES) expect(withImpliedPermissions(r.permissions)).toEqual(r.permissions)
  })
})

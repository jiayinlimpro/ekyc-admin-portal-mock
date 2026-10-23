import { describe, expect, it } from 'vitest'
import { MERCHANT_PERMISSIONS, MERCHANT_ROLE_PERMISSIONS, PLATFORM_ROLE_PERMISSIONS, PROJECT_PERMISSIONS } from './types'
import { dependentsOf, groupsFor, modulePermissions, PERMISSION_MATRIX } from './permissionMatrix'
import { PLATFORM_DEFAULT_ROLES, SYSTEM_DEFAULT_ROLES, withImpliedPermissions } from './roles'

const group = (key: string) => PERMISSION_MATRIX.find((g) => g.key === key)!
const inGroup = (key: string) => group(key).modules.flatMap(modulePermissions)
const rows = (key: string) => group(key).modules.map((m) => [m.module, m.viewLabel ?? (m.view ? 'View' : '—'), m.actions.map((x) => x.label).join(', ') || '—'])

describe('permission matrix (DEC-102, DEC-104)', () => {
  it('Given each role Type, then its matrix holds every permission of that Type exactly once', () => {
    const merchant = groupsFor('MERCHANT').flatMap((g) => g.modules.flatMap(modulePermissions))
    const platform = groupsFor('PLATFORM').flatMap((g) => g.modules.flatMap(modulePermissions))
    expect([...merchant].sort()).toEqual([...MERCHANT_ROLE_PERMISSIONS].sort())
    expect([...platform].sort()).toEqual([...PLATFORM_ROLE_PERMISSIONS].sort())
    expect(new Set(merchant).size).toBe(merchant.length)
  })

  it('Given the groups, then Merchant-wide / Project-level for merchant roles and Platform-wide / Merchant data for platform roles', () => {
    expect(groupsFor('MERCHANT').map((g) => g.title)).toEqual(['Merchant-wide', 'Project-level'])
    expect(groupsFor('PLATFORM').map((g) => g.title)).toEqual(['Platform-wide', 'Merchant data'])
    expect(inGroup('MERCHANT_WIDE').sort()).toEqual([...MERCHANT_PERMISSIONS].sort())
    expect(inGroup('PROJECT_LEVEL').sort()).toEqual([...PROJECT_PERMISSIONS].sort())
  })

  it('Given the rows, then the real actions with "—" where none; Users and Roles are never deleted', () => {
    expect(rows('MERCHANT_WIDE')).toEqual([
      ['Projects', '—', 'Create, Rename, Archive'],
      ['Users', 'View', 'Invite, Change role, Suspend'],
      ['Roles', 'View', 'Create, Edit, Deactivate'],
      ['Billing and contract', 'View', 'Manage'],
      ['Merchant reports', 'View', 'Export'],
    ])
    expect(rows('PROJECT_LEVEL')[0]).toEqual(['Verifications', 'View list', 'View details, Claim / release, Approve / reject'])
    expect(rows('PROJECT_LEVEL').at(-1)).toEqual(['Audit log', 'View', '—'])
  })

  it('Given the same module in both Types, then the same wording (DEC-104)', () => {
    const merchant = new Map(group('PROJECT_LEVEL').modules.map((m) => [m.module, m.actions.map((x) => x.label)]))
    for (const m of group('MERCHANT_DATA').modules) expect(m.actions.map((x) => x.label), m.module).toEqual(merchant.get(m.module))
  })

  it('Given Verifications, then each step needs the one before: Approve → Claim → View details → View list', () => {
    expect(withImpliedPermissions(['DECIDE_CASES'])).toEqual(['VIEW_CASE_LIST', 'VIEW_CASE_DETAILS', 'CLAIM_CASES', 'DECIDE_CASES'])
    expect(withImpliedPermissions(['P_CASES_DECIDE'])).toEqual(['P_CASES_LIST', 'P_CASES_DETAILS', 'P_CASES_CLAIM', 'P_CASES_DECIDE'])
    expect(withImpliedPermissions(['INVITE_USERS'])).toEqual(['VIEW_USERS', 'INVITE_USERS'])
    expect(withImpliedPermissions(['CHANGE_VERIFICATION_LEVEL'])).toEqual(['VIEW_FLOWS', 'EDIT_FLOWS', 'CHANGE_VERIFICATION_LEVEL'])
    expect(withImpliedPermissions(['CREATE_PROJECTS'])).toEqual(['CREATE_PROJECTS']) // Projects has no View
  })

  it('Given a permission is unticked, then everything that needs it goes too', () => {
    expect([...dependentsOf('VIEW_CASE_LIST')].sort()).toEqual(['CLAIM_CASES', 'DECIDE_CASES', 'VIEW_CASE_DETAILS'])
    expect([...dependentsOf('VIEW_CASE_DETAILS')].sort()).toEqual(['CLAIM_CASES', 'DECIDE_CASES'])
    expect([...dependentsOf('EDIT_FLOWS')]).toEqual(['CHANGE_VERIFICATION_LEVEL'])
    expect(dependentsOf('DECIDE_CASES').size).toBe(0)
  })

  it('Given the System Default roles, then each already holds what its permissions need', () => {
    for (const r of [...SYSTEM_DEFAULT_ROLES, ...PLATFORM_DEFAULT_ROLES]) expect(withImpliedPermissions(r.permissions), r.name).toEqual(r.permissions)
  })
})

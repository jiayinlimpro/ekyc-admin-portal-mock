import { describe, expect, it } from 'vitest'
import { MERCHANT_ROLE_PERMISSIONS, PLATFORM_ROLE_PERMISSIONS } from './types'
import { dependentsOf, modulePermissions, modulesFor } from './permissionMatrix'
import { PLATFORM_DEFAULT_ROLES, SYSTEM_DEFAULT_ROLES, withImpliedPermissions } from './roles'

const rows = (audience: 'MERCHANT' | 'PLATFORM', level: 'MERCHANT' | 'PROJECT' = 'MERCHANT') => modulesFor(audience, level).map((m) => [m.module, m.viewLabel ?? (m.view ? 'View' : '—'), m.actions.map((x) => x.label).join(', ') || '—'])

describe('permission matrix (DEC-102, DEC-104)', () => {
  it('Given each role Type, then one list of modules holding every permission of that Type exactly once (no sections)', () => {
    const merchant = modulesFor('MERCHANT').flatMap(modulePermissions)
    const platform = modulesFor('PLATFORM').flatMap(modulePermissions)
    expect([...merchant].sort()).toEqual([...MERCHANT_ROLE_PERMISSIONS].sort())
    expect([...platform].sort()).toEqual([...PLATFORM_ROLE_PERMISSIONS].sort())
    expect(new Set(merchant).size).toBe(merchant.length)
  })

  it('Given a Merchant role, then these rows with "—" where none; users and roles are never deleted', () => {
    expect(rows('MERCHANT')).toEqual([
      ['Projects', '—', 'Create, Rename, Archive'],
      ['Users', 'View', 'Invite, Change role, Suspend'],
      ['Roles', 'View', 'Create, Edit, Deactivate'],
      ['Billing and contract', 'View', 'Manage'],
      ['Merchant reports', 'View', 'Export'],
      ['Verifications', 'View list', 'View details, Claim / release, Approve / reject'],
      ['Flows', 'View', 'Create, Edit, Activate / retire, Change verification level'],
      ['Project settings', 'View', 'Edit'],
      ['API keys and webhook', 'View', 'Manage'],
      ['Members', 'View', 'Add / remove'],
      ['Project roles', 'View', 'Create, Edit, Deactivate'],
      ['Project reports', 'View', 'Export'],
      ['Audit log', 'View', '—'],
    ])
  })

  it('Given a project role, then the project modules only (DEC-104)', () => {
    expect(rows('MERCHANT', 'PROJECT').map((r) => r[0])).toEqual(['Verifications', 'Flows', 'Project settings', 'API keys and webhook', 'Members', 'Project roles', 'Project reports', 'Audit log'])
  })

  it('Given a Platform role, then platform modules and the merchant data modules, with the same wording as merchant roles', () => {
    expect(rows('PLATFORM').map((r) => r[0])).toEqual(['Merchants', 'Workflow Registry', 'Verification levels', 'Platform billing', 'Usage reports', 'Verifications', 'Flows', 'API keys and webhook', 'Audit log'])
    const merchant = new Map(rows('MERCHANT').map((r) => [r[0], r.slice(1)]))
    for (const m of ['Verifications', 'Flows', 'API keys and webhook', 'Audit log']) expect(rows('PLATFORM').find((r) => r[0] === m)!.slice(1), m).toEqual(merchant.get(m))
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

import { describe, expect, it } from 'vitest'
import {
  coversMerchant,
  hasMerchantAccess,
  scopeLabel,
  WRONG_ROLE_TYPE,
  accessChips,
  accessSummary,
  canGrant,
  coversProject,
  effectivePermissions,
  grantsOf,
  holdersOf,
  lastOwnerError,
  MERCHANT_LEVEL_SCOPE,
  permissionsIn,
  ROLE_IN_USE,
  ROLE_NEEDS_PERMISSION,
  roleNamesIn,
  SYSTEM_DEFAULT_ROLES,
  SYSTEM_ROLE_IDS,
  validateAssignment,
  validateRole,
  validateRoleStatus,
  withImpliedPermissions,
  type Grant,
} from './roles'
import type { AssignmentScope, Permission, Role, RoleAssignment } from './types'
import { fx } from '@/lib/ids'

const by = { userId: fx('USR-2026-0002'), fullName: 'Tan Mei Ling' }
const AT = '2026-10-01T00:00:00.000Z'
const ROLES: Role[] = SYSTEM_DEFAULT_ROLES.map((r) => ({ ...r, audience: 'MERCHANT' as const, type: 'SYSTEM_DEFAULT', status: 'ACTIVE', createdAt: AT, createdBy: by, updatedAt: AT, updatedBy: by }))
const role = (roleId: string) => ROLES.find((r) => r.roleId === roleId)!
const ALL: AssignmentScope = { kind: 'ALL_PROJECTS' }
const only = (...projectIds: string[]): AssignmentScope => ({ kind: 'PROJECTS', projectIds })
const assign = (roleId: string, scope: AssignmentScope, n = 1): RoleAssignment => ({ assignmentId: `ASG-${n}`, roleId, scope, addedBy: by, addedAt: AT })
const grant = (roleId: string, scope: AssignmentScope): Grant => ({ roleId, roleName: role(roleId).name, permissions: role(roleId).permissions, scope })

const { MERCHANT_OWNER, PROJECT_ADMIN, REVIEWER, VIEWER } = SYSTEM_ROLE_IDS
// The paste's example: Mei is Reviewer in Retail and Viewer in SME.
const MEI = [grant(REVIEWER, only(fx('PRJ-0001'))), grant(VIEWER, only(fx('PRJ-0002')))]

describe('roles: permissions from scoped assignments (DEC-70)', () => {
  it('Given a user with two assignments, then each project gets the union of the grants covering it', () => {
    expect(permissionsIn(MEI, fx('PRJ-0001')).has('CLAIM_CASES')).toBe(true)
    expect(permissionsIn(MEI, fx('PRJ-0002')).has('CLAIM_CASES')).toBe(false)
    expect(permissionsIn(MEI, fx('PRJ-0002')).has('VIEW_CASES')).toBe(true)
    expect(coversProject(MEI, fx('PRJ-0003'))).toBe(false)
    expect(roleNamesIn([...MEI, grant(VIEWER, only(fx('PRJ-0001')))], fx('PRJ-0001'))).toEqual(['Reviewer', 'Viewer'])
  })

  it('Given an All projects assignment, then it covers projects created later too', () => {
    expect(permissionsIn([grant(PROJECT_ADMIN, ALL)], fx('PRJ-0099')).has('MANAGE_FLOWS')).toBe(true)
  })

  it('Given a role with a merchant-level permission scoped to selected projects, then that permission does not count', () => {
    const odd: Grant = { roleId: fx('ROL-2026-0100'), roleName: 'Odd', permissions: ['MANAGE_PROJECTS', 'VIEW_CASES'], scope: only(fx('PRJ-0001')) }
    expect([...permissionsIn([odd], fx('PRJ-0001'))]).toEqual(['VIEW_CASES'])
  })

  it('Given overlapping grants, then Effective access names every grant each permission comes from', () => {
    const both = [grant(REVIEWER, only(fx('PRJ-0001'))), grant(VIEWER, ALL), grant(MERCHANT_OWNER, only(fx('PRJ-0001')))]
    const rows = effectivePermissions(both, fx('PRJ-0001'))
    expect(rows.find((r) => r.permission === 'VIEW_CASES')!.from.map((g) => g.roleName)).toEqual(['Reviewer', 'Viewer', 'Merchant Owner'])
    expect(rows.find((r) => r.permission === 'CLAIM_CASES')!.from.map((g) => g.roleName)).toEqual(['Reviewer', 'Merchant Owner'])
    expect(rows.some((r) => r.permission === 'MANAGE_PROJECTS')).toBe(false) // merchant-level, not from a project scope
    expect(effectivePermissions(both, fx('PRJ-0002')).map((r) => r.permission)).toEqual(['VIEW_CASES', 'VIEW_PROJECT_REPORTS'])
  })

  it('Given an inactive role, then its assignment grants nothing', () => {
    const roles = ROLES.map((r) => (r.roleId === VIEWER ? { ...r, status: 'INACTIVE' as const } : r))
    expect(grantsOf([assign(VIEWER, ALL), assign(REVIEWER, only(fx('PRJ-0001')), 2)], roles).map((g) => g.roleName)).toEqual(['Reviewer'])
  })

  it('Given grants, then each reads as one Role · Scope chip; an all-archived scope is marked archived', () => {
    const names: Record<string, string> = { [fx('PRJ-0001')]: 'Retail app', [fx('PRJ-0002')]: 'SME app (archived)' }
    expect(accessSummary(MEI, (id) => names[id])).toBe('Reviewer · Retail app; Viewer · SME app (archived)')
    expect(accessChips(MEI, (id) => names[id], (id) => id === fx('PRJ-0002')).map((c) => c.archived)).toEqual([false, true])
    expect(accessSummary([grant(MERCHANT_OWNER, ALL)], (id) => id)).toBe('Merchant Owner · All projects')
  })

  it('Given Claim or Approve ticked, then View cases is ticked too, in catalogue order', () => {
    expect(withImpliedPermissions(['DECIDE_CASES', 'VIEW_AUDIT_LOG'])).toEqual(['VIEW_CASES', 'DECIDE_CASES', 'VIEW_AUDIT_LOG'])
  })
})

describe('roles: giving access (DEC-70, DEC-74, DEC-77)', () => {
  const open = [fx('PRJ-0001'), fx('PRJ-0002')]

  it('Given a role with merchant-level permissions, when it is scoped to selected projects, then it is refused', () => {
    expect(validateAssignment(role(MERCHANT_OWNER), only(fx('PRJ-0001')), open)).toEqual([{ field: 'scope', message: MERCHANT_LEVEL_SCOPE }])
    expect(validateAssignment(role(MERCHANT_OWNER), ALL, open)).toEqual([])
  })

  it('Given selected projects, when none is chosen or one is archived, then it is refused', () => {
    expect(validateAssignment(role(REVIEWER), only(), open)[0].field).toBe('scope')
    expect(validateAssignment(role(REVIEWER), only(fx('PRJ-0008')), open)[0].message).toMatch(/Archived/)
    expect(validateAssignment(role(REVIEWER), only(fx('PRJ-0002')), open)).toEqual([])
  })

  it('Given a Project Admin of one project, then they can give Reviewer there but not elsewhere, nor All projects', () => {
    const hafiz = [grant(PROJECT_ADMIN, only(fx('PRJ-0002')))]
    const reviewer = role(REVIEWER).permissions
    expect(canGrant(hafiz, reviewer, only(fx('PRJ-0002')))).toBe(true)
    expect(canGrant(hafiz, reviewer, only(fx('PRJ-0001')))).toBe(false)
    expect(canGrant(hafiz, reviewer, ALL)).toBe(false)
  })

  it('Given a Reviewer, when they try to give Project Admin, then they cannot grant more than they have', () => {
    expect(canGrant(MEI, role(PROJECT_ADMIN).permissions, only(fx('PRJ-0001')))).toBe(false)
  })

  it('Given a Merchant Owner or Super admin, then they can give any role for All projects', () => {
    expect(canGrant([grant(MERCHANT_OWNER, ALL)], role(MERCHANT_OWNER).permissions, ALL)).toBe(true)
    expect(canGrant('SUPER_ADMIN', role(MERCHANT_OWNER).permissions, ALL)).toBe(true)
  })

  it('Given the only Merchant Owner, when their owner assignment goes, then it is refused; with a second owner it is not', () => {
    const owner = { assignments: [assign(MERCHANT_OWNER, ALL)] }
    const other = { assignments: [assign(MERCHANT_OWNER, ALL, 2)] }
    const demoted = { assignments: [assign(PROJECT_ADMIN, ALL)] }
    expect(lastOwnerError([owner], [demoted])).toHaveLength(1)
    expect(lastOwnerError([owner, other], [demoted, other])).toEqual([])
    expect(lastOwnerError([], [])).toEqual([])
  })
})

describe('roles: the Roles screen (DEC-76)', () => {
  const others = ROLES

  it('Given no permission ticked, then the FRS message is shown', () => {
    expect(validateRole({ name: 'Auditor', permissions: [] }, others)).toEqual([{ field: 'permissions', message: ROLE_NEEDS_PERMISSION }])
  })

  it('Given a name already used (any case), then it is refused', () => {
    expect(validateRole({ name: ' reviewer ', permissions: ['VIEW_CASES'] }, others)[0]).toMatchObject({ field: 'name' })
    expect(validateRole({ name: 'Auditor', permissions: ['VIEW_AUDIT_LOG'] }, others)).toEqual([])
  })

  it('Given a System Default role, then it cannot be edited or deactivated', () => {
    const owner = role(MERCHANT_OWNER)
    expect(validateRole({ name: 'Boss', permissions: ['VIEW_CASES'] }, others, { ...owner, heldForSelectedProjects: false })).toHaveLength(1)
    expect(validateRoleStatus(owner, 'INACTIVE', 0)).toHaveLength(1)
  })

  it('Given a Custom role held for selected projects, when a merchant-level permission is added, then it is refused', () => {
    const custom = { roleId: fx('ROL-2026-0100'), type: 'CUSTOM' as const, heldForSelectedProjects: true }
    const perms: Permission[] = ['VIEW_CASES', 'MANAGE_BILLING']
    expect(validateRole({ name: 'Ops', permissions: perms }, others, custom)[0].field).toBe('permissions')
    expect(validateRole({ name: 'Ops', permissions: perms }, others, { ...custom, heldForSelectedProjects: false })).toEqual([])
  })

  it('Given a Custom role still assigned, when it is deactivated, then the FRS message is shown', () => {
    expect(validateRoleStatus({ type: 'CUSTOM' }, 'INACTIVE', 2)).toEqual([{ field: 'status', message: ROLE_IN_USE }])
    expect(validateRoleStatus({ type: 'CUSTOM' }, 'INACTIVE', 0)).toEqual([])
  })

  it('Given users with several assignments, then each holder of the role is counted once', () => {
    const users = [{ assignments: [assign(REVIEWER, only(fx('PRJ-0001'))), assign(REVIEWER, only(fx('PRJ-0002')), 2)] }, { assignments: [assign(VIEWER, ALL)] }]
    expect(holdersOf(REVIEWER, users)).toHaveLength(1)
  })
})

describe('roles: platform roles and access end dates (DEC-99)', () => {
  it('Given platform actions, then each ticks its View; Claim / approve / reject ticks both views', () => {
    expect(withImpliedPermissions(['P_CASES_DECIDE'])).toEqual(['P_CASES_VIEW_MASKED', 'P_CASES_VIEW_UNMASKED', 'P_CASES_DECIDE'])
    expect(withImpliedPermissions(['P_MERCHANTS_SUSPEND', 'P_INTEGRATION_MANAGE'])).toEqual(['P_MERCHANTS_VIEW', 'P_MERCHANTS_SUSPEND', 'P_INTEGRATION_VIEW', 'P_INTEGRATION_MANAGE'])
  })

  it('Given a role Type, then only its own permissions; merchant roles take project scopes, platform roles merchant scopes', () => {
    expect(validateRole({ name: 'Mixed', permissions: ['VIEW_CASES', 'P_FLOWS_VIEW'], audience: 'MERCHANT' }, [])[0].field).toBe('permissions')
    const platformRole = { permissions: ['P_CASES_VIEW_MASKED'] as Permission[], status: 'ACTIVE' as const, audience: 'PLATFORM' as const }
    expect(validateAssignment(platformRole, { kind: 'ALL_MERCHANTS' }, [], [])).toEqual([])
    expect(validateAssignment(platformRole, only(fx('PRJ-0001')), [fx('PRJ-0001')])[0].message).toBe(WRONG_ROLE_TYPE)
    expect(validateAssignment({ ...role(REVIEWER) }, { kind: 'ALL_MERCHANTS' }, [])[0].message).toBe(WRONG_ROLE_TYPE)
    expect(validateAssignment(platformRole, { kind: 'MERCHANTS', merchantIds: [] }, [], ['mer_a'])[0].field).toBe('scope')
  })

  it('Given merchant scopes, then labels and coverage by merchant', () => {
    expect(scopeLabel({ kind: 'ALL_MERCHANTS' }, (x) => x)).toBe('All merchants')
    expect(scopeLabel({ kind: 'MERCHANTS', merchantIds: ['mer_a'] }, (x) => x, () => 'Vantage')).toBe('Vantage')
    expect(coversMerchant({ kind: 'MERCHANTS', merchantIds: ['mer_a'] }, 'mer_b')).toBe(false)
    expect(hasMerchantAccess(['P_BILLING_VIEW'])).toBe(false)
  })
})

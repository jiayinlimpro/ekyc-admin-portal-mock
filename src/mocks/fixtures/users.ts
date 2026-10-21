import { SYSTEM_DEFAULT_ROLES, SYSTEM_ROLE_IDS } from '@/domain/roles'
import type { Actor, AssignmentScope, Role, UserAccount } from '@/domain/types'

// ---------------------------------------------------------------------------------------------------------------------
// Accounts and roles under the scoped-assignment model (DEC-70, DEC-74, DEC-76): the only user list. Emails use the
// reserved .example domain.
// ---------------------------------------------------------------------------------------------------------------------

const PLATFORM_ADMIN: Actor = { userId: 'USR-2026-0001', fullName: 'Lim Wei Jie' }

type RoleKey = keyof typeof SYSTEM_ROLE_IDS | 'AUDITOR'
const ALL: AssignmentScope = { kind: 'ALL_PROJECTS' }
const only = (...projectIds: string[]): AssignmentScope => ({ kind: 'PROJECTS', projectIds })

type AccountSpec = Omit<UserAccount, 'assignments' | 'invitedAt' | 'lastActiveAt'> & {
  access: [RoleKey, AssignmentScope][]
  addedBy: Actor
  invitedDaysAgo: number
  lastActiveHoursAgo?: number
}

const ATOZ_OWNER: Actor = { userId: 'USR-2026-0002', fullName: 'Tan Mei Ling' }
const VANTAGE_OWNER: Actor = { userId: 'USR-2026-0045', fullName: 'Ahmad Faiz Bin Zulkifli' }

const ACCOUNT_SPECS: AccountSpec[] = [
  { ...PLATFORM_ADMIN, email: 'weijie.lim@ekyc-platform.example', level: 'PLATFORM_ADMIN', access: [], addedBy: PLATFORM_ADMIN, status: 'ACTIVE', invitedDaysAgo: 400, lastActiveHoursAgo: 1 },
  // A second Platform Admin, so the Admins screen (DEC-79) can show Suspend without hitting "at least one".
  { userId: 'USR-2026-0005', fullName: 'Nor Aisyah Binti Hamid', email: 'aisyah.hamid@ekyc-platform.example', level: 'PLATFORM_ADMIN', access: [], addedBy: PLATFORM_ADMIN, status: 'ACTIVE', invitedDaysAgo: 120, lastActiveHoursAgo: 26 },
  // Atoz Software Tech: owner, a Project Admin for SME app, reviewers, one user with a role in each project.
  { ...ATOZ_OWNER, email: 'meiling.tan@atoz.example', level: 'MERCHANT_USER', merchantId: 'MER-0001', access: [['MERCHANT_OWNER', ALL]], addedBy: PLATFORM_ADMIN, status: 'ACTIVE', invitedDaysAgo: 400, lastActiveHoursAgo: 2 },
  { userId: 'USR-2026-0012', fullName: 'Ali Bin Ahmad', email: 'ali.ahmad@atoz.example', level: 'MERCHANT_USER', merchantId: 'MER-0001', access: [['REVIEWER', only('PRJ-0001')], ['VIEWER', only('PRJ-0002')]], addedBy: ATOZ_OWNER, status: 'ACTIVE', invitedDaysAgo: 300, lastActiveHoursAgo: 1 },
  { userId: 'USR-2026-0020', fullName: 'Hafiz Bin Rahman', email: 'hafiz.rahman@atoz.example', level: 'MERCHANT_USER', merchantId: 'MER-0001', access: [['PROJECT_ADMIN', only('PRJ-0002')]], addedBy: ATOZ_OWNER, status: 'ACTIVE', invitedDaysAgo: 60, lastActiveHoursAgo: 20 },
  { userId: 'USR-2026-0031', fullName: 'Siti Aminah Binti Yusof', email: 'siti.yusof@atoz.example', level: 'MERCHANT_USER', merchantId: 'MER-0001', access: [['REVIEWER', only('PRJ-0001')]], addedBy: ATOZ_OWNER, status: 'ACTIVE', invitedDaysAgo: 280, lastActiveHoursAgo: 1 },
  { userId: 'USR-2026-0033', fullName: 'Nurul Huda Binti Kamaruddin', email: 'nurul.huda@atoz.example', level: 'MERCHANT_USER', merchantId: 'MER-0001', access: [['REVIEWER', only('PRJ-0002')]], addedBy: ATOZ_OWNER, status: 'ACTIVE', invitedDaysAgo: 55, lastActiveHoursAgo: 5 },
  { userId: 'USR-2026-0035', fullName: 'Chong Pei Shan', email: 'peishan.chong@atoz.example', level: 'MERCHANT_USER', merchantId: 'MER-0001', access: [['VIEWER', only('PRJ-0001')]], addedBy: ATOZ_OWNER, status: 'PENDING', invitedDaysAgo: 2 },
  { userId: 'USR-2026-0039', fullName: 'Yap Li Wen', email: 'liwen.yap@atoz.example', level: 'MERCHANT_USER', merchantId: 'MER-0001', access: [['REVIEWER', only('PRJ-0001')]], addedBy: ATOZ_OWNER, status: 'SUSPENDED', invitedDaysAgo: 200, lastActiveHoursAgo: 40 * 24 },
  // Vantage: owner, a reviewer, and a Custom role held for All projects.
  { ...VANTAGE_OWNER, email: 'faiz.zulkifli@vantage.example', level: 'MERCHANT_USER', merchantId: 'MER-0002', access: [['MERCHANT_OWNER', ALL]], addedBy: PLATFORM_ADMIN, status: 'ACTIVE', invitedDaysAgo: 400, lastActiveHoursAgo: 30 },
  { userId: 'USR-2026-0044', fullName: 'Kavitha A/P Subramaniam', email: 'kavitha.s@vantage.example', level: 'MERCHANT_USER', merchantId: 'MER-0002', access: [['REVIEWER', only('PRJ-0003')], ['AUDITOR', ALL]], addedBy: VANTAGE_OWNER, status: 'ACTIVE', invitedDaysAgo: 380, lastActiveHoursAgo: 3 },
  // One person each for the smaller merchants.
  { userId: 'USR-2026-0052', fullName: 'Wong Kah Heng', email: 'kahheng.wong@tesla.example', level: 'MERCHANT_USER', merchantId: 'MER-0003', access: [['MERCHANT_OWNER', ALL]], addedBy: PLATFORM_ADMIN, status: 'ACTIVE', invitedDaysAgo: 300, lastActiveHoursAgo: 6 },
  { userId: 'USR-2026-0063', fullName: 'Farah Binti Ismail', email: 'farah.ismail@boring.example', level: 'MERCHANT_USER', merchantId: 'MER-0004', access: [['PROJECT_ADMIN', only('PRJ-0005')]], addedBy: PLATFORM_ADMIN, status: 'ACTIVE', invitedDaysAgo: 300, lastActiveHoursAgo: 8 },
  { userId: 'USR-2026-0071', fullName: 'Ng Chee Keong', email: 'cheekeong.ng@3nova.example', level: 'MERCHANT_USER', merchantId: 'MER-0005', access: [['MERCHANT_OWNER', ALL]], addedBy: PLATFORM_ADMIN, status: 'ACTIVE', invitedDaysAgo: 250, lastActiveHoursAgo: 12 },
  { userId: 'USR-2026-0080', fullName: 'Rajesh A/L Muthu', email: 'rajesh.muthu@emptydemo.example', level: 'MERCHANT_USER', merchantId: 'MER-0006', access: [['MERCHANT_OWNER', ALL]], addedBy: PLATFORM_ADMIN, status: 'ACTIVE', invitedDaysAgo: 20, lastActiveHoursAgo: 48 },
]

/** Vantage's Custom role: read-only access plus the audit log (DEC-76). */
export const AUDITOR_ROLE_ID = 'ROL-2026-0005'

/** REQ: DEC-70 / DEC-76 — the System Default roles (shared, locked) plus one Custom role. */
export function buildRoles(now: Date): Role[] {
  const at = new Date(now.getTime() - 400 * 86_400_000).toISOString()
  const system = SYSTEM_DEFAULT_ROLES.map((r): Role => ({ ...r, permissions: [...r.permissions], type: 'SYSTEM_DEFAULT', status: 'ACTIVE', createdAt: at, createdBy: PLATFORM_ADMIN, updatedAt: at, updatedBy: PLATFORM_ADMIN }))
  const auditorAt = new Date(now.getTime() - 200 * 86_400_000).toISOString()
  const auditor: Role = {
    roleId: AUDITOR_ROLE_ID,
    merchantId: 'MER-0002',
    name: 'Compliance Auditor',
    type: 'CUSTOM',
    permissions: ['VIEW_CASES', 'VIEW_PROJECT_REPORTS', 'VIEW_AUDIT_LOG'],
    status: 'ACTIVE',
    createdAt: auditorAt,
    createdBy: VANTAGE_OWNER,
    updatedAt: auditorAt,
    updatedBy: VANTAGE_OWNER,
  }
  return [...system, auditor]
}

const ROLE_IDS: Record<RoleKey, string> = { ...SYSTEM_ROLE_IDS, AUDITOR: AUDITOR_ROLE_ID }

export function buildAccounts(now: Date): UserAccount[] {
  const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString()
  let seq = 0
  return ACCOUNT_SPECS.map(({ invitedDaysAgo, lastActiveHoursAgo, access, addedBy, ...a }) => ({
    ...a,
    assignments: access.map(([role, scope]) => ({
      assignmentId: `ASG-2026-${String(++seq).padStart(4, '0')}`,
      roleId: ROLE_IDS[role],
      scope,
      addedBy,
      addedAt: ago(invitedDaysAgo * 24),
    })),
    invitedAt: ago(invitedDaysAgo * 24),
    lastActiveAt: lastActiveHoursAgo === undefined ? undefined : ago(lastActiveHoursAgo),
  }))
}

/** The session part of an account. Rights always come from the account itself (services/accessGuard.ts). */
export const actorOf = (a: Pick<UserAccount, 'userId' | 'fullName'>): Actor => ({ userId: a.userId, fullName: a.fullName })

export const USERS: Actor[] = ACCOUNT_SPECS.map(actorOf)

export const userById = (id: string) => USERS.find((u) => u.userId === id)

export const DEFAULT_USER = userById('USR-2026-0012')! // Ali Bin Ahmad — main reviewer persona in docs/SCENARIOS.md

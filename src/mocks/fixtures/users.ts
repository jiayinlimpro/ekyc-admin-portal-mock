import { PLATFORM_DEFAULT_ROLES, PLATFORM_ROLE_IDS, SYSTEM_DEFAULT_ROLES, SYSTEM_ROLE_IDS } from '@/domain/roles'
import type { Actor, AssignmentScope, Role, UserAccount } from '@/domain/types'
import { fx, stableId } from '@/lib/ids'

// ---------------------------------------------------------------------------------------------------------------------
// Accounts and roles under the scoped-assignment model (DEC-70, DEC-74, DEC-76): the only user list. Emails use the
// reserved .example domain.
// ---------------------------------------------------------------------------------------------------------------------

const SUPER_ADMIN: Actor = { userId: fx('USR-2026-0001'), fullName: 'Lim Wei Jie' }

type RoleKey = keyof typeof SYSTEM_ROLE_IDS | keyof typeof PLATFORM_ROLE_IDS | 'AUDITOR'
const ALL: AssignmentScope = { kind: 'ALL_PROJECTS' }
const only = (...projectIds: string[]): AssignmentScope => ({ kind: 'PROJECTS', projectIds })
const ALL_MERCHANTS: AssignmentScope = { kind: 'ALL_MERCHANTS' }
const merchants = (...merchantIds: string[]): AssignmentScope => ({ kind: 'MERCHANTS', merchantIds })

type AccountSpec = Omit<UserAccount, 'assignments' | 'invitedAt' | 'lastActiveAt'> & {
  /** Role, scope and, optionally, days until the access ends (DEC-99). */
  access: [RoleKey, AssignmentScope][]
  addedBy: Actor
  invitedDaysAgo: number
  lastActiveHoursAgo?: number
}

const ATOZ_OWNER: Actor = { userId: fx('USR-2026-0002'), fullName: 'Tan Mei Ling' }
const VANTAGE_OWNER: Actor = { userId: fx('USR-2026-0045'), fullName: 'Ahmad Faiz Bin Zulkifli' }

const ACCOUNT_SPECS: AccountSpec[] = [
  { ...SUPER_ADMIN, email: 'weijie.lim@ekyc-platform.example', level: 'SUPER_ADMIN', access: [], addedBy: SUPER_ADMIN, status: 'ACTIVE', invitedDaysAgo: 400, lastActiveHoursAgo: 1 },
  // A second Super admin, so the Admins screen (DEC-79) can show Suspend without hitting "at least one".
  { userId: fx('USR-2026-0005'), fullName: 'Nor Aisyah Binti Hamid', email: 'aisyah.hamid@ekyc-platform.example', level: 'SUPER_ADMIN', access: [], addedBy: SUPER_ADMIN, status: 'ACTIVE', invitedDaysAgo: 120, lastActiveHoursAgo: 26 },
  // REQ: DEC-99 — platform staff: no merchant; platform roles given for all or selected merchants.
  { userId: fx('USR-2026-0006'), fullName: 'Daniel Tan', email: 'daniel.tan@ekyc-platform.example', level: 'PLATFORM_STAFF', access: [['SUPPORT', ALL_MERCHANTS]], addedBy: SUPER_ADMIN, status: 'ACTIVE', invitedDaysAgo: 90, lastActiveHoursAgo: 3 },
  { userId: fx('USR-2026-0007'), fullName: 'Priya Nair', email: 'priya.nair@ekyc-platform.example', level: 'PLATFORM_STAFF', access: [['VERIFICATION_SPECIALIST', merchants(fx('MER-0002'))]], addedBy: SUPER_ADMIN, status: 'ACTIVE', invitedDaysAgo: 30, lastActiveHoursAgo: 5 },
  { userId: fx('USR-2026-0008'), fullName: 'Hannah Lee', email: 'hannah.lee@ekyc-platform.example', level: 'PLATFORM_STAFF', access: [['FINANCE', ALL_MERCHANTS]], addedBy: SUPER_ADMIN, status: 'ACTIVE', invitedDaysAgo: 60, lastActiveHoursAgo: 30 },
  // Atoz Software Tech: owner, a Project Admin for SME app, reviewers, one user with a role in each project.
  { ...ATOZ_OWNER, email: 'meiling.tan@atoz.example', level: 'MERCHANT_USER', merchantId: fx('MER-0001'), access: [['MERCHANT_OWNER', ALL]], addedBy: SUPER_ADMIN, status: 'ACTIVE', invitedDaysAgo: 400, lastActiveHoursAgo: 2 },
  { userId: fx('USR-2026-0012'), fullName: 'Ali Bin Ahmad', email: 'ali.ahmad@atoz.example', level: 'MERCHANT_USER', merchantId: fx('MER-0001'), access: [['REVIEWER', only(fx('PRJ-0001'))], ['VIEWER', only(fx('PRJ-0002'))]], addedBy: ATOZ_OWNER, status: 'ACTIVE', invitedDaysAgo: 300, lastActiveHoursAgo: 1 },
  { userId: fx('USR-2026-0020'), fullName: 'Hafiz Bin Rahman', email: 'hafiz.rahman@atoz.example', level: 'MERCHANT_USER', merchantId: fx('MER-0001'), access: [['PROJECT_ADMIN', only(fx('PRJ-0002'))]], addedBy: ATOZ_OWNER, status: 'ACTIVE', invitedDaysAgo: 60, lastActiveHoursAgo: 20 },
  { userId: fx('USR-2026-0031'), fullName: 'Siti Aminah Binti Yusof', email: 'siti.yusof@atoz.example', level: 'MERCHANT_USER', merchantId: fx('MER-0001'), access: [['REVIEWER', only(fx('PRJ-0001'))]], addedBy: ATOZ_OWNER, status: 'ACTIVE', invitedDaysAgo: 280, lastActiveHoursAgo: 1 },
  { userId: fx('USR-2026-0033'), fullName: 'Nurul Huda Binti Kamaruddin', email: 'nurul.huda@atoz.example', level: 'MERCHANT_USER', merchantId: fx('MER-0001'), access: [['REVIEWER', only(fx('PRJ-0002'))]], addedBy: ATOZ_OWNER, status: 'ACTIVE', invitedDaysAgo: 55, lastActiveHoursAgo: 5 },
  { userId: fx('USR-2026-0035'), fullName: 'Chong Pei Shan', email: 'peishan.chong@atoz.example', level: 'MERCHANT_USER', merchantId: fx('MER-0001'), access: [['VIEWER', only(fx('PRJ-0001'))]], addedBy: ATOZ_OWNER, status: 'PENDING', invitedDaysAgo: 2 },
  { userId: fx('USR-2026-0039'), fullName: 'Yap Li Wen', email: 'liwen.yap@atoz.example', level: 'MERCHANT_USER', merchantId: fx('MER-0001'), access: [['REVIEWER', only(fx('PRJ-0001'))]], addedBy: ATOZ_OWNER, status: 'SUSPENDED', invitedDaysAgo: 200, lastActiveHoursAgo: 40 * 24 },
  // Vantage: owner, a reviewer, and a Custom role held for All projects.
  { ...VANTAGE_OWNER, email: 'faiz.zulkifli@vantage.example', level: 'MERCHANT_USER', merchantId: fx('MER-0002'), access: [['MERCHANT_OWNER', ALL]], addedBy: SUPER_ADMIN, status: 'ACTIVE', invitedDaysAgo: 400, lastActiveHoursAgo: 30 },
  { userId: fx('USR-2026-0044'), fullName: 'Kavitha A/P Subramaniam', email: 'kavitha.s@vantage.example', level: 'MERCHANT_USER', merchantId: fx('MER-0002'), access: [['REVIEWER', only(fx('PRJ-0003'))], ['AUDITOR', ALL]], addedBy: VANTAGE_OWNER, status: 'ACTIVE', invitedDaysAgo: 380, lastActiveHoursAgo: 3 },
  // One person each for the smaller merchants.
  { userId: fx('USR-2026-0052'), fullName: 'Wong Kah Heng', email: 'kahheng.wong@tesla.example', level: 'MERCHANT_USER', merchantId: fx('MER-0003'), access: [['MERCHANT_OWNER', ALL]], addedBy: SUPER_ADMIN, status: 'ACTIVE', invitedDaysAgo: 300, lastActiveHoursAgo: 6 },
  { userId: fx('USR-2026-0063'), fullName: 'Farah Binti Ismail', email: 'farah.ismail@boring.example', level: 'MERCHANT_USER', merchantId: fx('MER-0004'), access: [['PROJECT_ADMIN', only(fx('PRJ-0005'))]], addedBy: SUPER_ADMIN, status: 'ACTIVE', invitedDaysAgo: 300, lastActiveHoursAgo: 8 },
  { userId: fx('USR-2026-0071'), fullName: 'Ng Chee Keong', email: 'cheekeong.ng@3nova.example', level: 'MERCHANT_USER', merchantId: fx('MER-0005'), access: [['MERCHANT_OWNER', ALL]], addedBy: SUPER_ADMIN, status: 'ACTIVE', invitedDaysAgo: 250, lastActiveHoursAgo: 12 },
  { userId: fx('USR-2026-0080'), fullName: 'Rajesh A/L Muthu', email: 'rajesh.muthu@emptydemo.example', level: 'MERCHANT_USER', merchantId: fx('MER-0006'), access: [['MERCHANT_OWNER', ALL]], addedBy: SUPER_ADMIN, status: 'ACTIVE', invitedDaysAgo: 20, lastActiveHoursAgo: 48 },
]

/** Vantage's Custom role: read-only access plus the audit log (DEC-76). */
export const AUDITOR_ROLE_ID = fx('ROL-2026-0005')
/** Atoz's Custom role that nobody holds yet: it can be deactivated (DEC-76). */
export const FRAUD_ANALYST_ROLE_ID = fx('ROL-2026-0006')

/** REQ: DEC-70 / DEC-76 — the System Default roles (shared, locked) plus one Custom role. */
export function buildRoles(now: Date): Role[] {
  const at = new Date(now.getTime() - 400 * 86_400_000).toISOString()
  const system = SYSTEM_DEFAULT_ROLES.map((r): Role => ({ ...r, audience: 'MERCHANT', permissions: [...r.permissions], type: 'SYSTEM_DEFAULT', status: 'ACTIVE', createdAt: at, createdBy: SUPER_ADMIN, updatedAt: at, updatedBy: SUPER_ADMIN }))
  // REQ: DEC-99 — the System Default platform roles.
  const platform = PLATFORM_DEFAULT_ROLES.map((r): Role => ({ ...r, audience: 'PLATFORM', permissions: [...r.permissions], type: 'SYSTEM_DEFAULT', status: 'ACTIVE', createdAt: at, createdBy: SUPER_ADMIN, updatedAt: at, updatedBy: SUPER_ADMIN }))
  const auditorAt = new Date(now.getTime() - 200 * 86_400_000).toISOString()
  const auditor: Role = {
    roleId: AUDITOR_ROLE_ID,
    audience: 'MERCHANT',
    merchantId: fx('MER-0002'),
    name: 'Compliance Auditor',
    type: 'CUSTOM',
    permissions: ['VIEW_CASES', 'VIEW_PROJECT_REPORTS', 'VIEW_AUDIT_LOG'],
    status: 'ACTIVE',
    createdAt: auditorAt,
    createdBy: VANTAGE_OWNER,
    updatedAt: auditorAt,
    updatedBy: VANTAGE_OWNER,
  }
  const fraudAt = new Date(now.getTime() - 30 * 86_400_000).toISOString()
  const atozOwner = { userId: fx('USR-2026-0002'), fullName: 'Tan Mei Ling' }
  const fraudAnalyst: Role = {
    roleId: FRAUD_ANALYST_ROLE_ID,
    audience: 'MERCHANT',
    merchantId: fx('MER-0001'),
    name: 'Fraud Analyst',
    type: 'CUSTOM',
    permissions: ['VIEW_CASES', 'VIEW_PROJECT_REPORTS', 'VIEW_AUDIT_LOG'],
    status: 'ACTIVE',
    createdAt: fraudAt,
    createdBy: atozOwner,
    updatedAt: fraudAt,
    updatedBy: atozOwner,
  }
  return [...system, ...platform, auditor, fraudAnalyst]
}

const ROLE_IDS: Record<RoleKey, string> = { ...SYSTEM_ROLE_IDS, ...PLATFORM_ROLE_IDS, AUDITOR: AUDITOR_ROLE_ID }

export function buildAccounts(now: Date): UserAccount[] {
  const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString()
  let seq = 0
  return ACCOUNT_SPECS.map(({ invitedDaysAgo, lastActiveHoursAgo, access, addedBy, ...a }) => ({
    ...a,
    assignments: access.map(([role, scope]) => ({
      assignmentId: fx(`ASG-2026-${String(++seq).padStart(4, '0')}`),
      roleId: ROLE_IDS[role],
      scope,
      addedBy,
      addedAt: ago(invitedDaysAgo * 24),
    })),
    invitedAt: ago(invitedDaysAgo * 24),
    invitationId: a.status === 'PENDING' ? stableId('inv', a.userId) : undefined,
    lastActiveAt: lastActiveHoursAgo === undefined ? undefined : ago(lastActiveHoursAgo),
  }))
}

/** The session part of an account. Rights always come from the account itself (services/accessGuard.ts). */
export const actorOf = (a: Pick<UserAccount, 'userId' | 'fullName'>): Actor => ({ userId: a.userId, fullName: a.fullName })

export const USERS: Actor[] = ACCOUNT_SPECS.map(actorOf)

export const userById = (id: string) => USERS.find((u) => u.userId === id)

export const DEFAULT_USER = userById(fx('USR-2026-0012'))! // Ali Bin Ahmad — main reviewer persona in docs/SCENARIOS.md

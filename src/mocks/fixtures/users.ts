import { PLATFORM_DEFAULT_ROLES, PLATFORM_ROLE_IDS, SYSTEM_DEFAULT_ROLES, SYSTEM_ROLE_IDS } from '@/domain/roles'
import type { Actor, AssignmentScope, Role, UserAccount } from '@/domain/types'
import { fx, stableId } from '@/lib/ids'

// ---------------------------------------------------------------------------------------------------------------------
// Accounts and roles (DEC-74, DEC-76, DEC-104): the only user list. Emails use the reserved .example domain.
// A merchant user has one merchant role (given on Users, whole merchant) plus project roles (given in Project › Members,
// that project only). A platform staff member has one platform role (no scope). Reviewed 2026-10-23 (DEC-104).
// ---------------------------------------------------------------------------------------------------------------------

const SUPER_ADMIN: Actor = { userId: fx('USR-2026-0001'), fullName: 'Lim Wei Jie' }

/** REQ: DEC-104 — Custom roles of Atoz: one merchant role, two project roles (one per project). */
export const CUSTOM_ROLE_IDS = {
  USER_COORDINATOR: fx('ROL-2026-0020'), // merchant role
  FRAUD_CHECKER: fx('ROL-2026-0021'), // project role of Default
  RELEASE_TESTER: fx('ROL-2026-0022'), // project role of SME app, held by nobody (it can be deactivated)
} as const

type RoleKey = keyof typeof SYSTEM_ROLE_IDS | keyof typeof PLATFORM_ROLE_IDS | keyof typeof CUSTOM_ROLE_IDS
const ALL: AssignmentScope = { kind: 'ALL_PROJECTS' }
const ALL_MERCHANTS: AssignmentScope = { kind: 'ALL_MERCHANTS' }
const project = (projectId: string): [AssignmentScope] => [{ kind: 'PROJECTS', projectIds: [projectId] }]

type AccountSpec = Omit<UserAccount, 'assignments' | 'invitedAt' | 'lastActiveAt'> & {
  /** Merchant users: the merchant role, then [role, project] pairs from Members. Staff: their platform role. */
  role?: RoleKey
  projects?: [RoleKey, string][]
  addedBy: Actor
  invitedDaysAgo: number
  lastActiveHoursAgo?: number
}

const ATOZ_OWNER: Actor = { userId: fx('USR-2026-0002'), fullName: 'Tan Mei Ling' }
const VANTAGE_OWNER: Actor = { userId: fx('USR-2026-0045'), fullName: 'Ahmad Faiz Bin Zulkifli' }
const ATOZ = { level: 'MERCHANT_USER', merchantId: fx('MER-0001') } as const
const STAFF = { level: 'PLATFORM_STAFF', addedBy: SUPER_ADMIN } as const

const ACCOUNT_SPECS: AccountSpec[] = [
  { ...SUPER_ADMIN, email: 'weijie.lim@ekyc-platform.example', level: 'SUPER_ADMIN', addedBy: SUPER_ADMIN, status: 'ACTIVE', invitedDaysAgo: 400, lastActiveHoursAgo: 1 },
  // A second Super admin, so the Super admins screen (DEC-79) can show Suspend without hitting "at least one".
  { userId: fx('USR-2026-0005'), fullName: 'Nor Aisyah Binti Hamid', email: 'aisyah.hamid@ekyc-platform.example', level: 'SUPER_ADMIN', addedBy: SUPER_ADMIN, status: 'ACTIVE', invitedDaysAgo: 120, lastActiveHoursAgo: 26 },
  // REQ: DEC-104 — platform staff: one platform role, every merchant.
  { ...STAFF, userId: fx('USR-2026-0006'), fullName: 'Daniel Tan', email: 'daniel.tan@ekyc-platform.example', role: 'SUPPORT', status: 'ACTIVE', invitedDaysAgo: 90, lastActiveHoursAgo: 3 },
  { ...STAFF, userId: fx('USR-2026-0007'), fullName: 'Priya Nair', email: 'priya.nair@ekyc-platform.example', role: 'SUPPORT', status: 'ACTIVE', invitedDaysAgo: 30, lastActiveHoursAgo: 5 },
  { ...STAFF, userId: fx('USR-2026-0008'), fullName: 'Hannah Lee', email: 'hannah.lee@ekyc-platform.example', role: 'FINANCE', status: 'ACTIVE', invitedDaysAgo: 60, lastActiveHoursAgo: 30 },
  { ...STAFF, userId: fx('USR-2026-0009'), fullName: 'Marcus Lee', email: 'marcus.lee@ekyc-platform.example', role: 'IMPLEMENTATION', status: 'ACTIVE', invitedDaysAgo: 200, lastActiveHoursAgo: 10 },
  { ...STAFF, userId: fx('USR-2026-0010'), fullName: 'Rizal Hakim', email: 'rizal.hakim@ekyc-platform.example', role: 'PLATFORM_ADMIN', status: 'ACTIVE', invitedDaysAgo: 250, lastActiveHoursAgo: 8 },
  // Atoz Software Tech: the Owner; everyone else is a Member with roles per project (Project › Members).
  { ...ATOZ_OWNER, ...ATOZ, email: 'meiling.tan@atoz.example', role: 'OWNER', addedBy: SUPER_ADMIN, status: 'ACTIVE', invitedDaysAgo: 400, lastActiveHoursAgo: 2 },
  { ...ATOZ, userId: fx('USR-2026-0012'), fullName: 'Ali Bin Ahmad', email: 'ali.ahmad@atoz.example', role: 'MEMBER', projects: [['REVIEWER', fx('PRJ-0001')], ['VIEWER', fx('PRJ-0002')]], addedBy: ATOZ_OWNER, status: 'ACTIVE', invitedDaysAgo: 300, lastActiveHoursAgo: 1 },
  { ...ATOZ, userId: fx('USR-2026-0020'), fullName: 'Hafiz Bin Rahman', email: 'hafiz.rahman@atoz.example', role: 'MEMBER', projects: [['PROJECT_ADMIN', fx('PRJ-0002')]], addedBy: ATOZ_OWNER, status: 'ACTIVE', invitedDaysAgo: 60, lastActiveHoursAgo: 20 },
  { ...ATOZ, userId: fx('USR-2026-0031'), fullName: 'Siti Aminah Binti Yusof', email: 'siti.yusof@atoz.example', role: 'MEMBER', projects: [['REVIEWER', fx('PRJ-0001')]], addedBy: ATOZ_OWNER, status: 'ACTIVE', invitedDaysAgo: 280, lastActiveHoursAgo: 1 },
  { ...ATOZ, userId: fx('USR-2026-0033'), fullName: 'Nurul Huda Binti Kamaruddin', email: 'nurul.huda@atoz.example', role: 'MEMBER', projects: [['REVIEWER', fx('PRJ-0002')]], addedBy: ATOZ_OWNER, status: 'ACTIVE', invitedDaysAgo: 55, lastActiveHoursAgo: 5 },
  { ...ATOZ, userId: fx('USR-2026-0035'), fullName: 'Chong Pei Shan', email: 'peishan.chong@atoz.example', role: 'MEMBER', projects: [['VIEWER', fx('PRJ-0001')]], addedBy: ATOZ_OWNER, status: 'PENDING', invitedDaysAgo: 2 },
  { ...ATOZ, userId: fx('USR-2026-0039'), fullName: 'Yap Li Wen', email: 'liwen.yap@atoz.example', role: 'MEMBER', projects: [['REVIEWER', fx('PRJ-0001')]], addedBy: ATOZ_OWNER, status: 'SUSPENDED', invitedDaysAgo: 200, lastActiveHoursAgo: 40 * 24 },
  // Merchant-wide roles given on Users (DEC-104): an Admin, Billing and a Developer in one project.
  { ...ATOZ, userId: fx('USR-2026-0036'), fullName: 'Lee Jia Hui', email: 'jiahui.lee@atoz.example', role: 'ADMIN', addedBy: ATOZ_OWNER, status: 'ACTIVE', invitedDaysAgo: 150, lastActiveHoursAgo: 4 },
  { ...ATOZ, userId: fx('USR-2026-0037'), fullName: 'Muthu A/L Rajan', email: 'muthu.rajan@atoz.example', role: 'BILLING', addedBy: ATOZ_OWNER, status: 'ACTIVE', invitedDaysAgo: 120, lastActiveHoursAgo: 50 },
  { ...ATOZ, userId: fx('USR-2026-0038'), fullName: 'Kenneth Ooi', email: 'kenneth.ooi@atoz.example', role: 'MEMBER', projects: [['DEVELOPER', fx('PRJ-0002')]], addedBy: ATOZ_OWNER, status: 'ACTIVE', invitedDaysAgo: 40, lastActiveHoursAgo: 7 },
  // Auditor for the whole merchant plus Viewer in SME app: case list everywhere, case pages in SME app only (DEC-104).
  { ...ATOZ, userId: fx('USR-2026-0021'), fullName: 'Grace Lim', email: 'grace.lim@atoz.example', role: 'AUDITOR', projects: [['VIEWER', fx('PRJ-0002')]], addedBy: ATOZ_OWNER, status: 'ACTIVE', invitedDaysAgo: 90, lastActiveHoursAgo: 6 },
  // A Custom merchant role: views users and invites them (as Member, the only role he holds), views roles.
  { ...ATOZ, userId: fx('USR-2026-0022'), fullName: 'Aaron Teoh', email: 'aaron.teoh@atoz.example', role: 'USER_COORDINATOR', addedBy: ATOZ_OWNER, status: 'ACTIVE', invitedDaysAgo: 70, lastActiveHoursAgo: 9 },
  // A Custom project role of Default.
  { ...ATOZ, userId: fx('USR-2026-0023'), fullName: 'Zainab Hassan', email: 'zainab.hassan@atoz.example', role: 'MEMBER', projects: [['FRAUD_CHECKER', fx('PRJ-0001')]], addedBy: ATOZ_OWNER, status: 'ACTIVE', invitedDaysAgo: 25, lastActiveHoursAgo: 4 },
  // Vantage: the Owner, and an Auditor (whole merchant) who also reviews in Default.
  { ...VANTAGE_OWNER, email: 'faiz.zulkifli@vantage.example', level: 'MERCHANT_USER', merchantId: fx('MER-0002'), role: 'OWNER', addedBy: SUPER_ADMIN, status: 'ACTIVE', invitedDaysAgo: 400, lastActiveHoursAgo: 30 },
  { userId: fx('USR-2026-0044'), fullName: 'Kavitha A/P Subramaniam', email: 'kavitha.s@vantage.example', level: 'MERCHANT_USER', merchantId: fx('MER-0002'), role: 'AUDITOR', projects: [['REVIEWER', fx('PRJ-0003')]], addedBy: VANTAGE_OWNER, status: 'ACTIVE', invitedDaysAgo: 380, lastActiveHoursAgo: 3 },
  // One person each for the smaller merchants.
  { userId: fx('USR-2026-0052'), fullName: 'Wong Kah Heng', email: 'kahheng.wong@tesla.example', level: 'MERCHANT_USER', merchantId: fx('MER-0003'), role: 'OWNER', addedBy: SUPER_ADMIN, status: 'ACTIVE', invitedDaysAgo: 300, lastActiveHoursAgo: 6 },
  { userId: fx('USR-2026-0063'), fullName: 'Farah Binti Ismail', email: 'farah.ismail@boring.example', level: 'MERCHANT_USER', merchantId: fx('MER-0004'), role: 'OWNER', addedBy: SUPER_ADMIN, status: 'ACTIVE', invitedDaysAgo: 300, lastActiveHoursAgo: 8 },
  { userId: fx('USR-2026-0071'), fullName: 'Ng Chee Keong', email: 'cheekeong.ng@3nova.example', level: 'MERCHANT_USER', merchantId: fx('MER-0005'), role: 'OWNER', addedBy: SUPER_ADMIN, status: 'ACTIVE', invitedDaysAgo: 250, lastActiveHoursAgo: 12 },
  // Reviewer in Wallet app and in Pilot 2025, now archived: that access stays, read-only (DEC-77).
  { userId: fx('USR-2026-0072'), fullName: 'Lim Siew Mei', email: 'siewmei.lim@3nova.example', level: 'MERCHANT_USER', merchantId: fx('MER-0005'), role: 'MEMBER', projects: [['REVIEWER', fx('PRJ-0007')], ['REVIEWER', fx('PRJ-0008')]], addedBy: { userId: fx('USR-2026-0071'), fullName: 'Ng Chee Keong' }, status: 'ACTIVE', invitedDaysAgo: 240, lastActiveHoursAgo: 30 },
  { userId: fx('USR-2026-0080'), fullName: 'Rajesh A/L Muthu', email: 'rajesh.muthu@emptydemo.example', level: 'MERCHANT_USER', merchantId: fx('MER-0006'), role: 'OWNER', addedBy: SUPER_ADMIN, status: 'ACTIVE', invitedDaysAgo: 20, lastActiveHoursAgo: 48 },
]

/** REQ: DEC-76 / DEC-104 — the System Default roles only (shared, locked); merchants create their Custom roles. */
export function buildRoles(now: Date): Role[] {
  const at = new Date(now.getTime() - 400 * 86_400_000).toISOString()
  const system = SYSTEM_DEFAULT_ROLES.map((r): Role => ({ ...r, audience: 'MERCHANT', permissions: [...r.permissions], type: 'SYSTEM_DEFAULT', status: 'ACTIVE', createdAt: at, createdBy: SUPER_ADMIN, updatedAt: at, updatedBy: SUPER_ADMIN }))
  // REQ: DEC-99 — the System Default platform roles.
  const platform = PLATFORM_DEFAULT_ROLES.map((r): Role => ({ ...r, audience: 'PLATFORM', permissions: [...r.permissions], type: 'SYSTEM_DEFAULT', status: 'ACTIVE', createdAt: at, createdBy: SUPER_ADMIN, updatedAt: at, updatedBy: SUPER_ADMIN }))
  // REQ: DEC-104 — Atoz's Custom roles: a merchant role, and a project role in each project.
  const atozOwner: Actor = { userId: fx('USR-2026-0002'), fullName: 'Tan Mei Ling' }
  const customAt = new Date(now.getTime() - 120 * 86_400_000).toISOString()
  const custom = (roleId: string, name: string, level: Role['level'], permissions: Role['permissions'], projectId?: string): Role => ({
    roleId,
    audience: 'MERCHANT',
    level,
    merchantId: fx('MER-0001'),
    projectId,
    name,
    type: 'CUSTOM',
    permissions,
    status: 'ACTIVE',
    createdAt: customAt,
    createdBy: atozOwner,
    updatedAt: customAt,
    updatedBy: atozOwner,
  })
  return [
    ...system,
    ...platform,
    custom(CUSTOM_ROLE_IDS.USER_COORDINATOR, 'User Coordinator', 'MERCHANT', ['VIEW_USERS', 'INVITE_USERS', 'VIEW_ROLES']),
    custom(CUSTOM_ROLE_IDS.FRAUD_CHECKER, 'Fraud Checker', 'PROJECT', ['VIEW_CASE_LIST', 'VIEW_CASE_DETAILS', 'VIEW_AUDIT_LOG'], fx('PRJ-0001')),
    custom(CUSTOM_ROLE_IDS.RELEASE_TESTER, 'Release Tester', 'PROJECT', ['VIEW_FLOWS', 'VIEW_INTEGRATION'], fx('PRJ-0002')),
  ]
}

const ROLE_IDS: Record<RoleKey, string> = { ...SYSTEM_ROLE_IDS, ...PLATFORM_ROLE_IDS, ...CUSTOM_ROLE_IDS }

export function buildAccounts(now: Date): UserAccount[] {
  const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString()
  let seq = 0
  return ACCOUNT_SPECS.map(({ invitedDaysAgo, lastActiveHoursAgo, role, projects = [], addedBy, ...a }) => {
    const scope: AssignmentScope = a.level === 'PLATFORM_STAFF' ? ALL_MERCHANTS : ALL
    const access: [RoleKey, AssignmentScope][] = [...(role ? [[role, scope] as [RoleKey, AssignmentScope]] : []), ...projects.map(([r, id]): [RoleKey, AssignmentScope] => [r, ...project(id)])]
    return {
      ...a,
      assignments: access.map(([r, sc]) => ({ assignmentId: fx(`ASG-2026-${String(++seq).padStart(4, '0')}`), roleId: ROLE_IDS[r], scope: sc, addedBy, addedAt: ago(invitedDaysAgo * 24) })),
      invitedAt: ago(invitedDaysAgo * 24),
      invitationId: a.status === 'PENDING' ? stableId('inv', a.userId) : undefined,
      lastActiveAt: lastActiveHoursAgo === undefined ? undefined : ago(lastActiveHoursAgo),
    }
  })
}

/** The session part of an account. Rights always come from the account itself (services/accessGuard.ts). */
export const actorOf = (a: Pick<UserAccount, 'userId' | 'fullName'>): Actor => ({ userId: a.userId, fullName: a.fullName })

export const USERS: Actor[] = ACCOUNT_SPECS.map(actorOf)

export const userById = (id: string) => USERS.find((u) => u.userId === id)

export const DEFAULT_USER = userById(fx('USR-2026-0012'))! // Ali Bin Ahmad — main reviewer persona in docs/SCENARIOS.md

import type { Actor, UserAccount } from '@/domain/types'

// ---------------------------------------------------------------------------------------------------------------------
// Accounts under the per-project model (DEC-70, DEC-74): the only user list. Emails use the reserved .example domain.
// ---------------------------------------------------------------------------------------------------------------------

type AccountSpec = Omit<UserAccount, 'invitedAt' | 'lastActiveAt'> & { invitedDaysAgo: number; lastActiveHoursAgo?: number }

const ACCOUNT_SPECS: AccountSpec[] = [
  { userId: 'USR-2026-0001', fullName: 'Lim Wei Jie', email: 'weijie.lim@ekyc-platform.example', level: 'PLATFORM_ADMIN', memberships: [], status: 'ACTIVE', invitedDaysAgo: 400, lastActiveHoursAgo: 1 },
  // Atoz Software Tech: owner, a Project Admin for SME app, reviewers, one user with different roles per project.
  { userId: 'USR-2026-0002', fullName: 'Tan Mei Ling', email: 'meiling.tan@atoz.example', level: 'MERCHANT_OWNER', merchantId: 'MER-0001', memberships: [], status: 'ACTIVE', invitedDaysAgo: 400, lastActiveHoursAgo: 2 },
  { userId: 'USR-2026-0012', fullName: 'Ali Bin Ahmad', email: 'ali.ahmad@atoz.example', level: 'MEMBER', merchantId: 'MER-0001', memberships: [{ projectId: 'PRJ-0001', role: 'REVIEWER' }, { projectId: 'PRJ-0002', role: 'VIEWER' }], status: 'ACTIVE', invitedDaysAgo: 300, lastActiveHoursAgo: 1 },
  { userId: 'USR-2026-0020', fullName: 'Hafiz Bin Rahman', email: 'hafiz.rahman@atoz.example', level: 'MEMBER', merchantId: 'MER-0001', memberships: [{ projectId: 'PRJ-0002', role: 'PROJECT_ADMIN' }], status: 'ACTIVE', invitedDaysAgo: 60, lastActiveHoursAgo: 20 },
  { userId: 'USR-2026-0031', fullName: 'Siti Aminah Binti Yusof', email: 'siti.yusof@atoz.example', level: 'MEMBER', merchantId: 'MER-0001', memberships: [{ projectId: 'PRJ-0001', role: 'REVIEWER' }], status: 'ACTIVE', invitedDaysAgo: 280, lastActiveHoursAgo: 1 },
  { userId: 'USR-2026-0033', fullName: 'Nurul Huda Binti Kamaruddin', email: 'nurul.huda@atoz.example', level: 'MEMBER', merchantId: 'MER-0001', memberships: [{ projectId: 'PRJ-0002', role: 'REVIEWER' }], status: 'ACTIVE', invitedDaysAgo: 55, lastActiveHoursAgo: 5 },
  { userId: 'USR-2026-0035', fullName: 'Chong Pei Shan', email: 'peishan.chong@atoz.example', level: 'MEMBER', merchantId: 'MER-0001', memberships: [{ projectId: 'PRJ-0001', role: 'VIEWER' }], status: 'INVITED', invitedDaysAgo: 2 },
  { userId: 'USR-2026-0039', fullName: 'Yap Li Wen', email: 'liwen.yap@atoz.example', level: 'MEMBER', merchantId: 'MER-0001', memberships: [{ projectId: 'PRJ-0001', role: 'REVIEWER' }], status: 'DEACTIVATED', invitedDaysAgo: 200, lastActiveHoursAgo: 40 * 24 },
  // Vantage: owner plus a reviewer.
  { userId: 'USR-2026-0045', fullName: 'Ahmad Faiz Bin Zulkifli', email: 'faiz.zulkifli@vantage.example', level: 'MERCHANT_OWNER', merchantId: 'MER-0002', memberships: [], status: 'ACTIVE', invitedDaysAgo: 400, lastActiveHoursAgo: 30 },
  { userId: 'USR-2026-0044', fullName: 'Kavitha A/P Subramaniam', email: 'kavitha.s@vantage.example', level: 'MEMBER', merchantId: 'MER-0002', memberships: [{ projectId: 'PRJ-0003', role: 'REVIEWER' }], status: 'ACTIVE', invitedDaysAgo: 380, lastActiveHoursAgo: 3 },
  // One person each for the smaller merchants.
  { userId: 'USR-2026-0052', fullName: 'Wong Kah Heng', email: 'kahheng.wong@tesla.example', level: 'MERCHANT_OWNER', merchantId: 'MER-0003', memberships: [], status: 'ACTIVE', invitedDaysAgo: 300, lastActiveHoursAgo: 6 },
  { userId: 'USR-2026-0063', fullName: 'Farah Binti Ismail', email: 'farah.ismail@boring.example', level: 'MEMBER', merchantId: 'MER-0004', memberships: [{ projectId: 'PRJ-0005', role: 'PROJECT_ADMIN' }], status: 'ACTIVE', invitedDaysAgo: 300, lastActiveHoursAgo: 8 },
  { userId: 'USR-2026-0071', fullName: 'Ng Chee Keong', email: 'cheekeong.ng@3nova.example', level: 'MERCHANT_OWNER', merchantId: 'MER-0005', memberships: [], status: 'ACTIVE', invitedDaysAgo: 250, lastActiveHoursAgo: 12 },
  { userId: 'USR-2026-0080', fullName: 'Rajesh A/L Muthu', email: 'rajesh.muthu@emptydemo.example', level: 'MERCHANT_OWNER', merchantId: 'MER-0006', memberships: [], status: 'ACTIVE', invitedDaysAgo: 20, lastActiveHoursAgo: 48 },
]

export function buildAccounts(now: Date): UserAccount[] {
  const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString()
  return ACCOUNT_SPECS.map(({ invitedDaysAgo, lastActiveHoursAgo, ...a }) => ({
    ...a,
    invitedAt: ago(invitedDaysAgo * 24),
    lastActiveAt: lastActiveHoursAgo === undefined ? undefined : ago(lastActiveHoursAgo),
  }))
}

/**
 * The legacy two-role view of an account, for the screens not yet moved to per-project roles (until Phase 11). Services
 * never trust it: they read what the user may do from the account (services/accessGuard.ts).
 */
export function legacyActor(a: Pick<UserAccount, 'userId' | 'fullName' | 'level' | 'merchantId'>): Actor {
  return a.level === 'PLATFORM_ADMIN'
    ? { userId: a.userId, fullName: a.fullName, role: 'PLATFORM_ADMIN' }
    : { userId: a.userId, fullName: a.fullName, role: 'MERCHANT_REVIEWER', merchantId: a.merchantId }
}

export const USERS: Actor[] = ACCOUNT_SPECS.map(legacyActor)

export const userById = (id: string) => USERS.find((u) => u.userId === id)

export const DEFAULT_USER = userById('USR-2026-0012')! // Ali Bin Ahmad — main reviewer persona in docs/SCENARIOS.md

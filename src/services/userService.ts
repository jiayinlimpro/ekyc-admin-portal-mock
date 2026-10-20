// User directory API (mock), read-only: the signed-in account and the names used by filters. Managing access: accessAdminService.
//   GET /me                            → 200 UserAccount (the signed-in user's level and project roles)
//   GET /users                         → 200 UserSummary[]
//   GET /users?canClaim=true&project=… → 200 UserSummary[]
import { canInProject } from '@/domain/access'
import type { AccessLevel, Actor, ClaimHolder, UserAccount } from '@/domain/types'
import { db } from '@/mocks/mockDb'
import { accountOf, projectIdsWhere } from './accessGuard'
import { simulateNetwork, wire } from './network'

export type UserSummary = ClaimHolder & { level: AccessLevel; merchantId?: string }

export interface UserService {
  /** The signed-in user's account: the UI decides what to show from it (DEC-71); services check it again. */
  me(actor: Actor): Promise<UserAccount>
  /**
   * Active users who may claim cases (DEC-70), limited to projects whose cases the actor can see; one project when given.
   * Platform Admins never claim.
   */
  listReviewers(actor: Actor, projectId?: string): Promise<UserSummary[]>
  /** Everyone the actor may see: all users for Platform Admin; own-merchant users (and Platform Admins, as audit actors) otherwise. */
  list(actor: Actor): Promise<UserSummary[]>
}

const summary = (a: UserAccount): UserSummary => ({ userId: a.userId, fullName: a.fullName, level: a.level, merchantId: a.merchantId })

export const mockUserService: UserService = {
  async me(actor) {
    await simulateNetwork('me')
    return wire(accountOf(actor))
  },

  async listReviewers(actor, projectId) {
    await simulateNetwork('list reviewers')
    const visible = projectIdsWhere(actor, 'viewCases')
    const projects = db.state().projects.filter((p) => visible.has(p.projectId) && (!projectId || p.projectId === projectId))
    return wire(
      db
        .state()
        .accounts.filter((a) => a.status === 'ACTIVE' && projects.some((p) => canInProject(a, 'claimCase', p)))
        .map(summary),
    )
  },

  async list(actor) {
    await simulateNetwork('list users')
    const me = accountOf(actor)
    return wire(
      db
        .state()
        .accounts.filter((a) => me.level === 'PLATFORM_ADMIN' || a.level === 'PLATFORM_ADMIN' || a.merchantId === me.merchantId)
        .map(summary),
    )
  },
}

export const userService: UserService = mockUserService

// User directory API (mock), read-only part used by filters. Users and Access CRUD comes with its screen (Phase 11).
//   GET /users                         → 200 UserSummary[]
//   GET /users?canClaim=true&project=… → 200 UserSummary[]
import { canInProject } from '@/domain/access'
import type { Actor, ClaimHolder } from '@/domain/types'
import { db } from '@/mocks/mockDb'
import { legacyActor } from '@/mocks/fixtures/users'
import { accountOf, projectIdsWhere } from './accessGuard'
import { simulateNetwork, wire } from './network'

export type UserSummary = ClaimHolder & Pick<Actor, 'role' | 'merchantId'>

export interface UserService {
  /**
   * Active users who may claim cases (DEC-70), limited to projects whose cases the actor can see; one project when given.
   * Platform Admins never claim.
   */
  listReviewers(actor: Actor, projectId?: string): Promise<UserSummary[]>
  /** Everyone the actor may see: all users for Platform Admin; own-merchant users (and Platform Admins, as audit actors) otherwise. */
  list(actor: Actor): Promise<UserSummary[]>
}

const summary = (a: Parameters<typeof legacyActor>[0]): UserSummary => legacyActor(a)

export const mockUserService: UserService = {
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

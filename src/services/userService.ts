// User directory API (mock), read-only part used by filters. UAM CRUD comes with the Users screen.
//   GET /users?canReview=true → 200 UserSummary[]
import { can, canAccessMerchant } from '@/domain/permissions'
import type { Actor, ClaimHolder } from '@/domain/types'
import { db } from '@/mocks/mockDb'
import { simulateNetwork, wire } from './network'

export type UserSummary = ClaimHolder & Pick<Actor, 'role' | 'merchantId'>

export interface UserService {
  /** Users who can claim/decide, limited to merchants the actor can see (Platform Admins included per OQ-08). */
  listReviewers(actor: Actor): Promise<UserSummary[]>
  /** Everyone the actor may see: all users for admins; own-merchant users (and admins, as audit actors) for reviewers. */
  list(actor: Actor): Promise<UserSummary[]>
}

export const mockUserService: UserService = {
  async listReviewers(actor) {
    await simulateNetwork('list reviewers')
    return wire(
      db
        .state()
        .users.filter((u) => can(u, 'canReview') && (u.role === 'PLATFORM_ADMIN' || (u.merchantId && canAccessMerchant(actor, u.merchantId))))
        .map(({ userId, fullName, role, merchantId }) => ({ userId, fullName, role, merchantId })),
    )
  },

  async list(actor) {
    await simulateNetwork('list users')
    return wire(
      db
        .state()
        .users.filter((u) => u.role === 'PLATFORM_ADMIN' || (u.merchantId && canAccessMerchant(actor, u.merchantId)))
        .map(({ userId, fullName, role, merchantId }) => ({ userId, fullName, role, merchantId })),
    )
  },
}

export const userService: UserService = mockUserService

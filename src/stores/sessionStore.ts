// Current (fake) signed-in user and the merchant selector. The real build uses Secure HttpOnly session cookies.
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Actor } from '@/domain/types'
import { DEFAULT_USER } from '@/mocks/fixtures/users'

export const ALL_MERCHANTS = 'ALL'

interface SessionStore {
  actor: Actor
  /** Admin merchant selector: a merchantId or ALL_MERCHANTS. Reviewers are always scoped to their own merchant. */
  merchantId: string
  switchUser: (actor: Actor) => void
  selectMerchant: (merchantId: string) => void
}

export const useSession = create<SessionStore>()(
  persist(
    (set) => ({
      actor: DEFAULT_USER,
      merchantId: DEFAULT_USER.merchantId ?? ALL_MERCHANTS,
      switchUser: (actor) => set({ actor, merchantId: actor.merchantId ?? ALL_MERCHANTS }),
      selectMerchant: (merchantId) => set({ merchantId }),
    }),
    // sessionStorage: each browser tab can be a different user, so two tabs can race for a claim (S10).
    { name: 'ekyc-mock-session', storage: createJSONStorage(() => sessionStorage) },
  ),
)

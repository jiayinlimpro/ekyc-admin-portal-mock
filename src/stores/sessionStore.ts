// Current (fake) signed-in user and the selected project. The real build uses Secure HttpOnly session cookies.
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Actor } from '@/domain/types'
import { DEFAULT_USER } from '@/mocks/fixtures/users'

export const ALL_MERCHANTS = 'ALL'
/** "All my projects" in the project switcher (DEC-73). */
export const ALL_PROJECTS = 'ALL'

interface SessionStore {
  actor: Actor
  /** REQ: DEC-73 — the header's project switcher: a projectId or ALL_PROJECTS. */
  projectId: string
  /**
   * Legacy merchant scope for screens not yet on projects: follows the selected project's merchant (ALL_MERCHANTS for
   * "All my projects"). Only Platform Admin can reach more than one merchant.
   */
  merchantId: string
  switchUser: (actor: Actor) => void
  selectProject: (projectId: string, merchantId: string) => void
  selectMerchant: (merchantId: string) => void
}

export const useSession = create<SessionStore>()(
  persist(
    (set) => ({
      actor: DEFAULT_USER,
      projectId: ALL_PROJECTS,
      merchantId: DEFAULT_USER.merchantId ?? ALL_MERCHANTS,
      switchUser: (actor) => set({ actor, projectId: ALL_PROJECTS, merchantId: actor.merchantId ?? ALL_MERCHANTS }),
      selectProject: (projectId, merchantId) => set({ projectId, merchantId }),
      selectMerchant: (merchantId) => set({ merchantId }),
    }),
    // sessionStorage: each browser tab can be a different user, so two tabs can race for a claim (S10).
    { name: 'ekyc-mock-session', storage: createJSONStorage(() => sessionStorage) },
  ),
)

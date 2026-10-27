// Current (fake) signed-in user and the selected project. The real build uses Secure HttpOnly session cookies.
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Actor } from '@/domain/types'
import { DEFAULT_USER } from '@/mocks/fixtures/users'

interface SessionStore {
  actor: Actor
  /** REQ: DEC-109 — the project the inner portal works on (Go to project, the header's switcher); none on the Merchants page. */
  projectId?: string
  switchUser: (actor: Actor) => void
  selectProject: (projectId: string | undefined) => void
}

export const useSession = create<SessionStore>()(
  persist(
    (set) => ({
      actor: DEFAULT_USER,
      projectId: undefined,
      switchUser: (actor) => set({ actor: { userId: actor.userId, fullName: actor.fullName }, projectId: undefined }),
      selectProject: (projectId) => set({ projectId }),
    }),
    // sessionStorage: each browser tab can be a different user, so two tabs can race for a claim (S10).
    // Version 2: no "All my projects" any more (DEC-109); an older session starts again as the default user.
    { name: 'ekyc-mock-session', storage: createJSONStorage(() => sessionStorage), version: 2, migrate: () => ({ actor: DEFAULT_USER, projectId: undefined }) },
  ),
)

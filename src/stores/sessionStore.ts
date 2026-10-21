// Current (fake) signed-in user and the selected project. The real build uses Secure HttpOnly session cookies.
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Actor } from '@/domain/types'
import { DEFAULT_USER } from '@/mocks/fixtures/users'

/** "All my projects" in the project switcher (DEC-73). */
export const ALL_PROJECTS = 'ALL'

interface SessionStore {
  actor: Actor
  /** REQ: DEC-73 — the header's project switcher: a projectId or ALL_PROJECTS. */
  projectId: string
  switchUser: (actor: Actor) => void
  selectProject: (projectId: string) => void
}

export const useSession = create<SessionStore>()(
  persist(
    (set) => ({
      actor: DEFAULT_USER,
      projectId: ALL_PROJECTS,
      switchUser: (actor) => set({ actor: { userId: actor.userId, fullName: actor.fullName }, projectId: ALL_PROJECTS }),
      selectProject: (projectId) => set({ projectId }),
    }),
    // sessionStorage: each browser tab can be a different user, so two tabs can race for a claim (S10).
    // Version 1: internal IDs (DEC-97); an older session's user ID no longer exists, so start again as the default user.
    { name: 'ekyc-mock-session', storage: createJSONStorage(() => sessionStorage), version: 1, migrate: () => ({ actor: DEFAULT_USER, projectId: ALL_PROJECTS }) },
  ),
)

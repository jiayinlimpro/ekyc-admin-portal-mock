// Per-browser UI preferences (not demo data).
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type Theme = 'light' | 'dark'

interface UiStore {
  sidebarCollapsed: boolean
  /** Sidebar groups the user closed (all open by default). */
  closedGroups: string[]
  theme: Theme
  toggleSidebar: () => void
  toggleGroup: (group: string) => void
  openGroup: (group: string) => void
  toggleTheme: () => void
}

export const useUi = create<UiStore>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      closedGroups: [],
      theme: 'light',
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      toggleGroup: (g) => set((s) => ({ closedGroups: s.closedGroups.includes(g) ? s.closedGroups.filter((x) => x !== g) : [...s.closedGroups, g] })),
      openGroup: (g) => set((s) => (s.closedGroups.includes(g) ? { closedGroups: s.closedGroups.filter((x) => x !== g) } : s)),
      toggleTheme: () => set((s) => ({ theme: s.theme === 'light' ? 'dark' : 'light' })),
    }),
    { name: 'ekyc-mock-ui', storage: createJSONStorage(() => localStorage) },
  ),
)

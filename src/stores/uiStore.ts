// Per-browser UI preferences (not demo data).
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type Theme = 'light' | 'dark'

interface UiStore {
  sidebarCollapsed: boolean
  theme: Theme
  toggleSidebar: () => void
  toggleTheme: () => void
}

export const useUi = create<UiStore>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      theme: 'light',
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      toggleTheme: () => set((s) => ({ theme: s.theme === 'light' ? 'dark' : 'light' })),
    }),
    { name: 'ekyc-mock-ui', storage: createJSONStorage(() => localStorage) },
  ),
)

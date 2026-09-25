import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { HOME_TAB, closeTab, openTab, type Tab } from '@/app/tabs'

interface TabsStore {
  tabs: Tab[]
  open: (tab: Tab) => void
  /** Closes a tab; returns where to navigate if the active tab was closed. */
  close: (key: string, activeKey: string) => string | undefined
}

export const useTabs = create<TabsStore>()(
  persist(
    (set, get) => ({
      tabs: [HOME_TAB],
      open: (tab) => {
        const tabs = openTab(get().tabs, tab)
        if (tabs !== get().tabs) set({ tabs })
      },
      close: (key, activeKey) => {
        const r = closeTab(get().tabs, key, activeKey)
        set({ tabs: r.tabs })
        return r.navigateTo
      },
    }),
    // Per browser tab, like the session.
    { name: 'ekyc-mock-tabs', storage: createJSONStorage(() => sessionStorage) },
  ),
)

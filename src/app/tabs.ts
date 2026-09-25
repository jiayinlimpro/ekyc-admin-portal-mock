// Tab strip rules (pure). Home is always first and cannot be closed; at most MAX_TABS tabs.
export interface Tab {
  key: string // pathname
  to: string // pathname + search, so a tab remembers its filters
  title: string
}

export const HOME_TAB: Tab = { key: '/', to: '/', title: 'Home' }
export const MAX_TABS = 10

export function openTab(tabs: Tab[], tab: Tab): Tab[] {
  const base = tabs.length && tabs[0].key === HOME_TAB.key ? tabs : [HOME_TAB, ...tabs]
  if (tab.key === HOME_TAB.key) return base
  const i = base.findIndex((t) => t.key === tab.key)
  if (i >= 0) {
    const current = base[i]
    return current.to === tab.to && current.title === tab.title ? base : base.map((t, j) => (j === i ? tab : t))
  }
  const next = [...base, tab]
  // Over the limit: drop the oldest page tab (never Home, never the one just opened).
  return next.length > MAX_TABS ? [next[0], ...next.slice(2)] : next
}

/** Returns the remaining tabs and, when the active tab was closed, where to go next (left neighbour). */
export function closeTab(tabs: Tab[], key: string, activeKey: string): { tabs: Tab[]; navigateTo?: string } {
  if (key === HOME_TAB.key) return { tabs }
  const i = tabs.findIndex((t) => t.key === key)
  if (i < 0) return { tabs }
  const remaining = tabs.filter((t) => t.key !== key)
  if (key !== activeKey) return { tabs: remaining }
  return { tabs: remaining, navigateTo: (remaining[i - 1] ?? remaining[0] ?? HOME_TAB).to }
}

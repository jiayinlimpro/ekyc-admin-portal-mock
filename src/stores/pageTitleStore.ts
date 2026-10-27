import { create } from 'zustand'

/** A page's own title for the breadcrumb, e.g. the case page shows the merchant's Reference ID (DEC-97). Not persisted. */
interface PageTitleStore {
  titles: Record<string, string> // pathname → title
  setTitle: (pathname: string, title: string) => void
}

export const usePageTitle = create<PageTitleStore>()((set) => ({
  titles: {},
  setTitle: (pathname, title) => set((s) => (s.titles[pathname] === title ? s : { titles: { ...s.titles, [pathname]: title } })),
}))

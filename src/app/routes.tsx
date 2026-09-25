import type { ComponentType } from 'react'
import type { RouteObject } from 'react-router'
import { AppShell } from '@/components/layout/AppShell'
import { HomePage } from '@/pages/HomePage'
import { NotFoundPage, RouteErrorPage } from '@/pages/StatusPages'
import { VerificationsListPage } from '@/pages/verifications/VerificationsListPage'
import { Guarded } from './Guarded'
import { NAV_ITEMS } from './nav'

/** Built screens by route pattern. Anything missing here renders its placeholder. */
const PAGES: Partial<Record<string, ComponentType>> = {
  '/verifications': VerificationsListPage,
}

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <HomePage /> },
      ...NAV_ITEMS.filter((i) => i.path !== '/').map((item) => ({ path: item.path.slice(1), element: <Guarded item={item} page={PAGES[item.path]} /> })),
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]

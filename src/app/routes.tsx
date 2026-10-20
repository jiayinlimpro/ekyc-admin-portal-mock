import { lazy, type ComponentType } from 'react'
import { Navigate, type RouteObject } from 'react-router'
import { AppShell } from '@/components/layout/AppShell'
import { LoginPage } from '@/pages/LoginPage'
import { NotFoundPage, RouteErrorPage } from '@/pages/StatusPages'
import { Guarded } from './Guarded'
import { NAV_ITEMS } from './nav'
import { LANDING_PATH } from './tabs'

// Route-level code splitting: each screen (and Recharts, for the dashboards) loads when first opened.
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) => lazy(() => load().then((m) => ({ default: m[name] })))

/** Built screens by route pattern. Anything missing here renders its placeholder. */
const PAGES: Partial<Record<string, ComponentType>> = {
  '/projects': page(() => import('@/pages/projects/ProjectsPage'), 'ProjectsPage'),
  '/project-settings': page(() => import('@/pages/projects/ProjectSettingsPage'), 'ProjectSettingsPage'),
  '/flows': page(() => import('@/pages/flows/FlowsListPage'), 'FlowsListPage'),
  '/flows/:flowId': page(() => import('@/pages/flows/FlowDetailPage'), 'FlowDetailPage'),
  '/registry': page(() => import('@/pages/registry/RegistryPage'), 'RegistryPage'),
  '/verifications': page(() => import('@/pages/verifications/VerificationsListPage'), 'VerificationsListPage'),
  '/verifications/:referenceNo': page(() => import('@/pages/verifications/VerificationDetailPage'), 'VerificationDetailPage'),
  '/audit': page(() => import('@/pages/audit/AuditLogsPage'), 'AuditLogsPage'),
  '/dashboard': page(() => import('@/pages/dashboard/OverviewPage'), 'OverviewPage'),
  '/intelligence': page(() => import('@/pages/dashboard/IntelligencePage'), 'IntelligencePage'),
  '/billing': page(() => import('@/pages/billing/BillingPage'), 'BillingPage'),
  '/merchants': page(() => import('@/pages/merchants/MerchantsPage'), 'MerchantsPage'),
  '/uat': page(() => import('@/pages/dev/UatPage'), 'UatPage'),
}

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage />, errorElement: <RouteErrorPage /> },
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <Navigate to={LANDING_PATH} replace /> },
      ...NAV_ITEMS.map((item) => ({ path: item.path.slice(1), element: <Guarded item={item} page={PAGES[item.path]} /> })),
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]

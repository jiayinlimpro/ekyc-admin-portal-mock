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
  '/verifications': page(() => import('@/pages/verifications/VerificationsListPage'), 'VerificationsListPage'),
  '/verifications/:referenceNo': page(() => import('@/pages/verifications/VerificationDetailPage'), 'VerificationDetailPage'),
  '/workflow': page(() => import('@/pages/config/WorkflowConfigPage'), 'WorkflowConfigPage'),
  '/workflow-directory': page(() => import('@/pages/directory/WorkflowDirectoryPage'), 'WorkflowDirectoryPage'),
  '/audit': page(() => import('@/pages/audit/AuditLogsPage'), 'AuditLogsPage'),
  '/dashboard': page(() => import('@/pages/dashboard/OverviewPage'), 'OverviewPage'),
  '/intelligence': page(() => import('@/pages/dashboard/IntelligencePage'), 'IntelligencePage'),
  '/billing': page(() => import('@/pages/billing/BillingPage'), 'BillingPage'),
  '/uam/merchants': page(() => import('@/pages/uam/MerchantsPage'), 'MerchantsPage'),
  '/uam/roles': page(() => import('@/pages/uam/RolesPage'), 'RolesPage'),
  '/uam/users': page(() => import('@/pages/uam/UsersPage'), 'UsersPage'),
  '/developers': page(() => import('@/pages/developers/DevelopersPage'), 'DevelopersPage'),
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

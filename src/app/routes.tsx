import { lazy, type ComponentType } from 'react'
import { Navigate, type RouteObject } from 'react-router'
import { AppShell } from '@/components/layout/AppShell'
import { LoginPage } from '@/pages/LoginPage'
import { NotFoundPage, RouteErrorPage } from '@/pages/StatusPages'
import { Guarded } from './Guarded'
import { NAV_ITEMS } from './nav'

// Route-level code splitting: each screen (and Recharts, for the dashboards) loads when first opened.
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) => lazy(() => load().then((m) => ({ default: m[name] })))

/** Built screens by route pattern. Anything missing here renders its placeholder. */
const PAGES: Partial<Record<string, ComponentType>> = {
  // REQ: DEC-109 — outer layer.
  '/': page(() => import('@/pages/home/MerchantsHomePage'), 'MerchantsHomePage'),
  '/merchants/:merchantId': page(() => import('@/pages/merchants/MerchantSettingsPage'), 'MerchantSettingsPage'),
  '/platform-staff': page(() => import('@/pages/platform/PlatformStaffPage'), 'PlatformStaffPage'),
  '/registry': page(() => import('@/pages/registry/RegistryPage'), 'RegistryPage'),
  '/uat': page(() => import('@/pages/dev/UatPage'), 'UatPage'),
  // Inner layer: one project.
  '/dashboard': page(() => import('@/pages/dashboard/OverviewPage'), 'OverviewPage'),
  '/intelligence': page(() => import('@/pages/dashboard/IntelligencePage'), 'IntelligencePage'),
  '/billing': page(() => import('@/pages/billing/BillingPage'), 'BillingPage'),
  '/verifications': page(() => import('@/pages/verifications/VerificationsListPage'), 'VerificationsListPage'),
  '/verifications/:caseId': page(() => import('@/pages/verifications/VerificationDetailPage'), 'VerificationDetailPage'),
  '/flows': page(() => import('@/pages/flows/FlowsListPage'), 'FlowsListPage'),
  '/flows/:flowId': page(() => import('@/pages/flows/FlowDetailPage'), 'FlowDetailPage'),
  '/members': page(() => import('@/pages/projects/ProjectAccessPages'), 'MembersPage'),
  '/project-roles': page(() => import('@/pages/projects/ProjectAccessPages'), 'ProjectRolesPage'),
  '/audit': page(() => import('@/pages/audit/AuditLogsPage'), 'AuditLogsPage'),
  '/project-settings': page(() => import('@/pages/projects/ProjectSettingsPage'), 'ProjectSettingsPage'),
}

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage />, errorElement: <RouteErrorPage /> },
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [
      ...NAV_ITEMS.map((item) => (item.path === '/' ? { index: true, element: <Guarded item={item} page={PAGES[item.path]} /> } : { path: item.path.slice(1), element: <Guarded item={item} page={PAGES[item.path]} /> })),
      // REQ: DEC-110 — the Super admins screen is gone; old links land on Platform staff.
      { path: 'admins', element: <Navigate to="/platform-staff" replace /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]

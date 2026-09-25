// Single source for the sidebar, breadcrumb, tab titles, permission guard and placeholder pages.
// Menu grouping is a best guess at the old Axure menu (minus Manual Review Queue, DEC-80) — reorder freely.
import { matchPath } from 'react-router'
import {
  Activity,
  BookOpen,
  Building2,
  ClipboardList,
  Code,
  FileSearch,
  Home,
  KeyRound,
  LayoutDashboard,
  ReceiptText,
  ScanFace,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { Permission } from '@/domain/permissions'

export const NAV_GROUPS = ['Dashboards', 'eKYC', 'Governance', 'Access Management', 'Developers'] as const
export type NavGroup = (typeof NAV_GROUPS)[number]

export interface NavItem {
  path: string // route pattern
  label: string
  icon: LucideIcon
  group?: NavGroup // undefined = top level (Home) or not in the menu
  inMenu: boolean
  permission?: Permission
  priority: 'P0' | 'P1' | 'P2' | 'P3'
  built: boolean
  /** Rules the screen must follow — shown on its placeholder until it is built. */
  notes: string[]
}

export const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Home', icon: Home, inMenu: true, priority: 'P0', built: true, notes: [] },
  {
    path: '/dashboard',
    label: 'Overview',
    icon: LayoutDashboard,
    group: 'Dashboards',
    inMenu: true,
    priority: 'P2',
    built: true,
    notes: ['4 statuses only (DEC-01).', '3 KPI cards; Auto-Clear = APPROVED with Last Updated By = SYSTEM (DEC-14).', 'No Drop-off KPI (DEC-81).'],
  },
  {
    path: '/intelligence',
    label: 'System Intelligence',
    icon: Activity,
    group: 'Dashboards',
    inMenu: true,
    priority: 'P2',
    built: true,
    notes: ['Retry KPI counts user retakes only (DEC-18).', 'Charts show two threshold lines: Auto-Pass and Auto-Reject (DEC-11).'],
  },
  {
    path: '/verifications',
    label: 'Verifications',
    icon: ScanFace,
    group: 'eKYC',
    inMenu: true,
    priority: 'P0',
    built: true,
    notes: [
      'Filters: Reference No, Full Name, Status (4 only), Merchant, Submitted date range, Risk Level, Claimed By, Last Updated By (SYSTEM / Manual).',
      'Columns include Claimed By with countdown; claim is not a status (DEC-20).',
      'No NRIC, no client metadata in the list (DEC-40).',
    ],
  },
  {
    path: '/verifications/:referenceNo',
    label: 'Verification Detail',
    icon: FileSearch,
    group: 'eKYC',
    inMenu: false,
    priority: 'P0',
    built: true,
    notes: [
      'Opening writes a PII_VIEW audit entry; full unmasked PII + client metadata (DEC-41).',
      'Claim bar: Assign to me / Cancel / countdown. Viewing is never blocked (DEC-25).',
      'Decision overlay only for the claim owner on PENDING_REVIEW; PROCESSING is read-only; decisions are final (DEC-30, DEC-32, DEC-33).',
      'Metrics grouped by phase; Risk panel for V4 only (DEC-10, DEC-13).',
    ],
  },
  {
    path: '/workflow',
    label: 'eKYC Workflow',
    icon: SlidersHorizontal,
    group: 'eKYC',
    inMenu: true,
    permission: 'canConfigureWorkflow',
    priority: 'P0',
    built: true,
    notes: [
      'Configured per phase, not per metric: Auto-Pass, Auto-Reject, max attempts, cooldown (DEC-50).',
      'Active Production Baseline (read-only) vs Staging Canvas (draft); Risk settings for V4 only.',
      'Save Draft / Discard / Deploy, all audited; applies to new sessions only (DEC-51, DEC-52).',
    ],
  },
  {
    path: '/workflow-directory',
    label: 'Merchant Workflow Directory',
    icon: BookOpen,
    group: 'eKYC',
    inMenu: true,
    permission: 'canViewAllMerchants',
    priority: 'P1',
    built: true,
    notes: ['Links each merchant to its workflow version; V4 adds the Risk Assessment phase.'],
  },
  {
    path: '/audit',
    label: 'Audit Logs',
    icon: ClipboardList,
    group: 'Governance',
    inMenu: true,
    permission: 'canViewAudit',
    priority: 'P1',
    built: true,
    notes: ['Events: PII_VIEW, CLAIM, CLAIM_RELEASE, CLAIM_TIMEOUT, DECISION, OWNERSHIP_CONFLICT, CONFIG_DRAFT_SAVE, CONFIG_DISCARD, CONFIG_DEPLOY, CREDENTIAL_ROTATION (DEC-42).'],
  },
  {
    path: '/billing',
    label: 'Billing',
    icon: ReceiptText,
    group: 'Governance',
    inMenu: true,
    permission: 'canViewBilling',
    priority: 'P2',
    built: true,
    notes: ['Every verification is charged on entry; column "Verification Status" (DEC-60).', '"Cost of Retries" depends on OQ-07 (per-attempt charging).'],
  },
  {
    path: '/uam/merchants',
    label: 'Merchants',
    icon: Building2,
    group: 'Access Management',
    inMenu: true,
    permission: 'canManageUAM',
    priority: 'P3',
    built: true,
    notes: ['Standard CRUD.'],
  },
  {
    path: '/uam/roles',
    label: 'Roles',
    icon: KeyRound,
    group: 'Access Management',
    inMenu: true,
    permission: 'canManageUAM',
    priority: 'P3',
    built: true,
    notes: ['2 roles only: Platform Admin and Merchant Reviewer (DEC-70).'],
  },
  {
    path: '/uam/users',
    label: 'Users',
    icon: Users,
    group: 'Access Management',
    inMenu: true,
    permission: 'canManageUAM',
    priority: 'P3',
    built: true,
    notes: ['Standard CRUD.'],
  },
  {
    path: '/developers',
    label: 'Developers',
    icon: Code,
    group: 'Developers',
    inMenu: true,
    permission: 'canRotateKeys',
    priority: 'P3',
    built: true,
    notes: ['Masked fake API key (sk_mock_…) with reveal / copy / rotate; rotation writes CREDENTIAL_ROTATION.', 'Webhooks: "On hold" placeholder (DEC-82).'],
  },
]

export interface RouteMeta {
  item: NavItem
  title: string // tab title: the Reference No on the detail page
}

export function routeMetaFor(pathname: string): RouteMeta | undefined {
  for (const item of NAV_ITEMS) {
    const m = matchPath({ path: item.path, end: true }, pathname)
    if (m) return { item, title: m.params.referenceNo ?? item.label }
  }
  return undefined
}

// Single source for the sidebar, breadcrumb, page titles, permission guard and placeholder pages.
// Menu grouping is a best guess at the old Axure menu (minus Manual Review Queue, DEC-80) — reorder freely.
import { matchPath } from 'react-router'
import {
  Activity,
  Building2,
  ClipboardList,
  FileSearch,
  FlaskConical,
  Gauge,
  GitBranch,
  Library,
  ScrollText,
  Settings,
  Settings2,
  UserCog,
  UsersRound,
  LayoutDashboard,
  ReceiptText,
  ScanFace,
  type LucideIcon,
} from 'lucide-react'
import type { AccessRule } from './access'

// REQ: DEC-109 — two layers, like Langfuse. Outer: the Merchants page (merchants and their projects), Merchant settings
// and the platform modules. Inner: today's portal on ONE project (Go to project), its menu filtered by the user's role there.
// REQ: DEC-99 — screens whose parts need different permissions open for any of them; each part checks its own.
export const PROJECT_SETTINGS_ACTIONS = ['viewProjectSettings', 'viewIntegration', 'viewRouting'] as const

export const NAV_GROUPS = ['Dashboards', 'eKYC', 'User Management', 'Governance', 'Platform'] as const
export type NavGroup = (typeof NAV_GROUPS)[number]

/** The icon on each group's header; a collapsed sidebar shows only these, with the group's screens in a flyout (DEC-103). */
export const NAV_GROUP_ICONS: Record<NavGroup, LucideIcon> = {
  Dashboards: Gauge,
  eKYC: ScanFace,
  'User Management': UsersRound,
  Governance: ScrollText,
  Platform: Settings,
}

/** REQ: DEC-109 — outer = the Merchants page and the platform modules; inner = inside one project. */
export type NavLayer = 'outer' | 'inner'

export interface NavItem {
  path: string // route pattern
  label: string
  icon: LucideIcon
  layer: NavLayer
  group?: NavGroup // undefined = top-level (Merchants) or not in a menu group (mock-only pages)
  inMenu: boolean
  /** The screen it is opened from (path): the breadcrumb shows it, and its menu entry stays highlighted. */
  parent?: string
  /** REQ: DEC-72 / DEC-73 — the menu and the page guard both use it; services check again. */
  access?: AccessRule
  priority: 'P0' | 'P1' | 'P2' | 'P3'
  built: boolean
  /** Rules the screen must follow — shown on its placeholder until it is built. */
  notes: string[]
}

export const NAV_ITEMS: NavItem[] = [
  // REQ: DEC-109 — outer layer. `/` is the Merchants page; /uat is mock-only, opened from the Dev menu.
  {
    path: '/',
    label: 'Merchants',
    icon: Building2,
    layer: 'outer',
    inMenu: true,
    priority: 'P0',
    built: true,
    notes: ['One row per merchant, its projects as cards: Go to project, ⚙ Project Settings; row: Merchant settings, Users, New project (DEC-109).'],
  },
  {
    path: '/merchants/:merchantId',
    label: 'Merchant settings',
    icon: Building2,
    layer: 'outer',
    inMenu: false,
    parent: '/',
    priority: 'P1',
    built: true,
    notes: ['Tabs: General (details, edit, status) · Users · Roles · Billing · Audit log, for the whole merchant (DEC-109).'],
  },
  {
    path: '/platform-staff',
    label: 'Platform staff',
    icon: UsersRound,
    layer: 'outer',
    group: 'Platform',
    inMenu: true,
    access: { platform: 'manageStaff' },
    priority: 'P2',
    built: true,
    notes: ['Platform staff (one platform role each, every merchant) and the platform roles (DEC-99, DEC-104); the one super admin is listed read-only (DEC-110).'],
  },
  {
    path: '/registry',
    label: 'Workflow Registry',
    icon: Library,
    layer: 'outer',
    group: 'Platform',
    inMenu: true,
    access: { platform: 'viewRegistry' },
    priority: 'P1',
    built: true,
    notes: ['Draft, Internal testing, Limited release, Active, Deprecated; default for new merchants; flows using each version (DEC-56 … DEC-58).'],
  },
  { path: '/uat', label: 'UAT scenarios', icon: FlaskConical, layer: 'outer', inMenu: false, priority: 'P0', built: true, notes: ['Mock only. Not part of the real portal.'] },
  // REQ: DEC-109 — inner layer: one project, every screen shows its data only.
  {
    path: '/dashboard',
    label: 'Overview',
    icon: LayoutDashboard,
    layer: 'inner',
    group: 'Dashboards',
    inMenu: true,
    access: { project: 'viewDashboards' },
    priority: 'P2',
    built: true,
    notes: ['4 statuses only (DEC-01).', '3 KPI cards; Auto-Clear = APPROVED with Last Updated By = SYSTEM (DEC-14).', 'No Drop-off KPI (DEC-81).'],
  },
  {
    path: '/intelligence',
    label: 'System Intelligence',
    icon: Activity,
    layer: 'inner',
    group: 'Dashboards',
    inMenu: true,
    access: { project: 'viewDashboards' },
    priority: 'P2',
    built: true,
    notes: ['Retries per phase (DEC-108).', 'Charts show two threshold lines: Auto-Pass and Auto-Reject (DEC-11).'],
  },
  {
    path: '/billing',
    label: 'Billing',
    icon: ReceiptText,
    layer: 'inner',
    group: 'Dashboards',
    inMenu: true,
    access: { project: 'viewBilling' }, // every role, data scoped (DEC-86)
    priority: 'P2',
    built: true,
    notes: ['Tokens per document, V1 selfie and liveness submission (DEC-60); this project only (DEC-109).'],
  },
  {
    path: '/verifications',
    label: 'Verifications',
    icon: ScanFace,
    layer: 'inner',
    group: 'eKYC',
    inMenu: true,
    access: { project: 'viewCases' },
    priority: 'P0',
    built: true,
    notes: [
      'Filters: flow, workflow version, status, claim state, risk, created range, Last Updated By; search Reference ID and Full Name (DEC-43).',
      'Default view: Pending Review, oldest first. Columns per DEC-40; claim is not a status (DEC-20).',
      'No NRIC, no client metadata, no duplicate-user information in the list (DEC-40).',
    ],
  },
  {
    path: '/verifications/:caseId',
    label: 'Verification Detail',
    icon: FileSearch,
    layer: 'inner',
    group: 'eKYC',
    inMenu: false,
    parent: '/verifications',
    access: { project: 'viewCaseDetails' }, // REQ: DEC-104 — View details; View list alone stays on the list
    priority: 'P0',
    built: true,
    notes: [
      'Needs View details (DEC-104). Opening writes a SENSITIVE_PII_VIEW audit entry; full PII + client metadata (DEC-41).',
      'Claim bar: Assign to me / Cancel / countdown. Viewing is never blocked (DEC-25).',
      'Decision only for the claim owner on PENDING_REVIEW (DEC-30, DEC-31, DEC-106).',
      'Sections per DEC-105: evidence, extracted data, checks (face match, liveness, duplicate user), risk, telemetry, attempts, rules applied.',
    ],
  },
  {
    path: '/flows',
    label: 'Flows',
    icon: GitBranch,
    layer: 'inner',
    group: 'eKYC',
    inMenu: true,
    access: { project: 'viewFlows' },
    priority: 'P0',
    built: true,
    notes: ['Draft, Active, Retiring, Inactive; one default per project; create, duplicate, set default, activate, retire (DEC-94).'],
  },
  {
    path: '/flows/:flowId',
    label: 'Flow Detail',
    icon: GitBranch,
    layer: 'inner',
    group: 'eKYC',
    inMenu: false,
    parent: '/flows',
    access: { project: 'viewFlows' },
    priority: 'P0',
    built: true,
    notes: ['Low / Standard / High presets with a 0–100 band bar; Advanced for Super admin only; retries per phase (DEC-19, DEC-108).'],
  },
  {
    // REQ: DEC-77 / DEC-109 — in the project's sidebar, no longer a Project Settings tab.
    path: '/members',
    label: 'Members',
    icon: UserCog,
    layer: 'inner',
    group: 'User Management',
    inMenu: true,
    access: { project: 'viewMembers' },
    priority: 'P1',
    built: true,
    notes: ['Everyone with access to this project; project roles are given here (merchant-role users listed as inherited).'],
  },
  {
    // REQ: DEC-104 / DEC-109 — this project's role table, in the project's sidebar.
    path: '/project-roles',
    label: 'Roles',
    icon: UsersRound,
    layer: 'inner',
    group: 'User Management',
    inMenu: true,
    access: { project: 'viewProjectRoles' },
    priority: 'P1',
    built: true,
    notes: ['System Default project roles and this project’s Custom roles; New role, Duplicate from another project.'],
  },
  {
    path: '/audit',
    label: 'Audit Logs',
    icon: ClipboardList,
    layer: 'inner',
    group: 'Governance',
    inMenu: true,
    access: { project: 'viewAudit' },
    priority: 'P1',
    built: true,
    notes: ['Events: DEC-42 names, with the actor role; this project only (the whole merchant is in Merchant settings, DEC-109).'],
  },
  {
    path: '/project-settings',
    label: 'Project Settings',
    icon: Settings2,
    layer: 'inner',
    inMenu: true,
    access: { project: PROJECT_SETTINGS_ACTIONS },
    priority: 'P1',
    built: true,
    notes: ['Tabs: General (name, rename, archive) · Integration · Review operations · Routing (read-only) (DEC-54). Members and Roles are in the sidebar (DEC-109).'],
  },
]

export interface RouteMeta {
  item: NavItem
  title: string // page title (the case page shows its Reference ID in the breadcrumb, DEC-97)
}

/** The screens above an item, top first: Flow Detail → [Projects, Flows] (breadcrumb, menu highlight). */
export function parentsOf(item: NavItem): NavItem[] {
  const parent = item.parent && NAV_ITEMS.find((i) => i.path === item.parent)
  return parent ? [...parentsOf(parent), parent] : []
}

export function routeMetaFor(pathname: string): RouteMeta | undefined {
  for (const item of NAV_ITEMS) {
    const m = matchPath({ path: item.path, end: true }, pathname)
    // The case page renames its tab to the Reference ID once loaded (DEC-97: the URL has the case ID).
    if (m) return { item, title: item.label }
  }
  return undefined
}

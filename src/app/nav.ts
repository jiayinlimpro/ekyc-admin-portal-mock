// Single source for the sidebar, breadcrumb, tab titles, permission guard and placeholder pages.
// Menu grouping is a best guess at the old Axure menu (minus Manual Review Queue, DEC-80) — reorder freely.
import { matchPath } from 'react-router'
import {
  Activity,
  Building2,
  ClipboardList,
  FileSearch,
  FlaskConical,
  FolderKanban,
  Gauge,
  GitBranch,
  Library,
  Settings,
  Settings2,
  ShieldCheck,
  UserCog,
  UserRound,
  Users,
  LayoutDashboard,
  ReceiptText,
  ScanFace,
  type LucideIcon,
} from 'lucide-react'
import type { AccessRule } from './access'

// Most-used first: dashboards (everyone), case review, configuration, then admin-only groups.
// Governance = who may do what (Users, Roles) next to the record of what they did (Audit Logs).
export const NAV_GROUPS = ['Dashboards', 'eKYC', 'Projects & Flows', 'Governance', 'Platform'] as const
export type NavGroup = (typeof NAV_GROUPS)[number]

/** The icon on each group's header in the sidebar (the items themselves show their icon only when the sidebar is narrow). */
export const NAV_GROUP_ICONS: Record<NavGroup, LucideIcon> = {
  Dashboards: Gauge,
  eKYC: ClipboardList,
  'Projects & Flows': FolderKanban,
  Governance: UserRound,
  Platform: Settings,
}

export interface NavItem {
  path: string // route pattern
  label: string
  icon: LucideIcon
  group?: NavGroup // undefined = not in a menu group (mock-only pages)
  inMenu: boolean
  /** REQ: DEC-72 / DEC-73 — the menu and the page guard both use it; services check again. */
  access?: AccessRule
  priority: 'P0' | 'P1' | 'P2' | 'P3'
  built: boolean
  /** Rules the screen must follow — shown on its placeholder until it is built. */
  notes: string[]
}

export const NAV_ITEMS: NavItem[] = [
  // No Home page: `/` redirects to LANDING_PATH (src/app/tabs.ts). /uat is mock-only, opened from the Dev menu.
  { path: '/uat', label: 'UAT scenarios', icon: FlaskConical, inMenu: false, priority: 'P0', built: true, notes: ['Mock only. Not part of the real portal.'] },
  {
    path: '/dashboard',
    label: 'Overview',
    icon: LayoutDashboard,
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
    group: 'Dashboards',
    inMenu: true,
    access: { project: 'viewDashboards' },
    priority: 'P2',
    built: true,
    notes: ['Retry KPI counts user retakes only (DEC-18).', 'Charts show two threshold lines: Auto-Pass and Auto-Reject (DEC-11).'],
  },
  {
    path: '/billing',
    label: 'Billing',
    icon: ReceiptText,
    group: 'Dashboards',
    inMenu: true,
    access: { project: 'viewDashboards' }, // every role, data scoped (DEC-86)
    priority: 'P2',
    built: true,
    notes: ['Every verification is charged on entry; column "Verification Status" (DEC-60).', '"Cost of Retries" depends on OQ-07 (per-attempt charging).'],
  },
  {
    path: '/verifications',
    label: 'Verifications',
    icon: ScanFace,
    group: 'eKYC',
    inMenu: true,
    access: { project: 'viewCases' },
    priority: 'P0',
    built: true,
    notes: [
      'Filters: project, flow, workflow version, status, claim state, risk level, created range, Last Updated By; search Reference ID and Full Name (DEC-43).',
      'Default view: Pending Review in the user projects, oldest first. Columns per DEC-40; claim is not a status (DEC-20).',
      'No NRIC, no client metadata, no duplicate-user information in the list (DEC-40).',
    ],
  },
  {
    path: '/verifications/:referenceNo',
    label: 'Verification Detail',
    icon: FileSearch,
    group: 'eKYC',
    inMenu: false,
    access: { project: 'viewCases' },
    priority: 'P0',
    built: true,
    notes: [
      'Opening writes a SENSITIVE_PII_VIEW audit entry; full unmasked PII + client metadata (DEC-41).',
      'Claim bar: Assign to me / Cancel / countdown. Viewing is never blocked (DEC-25).',
      'Decision only for the claim owner on PENDING_REVIEW: Confirm Manual Pass, or Reject with catalogue reasons; note optional (DEC-30, DEC-31).',
      'Sections per DEC-44: end-user data, ID capture, Selfie (V1), Face match, Liveness, Risk (V4/V5), Rules applied, Activity.',
    ],
  },
  // REQ: DEC-85 — Projects, Project Settings, Flows List, Flow Detail. Settings pages work on the header's project (DEC-96).
  {
    path: '/projects',
    label: 'Projects',
    icon: FolderKanban,
    group: 'Projects & Flows',
    inMenu: true,
    access: { project: 'manageFlows' },
    priority: 'P1',
    built: true,
    notes: ['Create, rename, archive (Platform Admin, Merchant Owner; DEC-93). Archived = no new sessions; cases stay reviewable.'],
  },
  {
    path: '/project-settings',
    label: 'Project Settings',
    icon: Settings2,
    group: 'Projects & Flows',
    inMenu: true,
    access: { project: 'manageFlows' },
    priority: 'P1',
    built: true,
    notes: ['Tabs: General · Integration (API keys, webhook, redirect URLs, origins, IP allowlist) · Review operations (claim timeout) · Routing (read-only) (DEC-54).'],
  },
  {
    path: '/flows',
    label: 'Flows',
    icon: GitBranch,
    group: 'Projects & Flows',
    inMenu: true,
    access: { project: 'manageFlows' },
    priority: 'P0',
    built: true,
    notes: ['Draft, Active, Retiring, Inactive; one default per project; create, duplicate, set default, activate, retire (DEC-94).'],
  },
  {
    path: '/flows/:flowId',
    label: 'Flow Detail',
    icon: GitBranch,
    group: 'Projects & Flows',
    inMenu: false,
    access: { project: 'manageFlows' },
    priority: 'P0',
    built: true,
    notes: ['Low / Standard / High presets with a 0–100 band bar; Advanced for Platform Admin only; retries allowed 1–5 (DEC-18, DEC-19, DEC-50).'],
  },
  {
    path: '/merchants',
    label: 'Merchants',
    icon: Building2,
    group: 'Platform',
    inMenu: true,
    access: { platform: 'manageMerchants' },
    priority: 'P3',
    built: true,
    notes: ['Create (Default project, default flow, first user as Merchant Owner; DEC-92), rename, delete while it has no cases.'],
  },
  {
    path: '/admins',
    label: 'Admins',
    icon: UserCog,
    group: 'Platform',
    inMenu: true,
    access: { platform: 'manageAdmins' },
    priority: 'P2',
    built: true,
    notes: ['Platform Admin accounts only (DEC-79): invite (Pending), resend, suspend / reactivate; no roles; one active admin must remain.'],
  },
  {
    path: '/users',
    label: 'Users',
    icon: Users,
    group: 'Governance',
    inMenu: true,
    access: { project: 'manageUsersRoles' },
    priority: 'P1',
    built: true,
    notes: [
      '[FRS] Users: User ID, Full Name, Email, Merchant (Platform Admin), Access, Status, Created At (DEC-74).',
      'Invite (Pending, Resend invitation), Suspend / Reactivate, never delete. Access table: Role | Scope | Added by | Date.',
    ],
  },
  {
    path: '/roles',
    label: 'Roles',
    icon: ShieldCheck,
    group: 'Governance',
    inMenu: true,
    access: { project: 'manageUsersRoles' },
    priority: 'P1',
    built: true,
    notes: ['[FRS] Roles: grouped permission checkboxes; System Default roles locked; "Affects N users" before saving (DEC-76).'],
  },
  {
    path: '/audit',
    label: 'Audit Logs',
    icon: ClipboardList,
    group: 'Governance',
    inMenu: true,
    access: { project: 'viewAudit' },
    priority: 'P1',
    built: true,
    notes: ['Events: DEC-42 names (cases, flows, projects, integration, users, registry, merchants), with the actor role and project.'],
  },
  {
    path: '/registry',
    label: 'Workflow Registry',
    icon: Library,
    group: 'Platform',
    inMenu: true,
    access: { platform: 'manageRegistry' },
    priority: 'P1',
    built: true,
    notes: ['Draft → Active → Deprecated; default for new merchants; flows using each version (DEC-56 … DEC-58).'],
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

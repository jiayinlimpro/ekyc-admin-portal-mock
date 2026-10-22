import { useEffect } from 'react'
import { NavLink, useLocation } from 'react-router'
import { ChevronDown, ChevronUp, ShieldCheck } from 'lucide-react'
import { useAccess } from '@/app/access'
import { NAV_GROUP_ICONS, NAV_GROUPS, NAV_ITEMS, parentsOf, routeMetaFor, type NavGroup, type NavItem } from '@/app/nav'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useUi } from '@/stores/uiStore'

const LINK = 'flex h-9 items-center gap-3 rounded-md px-3 text-sm text-sidebar-foreground/80 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring'
const ACTIVE = 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'

/** The current screen and the screens it is opened from: Flows highlights Projects (DEC-103). */
function useCurrentPaths(): Set<string> {
  const { pathname } = useLocation()
  const item = routeMetaFor(pathname)?.item
  return new Set(item ? [item.path, ...parentsOf(item).map((i) => i.path)] : [])
}

/** In a wide sidebar, items sit under their group header without an icon; top-level items keep theirs. */
function SidebarLink({ item, nested = false, current }: { item: NavItem; nested?: boolean; current: Set<string> }) {
  const Icon = item.icon
  return (
    <NavLink to={item.path} end={item.path === '/'} className={({ isActive }) => cn(LINK, (isActive || current.has(item.path)) && ACTIVE, nested && 'pl-11')}>
      {!nested && <Icon className="size-4 shrink-0" aria-hidden />}
      <span className="truncate">{item.label}</span>
      {!item.built && (
        <span aria-hidden className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground" title="Not built yet">
          {item.priority}
        </span>
      )}
    </NavLink>
  )
}

/** A top-level item in a narrow sidebar: its icon, with the name as a tooltip. */
function IconLink({ item, current }: { item: NavItem; current: Set<string> }) {
  const Icon = item.icon
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <NavLink to={item.path} aria-label={item.label} className={({ isActive }) => cn(LINK, 'justify-center px-0', (isActive || current.has(item.path)) && ACTIVE)}>
            <Icon className="size-4 shrink-0" aria-hidden />
          </NavLink>
        }
      />
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * REQ: DEC-103 — a narrow sidebar shows one icon per group; hovering it (or clicking, or Enter / arrow keys) opens a flyout
 * to the right with the group's name and its screens. The group of the current screen is highlighted.
 */
function GroupFlyout({ group, items, current }: { group: NavGroup; items: NavItem[]; current: Set<string> }) {
  const Icon = NAV_GROUP_ICONS[group]
  const active = items.some((i) => current.has(i.path))
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        openOnHover
        delay={60}
        closeDelay={150}
        aria-label={group}
        className={cn(LINK, 'h-10 w-full justify-center px-0 data-popup-open:bg-sidebar-accent', active && ACTIVE)}
      >
        <Icon className="size-5 shrink-0" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" sideOffset={10} className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{group}</DropdownMenuLabel>
          {items.map((i) => {
            const ItemIcon = i.icon
            return (
              <DropdownMenuItem key={i.path} render={<NavLink to={i.path} />} className={cn('h-8', current.has(i.path) && 'bg-accent font-medium text-accent-foreground')}>
                <ItemIcon aria-hidden />
                {i.label}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function Sidebar() {
  const access = useAccess()
  const collapsed = useUi((s) => s.sidebarCollapsed)
  // REQ: DEC-73 — the menu follows the user's role in the selected project (UI only — DEC-71).
  const visible = NAV_ITEMS.filter((i) => i.inMenu && access.allows(i.access))
  const top = visible.filter((i) => !i.group)
  const closed = useUi((s) => s.closedGroups)
  const toggleGroup = useUi((s) => s.toggleGroup)
  const openGroup = useUi((s) => s.openGroup)
  const { pathname } = useLocation()
  const current = useCurrentPaths()
  const activeGroup = routeMetaFor(pathname)?.item.group
  // Opening a screen (link, tab, deep link) opens its group, so the current page is always visible in the menu.
  useEffect(() => {
    if (activeGroup) openGroup(activeGroup)
  }, [activeGroup, openGroup])
  const groups = NAV_GROUPS.map((group) => ({ group, items: visible.filter((i) => i.group === group) })).filter((g) => g.items.length > 0)

  return (
    <aside className={cn('flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200', collapsed ? 'w-16' : 'w-60')}>
      <div className={cn('flex h-14 items-center gap-2 border-b border-sidebar-border px-4', collapsed && 'justify-center px-0')}>
        <ShieldCheck className="size-6 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden />
        {!collapsed && (
          <div className="leading-tight">
            <div className="text-sm font-semibold">eKYC Admin</div>
            <div className="text-[11px] text-muted-foreground">Portal · mock</div>
          </div>
        )}
      </div>
      <nav aria-label="Main" className="flex-1 overflow-y-auto p-2">
        {collapsed ? (
          <ul className="space-y-1">
            {top.map((i) => (
              <li key={i.path}>
                <IconLink item={i} current={current} />
              </li>
            ))}
            {groups.map(({ group, items }) => (
              <li key={group}>
                <GroupFlyout group={group} items={items} current={current} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="space-y-1">
            <ul className="space-y-1">
              {top.map((i) => (
                <li key={i.path}>
                  <SidebarLink item={i} current={current} />
                </li>
              ))}
            </ul>
            {groups.map(({ group, items }) => (
              <NavGroupSection key={group} group={group} items={items} current={current} open={!closed.includes(group)} onToggle={() => toggleGroup(group)} />
            ))}
          </div>
        )}
      </nav>
    </aside>
  )
}

/** A group header that only opens and closes its list (it is not a link), with the group's screens underneath. */
function NavGroupSection({ group, items, current, open, onToggle }: { group: NavGroup; items: NavItem[]; current: Set<string>; open: boolean; onToggle: () => void }) {
  const Icon = NAV_GROUP_ICONS[group]
  const id = `nav-${group.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return (
    <section aria-labelledby={`${id}-label`}>
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={onToggle}
          className="flex h-9 w-full items-center gap-3 rounded-md px-3 text-sm font-medium text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <Icon className="size-4 shrink-0" aria-hidden />
          <span id={`${id}-label`} className="truncate">
            {group}
          </span>
          {open ? <ChevronUp className="ml-auto size-4 text-muted-foreground" aria-hidden /> : <ChevronDown className="ml-auto size-4 text-muted-foreground" aria-hidden />}
        </button>
      </h2>
      {open && (
        <ul id={id} className="space-y-0.5 pb-1">
          {items.map((i) => (
            <li key={i.path}>
              <SidebarLink item={i} nested current={current} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

import { useEffect } from 'react'
import { NavLink, useLocation } from 'react-router'
import { ChevronDown, ChevronUp, ShieldCheck } from 'lucide-react'
import { useAccess } from '@/app/access'
import { NAV_GROUP_ICONS, NAV_GROUPS, NAV_ITEMS, routeMetaFor, type NavGroup, type NavItem } from '@/app/nav'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useUi } from '@/stores/uiStore'

/** In a wide sidebar, items sit under their group header without an icon; a narrow sidebar shows only item icons. */
function SidebarLink({ item, collapsed, nested = false }: { item: NavItem; collapsed: boolean; nested?: boolean }) {
  const Icon = item.icon
  const link = (
    <NavLink
      to={item.path}
      end={item.path === '/'}
      aria-label={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          'flex h-9 items-center gap-3 rounded-md px-3 text-sm text-sidebar-foreground/80 outline-none transition-colors',
          'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring',
          isActive && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
          collapsed && 'justify-center px-0',
          nested && !collapsed && 'pl-11',
        )
      }
    >
      {(collapsed || !nested) && <Icon className="size-4 shrink-0" aria-hidden />}
      {!collapsed && <span className="truncate">{item.label}</span>}
      {!collapsed && !item.built && (
        <span aria-hidden className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground" title="Not built yet">
          {item.priority}
        </span>
      )}
    </NavLink>
  )
  if (!collapsed) return link
  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
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
  const activeGroup = routeMetaFor(pathname)?.item.group
  // Opening a screen (link, tab, deep link) opens its group, so the current page is always visible in the menu.
  useEffect(() => {
    if (activeGroup) openGroup(activeGroup)
  }, [activeGroup, openGroup])

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
      <nav aria-label="Main" className={cn('flex-1 overflow-y-auto p-2', collapsed ? 'space-y-4' : 'space-y-1')}>
        <ul className="space-y-1">
          {top.map((i) => (
            <li key={i.path}>
              <SidebarLink item={i} collapsed={collapsed} />
            </li>
          ))}
        </ul>
        {NAV_GROUPS.map((group) => {
          const items = visible.filter((i) => i.group === group)
          if (!items.length) return null
          return <NavGroupSection key={group} group={group} items={items} collapsed={collapsed} open={collapsed || !closed.includes(group)} onToggle={() => toggleGroup(group)} />
        })}
      </nav>
    </aside>
  )
}

/** A group header that only opens and closes its list (it is not a link), with the group's screens underneath. */
function NavGroupSection({ group, items, collapsed, open, onToggle }: { group: NavGroup; items: NavItem[]; collapsed: boolean; open: boolean; onToggle: () => void }) {
  const Icon = NAV_GROUP_ICONS[group]
  const id = `nav-${group.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return (
    <section aria-labelledby={`${id}-label`}>
      {collapsed ? (
        <h2 id={`${id}-label`} className="sr-only">
          {group}
        </h2>
      ) : (
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
      )}
      {open && (
        <ul id={id} className="space-y-0.5 pb-1">
          {items.map((i) => (
            <li key={i.path}>
              <SidebarLink item={i} collapsed={collapsed} nested />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

import { NavLink } from 'react-router'
import { ShieldCheck } from 'lucide-react'
import { useAccess } from '@/app/access'
import { NAV_GROUPS, NAV_ITEMS, type NavItem } from '@/app/nav'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useUi } from '@/stores/uiStore'

function SidebarLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
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
        )
      }
    >
      <Icon className="size-4 shrink-0" aria-hidden />
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
      <nav aria-label="Main" className="flex-1 space-y-4 overflow-y-auto p-2">
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
          return (
            <section key={group} aria-labelledby={`nav-${group}`}>
              <h2 id={`nav-${group}`} className={cn('mb-1 px-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground', collapsed && 'sr-only')}>
                {group}
              </h2>
              <ul className="space-y-1">
                {items.map((i) => (
                  <li key={i.path}>
                    <SidebarLink item={i} collapsed={collapsed} />
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </nav>
    </aside>
  )
}

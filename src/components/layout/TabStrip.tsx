import { Link, useLocation, useNavigate } from 'react-router'
import { X } from 'lucide-react'
import { LANDING_TAB } from '@/app/tabs'
import { cn } from '@/lib/utils'
import { useTabs } from '@/stores/tabsStore'

export function TabStrip() {
  const tabs = useTabs((s) => s.tabs)
  const close = useTabs((s) => s.close)
  const { pathname } = useLocation()
  const navigate = useNavigate()

  const onClose = (key: string) => {
    const next = close(key, pathname)
    if (next) navigate(next)
  }

  return (
    <nav aria-label="Open pages" className="flex h-10 shrink-0 items-end gap-1 overflow-x-auto border-b bg-muted/40 px-3">
      {tabs.map((t) => {
        const active = t.key === pathname
        return (
          <div
            key={t.key}
            className={cn(
              'group flex h-8 max-w-56 shrink-0 items-center rounded-t-md border border-b-0 text-sm',
              active ? 'bg-background font-medium' : 'border-transparent text-muted-foreground hover:bg-background/60',
            )}
          >
            <Link to={t.to} aria-current={active ? 'page' : undefined} className="truncate rounded-t-md px-3 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t.title}
            </Link>
            {t.key !== LANDING_TAB.key && (
              <button
                type="button"
                onClick={() => onClose(t.key)}
                aria-label={`Close ${t.title}`}
                className="mr-1 rounded p-0.5 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            )}
          </div>
        )
      })}
    </nav>
  )
}

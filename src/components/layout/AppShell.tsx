import { useEffect } from 'react'
import { Outlet, useLocation, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { routeMetaFor } from '@/app/nav'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { formatOffset } from '@/lib/format'
import { devService } from '@/services/devService'
import { useDevFlags } from '@/stores/devFlagsStore'
import { useSession } from '@/stores/sessionStore'
import { useTabs } from '@/stores/tabsStore'
import { useUi } from '@/stores/uiStore'
import { Sidebar } from './Sidebar'
import { TabStrip } from './TabStrip'
import { TopBar } from './TopBar'

function MockBanner() {
  const offset = useDevFlags((s) => s.timeOffsetMs)
  return (
    <div role="note" className="shrink-0 bg-amber-100 px-3 py-0.5 text-center text-xs font-medium text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
      MOCK — fake data — not production
      {offset !== 0 && <span className="ml-2 rounded bg-amber-200 px-1.5 dark:bg-amber-500/25">Time warp {formatOffset(offset)}</span>}
    </div>
  )
}

/** Open (or update) a tab for every page visited. */
function useTabTracking() {
  const { pathname, search } = useLocation()
  const open = useTabs((s) => s.open)
  useEffect(() => {
    const meta = routeMetaFor(pathname)
    if (meta) open({ key: pathname, to: pathname + search, title: meta.title })
  }, [pathname, search, open])
}

/** UAT deep links: ?as=USR-2026-0031 signs in as that user, then the parameter is removed. */
function useAsParam() {
  const [params, setParams] = useSearchParams()
  const as = params.get('as')
  const switchUser = useSession((s) => s.switchUser)
  useEffect(() => {
    if (!as) return
    let live = true
    void devService.listUsers().then((users) => {
      if (!live) return
      const u = users.find((x) => x.userId === as)
      if (u) {
        if (useSession.getState().actor.userId !== u.userId) {
          switchUser(u)
          toast.success(`Signed in as ${u.fullName} (from link)`)
        }
      } else {
        toast.error(`Unknown user ${as} in link`)
      }
      setParams(
        (p) => {
          p.delete('as')
          return p
        },
        { replace: true },
      )
    })
    return () => {
      live = false
    }
  }, [as, switchUser, setParams])
}

export function AppShell() {
  const theme = useUi((s) => s.theme)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])
  useTabTracking()
  useAsParam()

  return (
    <TooltipProvider>
      <div className="flex h-screen overflow-hidden bg-background text-foreground">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <MockBanner />
          <TopBar />
          <TabStrip />
          <main className="flex-1 overflow-auto p-6">
            <Outlet />
          </main>
        </div>
      </div>
      <Toaster position="bottom-right" richColors closeButton />
    </TooltipProvider>
  )
}

import { useEffect } from 'react'
import { Outlet, useLocation, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { AccessProvider } from '@/app/access'
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
    if (meta?.item.layer !== 'inner') return
    // A page may have renamed its tab (the case page shows the Reference ID, DEC-97): keep that name.
    const named = useTabs.getState().tabs.find((t) => t.key === pathname)?.title
    if (meta) open({ key: pathname, to: pathname + search, title: named ?? meta.title })
  }, [pathname, search, open])
}

/** UAT deep links: ?as=siti.yusof@atoz.example signs in as that user (the internal user ID works too), then the parameter is removed. */
function useAsParam() {
  const [params, setParams] = useSearchParams()
  const as = params.get('as')
  const switchUser = useSession((s) => s.switchUser)
  useEffect(() => {
    if (!as) return
    let live = true
    void devService.listUsers().then((users) => {
      if (!live) return
      const u = users.find((x) => x.email === as.toLowerCase() || x.userId === as)
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

/** REQ: DEC-109 — links can name the project: ?project=<projectId> selects it (UAT links into a project), then is removed. */
function useProjectParam() {
  const [params, setParams] = useSearchParams()
  const project = params.get('project')
  const selectProject = useSession((s) => s.selectProject)
  useEffect(() => {
    if (!project || params.get('as')) return // sign in first (?as=), then choose the project
    selectProject(project)
    setParams(
      (p) => {
        p.delete('project')
        return p
      },
      { replace: true },
    )
  }, [project, params, selectProject, setParams])
}

export function AppShell() {
  const theme = useUi((s) => s.theme)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])
  useTabTracking()
  useAsParam()
  useProjectParam()
  // REQ: DEC-109 — tabs are for the screens inside a project; the Merchants page and platform modules have none.
  const { pathname } = useLocation()
  const inner = routeMetaFor(pathname)?.item.layer === 'inner'

  return (
    <AccessProvider>
      <TooltipProvider>
        <div className="flex h-screen overflow-hidden bg-background text-foreground">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <MockBanner />
            <TopBar />
            {inner && <TabStrip />}
            <main className="flex-1 overflow-auto p-6">
              <Outlet />
            </main>
          </div>
        </div>
        <Toaster position="bottom-right" richColors closeButton />
      </TooltipProvider>
    </AccessProvider>
  )
}

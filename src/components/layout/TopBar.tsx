import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { Bell, ChevronDown, ChevronRight, FolderKanban, Languages, Maximize, Minimize, Moon, PanelLeft, Search, Sun, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { useAccess } from '@/app/access'
import { canInProject } from '@/domain/access'
import { projectLandingPath } from '@/app/landing'
import { parentsOf, routeMetaFor } from '@/app/nav'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { Merchant } from '@/domain/types'
import { merchantService } from '@/services/merchantService'
import { verificationService } from '@/services/verificationService'
import type { MyProject } from '@/services/projectService'
import { useSession } from '@/stores/sessionStore'
import { useUi } from '@/stores/uiStore'
import { DevMenu } from './DevMenu'
import { usePageTitle } from '@/stores/pageTitleStore'


function IconButton({ label, onClick, children }: { label: string; onClick?: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon" aria-label={label} onClick={onClick}>
            {children}
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Merchant names (a platform user's projects span several merchants). */
function useMerchantNames() {
  const actor = useSession((s) => s.actor)
  const [merchants, setMerchants] = useState<Merchant[]>([])

  useEffect(() => {
    let live = true
    merchantService.list(actor).then(
      (m) => live && setMerchants(m),
      () => live && setMerchants([]),
    )
    return () => {
      live = false
    }
  }, [actor])

  return (id: string) => merchants.find((m) => m.merchantId === id)?.name ?? id
}

/** Role names per project; not for platform users, who have the same rights everywhere. */
function ProjectOption({ p, showRole }: { p: MyProject; showRole: boolean }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className="truncate">{p.name}</span>
      {p.status === 'ARCHIVED' && <span className="rounded bg-muted px-1 text-[10px] uppercase text-muted-foreground">Archived</span>}
      {showRole && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{p.roles.join(', ')}</span>}
    </span>
  )
}

/**
 * REQ: DEC-109 — inside a project the breadcrumb starts with `Merchant ▾ / Project ▾` (like Langfuse). Switching keeps the
 * screen (a detail page goes back to its list); "All merchants" returns to the Merchants page.
 */
function ProjectCrumbs() {
  const { account, projects: all, selected } = useAccess()
  const selectProject = useSession((s) => s.selectProject)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const merchantName = useMerchantNames()
  if (!selected) return null
  // REQ: DEC-77 — archived projects leave the switcher; the current one stays visible.
  const projects = all.filter((p) => p.status !== 'ARCHIVED' || p.projectId === selected.projectId)
  const merchantIds = [...new Set(projects.map((p) => p.merchantId))]
  const item = routeMetaFor(pathname)?.item
  const open = (p: MyProject, toLanding = false) => {
    selectProject(p.projectId)
    if (toLanding) navigate(projectLandingPath(account, p))
    else if (item?.parent) navigate(item.parent) // a flow or a case belongs to the project just left
  }
  const firstOf = (m: string) => projects.filter((p) => p.merchantId === m).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name))[0]
  const trigger = 'flex max-w-56 items-center gap-1 rounded-md px-1.5 py-1 text-sm font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring'
  return (
    <>
      <li className="flex min-w-0 items-center">
        <DropdownMenu>
          <DropdownMenuTrigger aria-label={`Switch merchant. Current: ${merchantName(selected.merchantId)}`} className={trigger}>
            <span className="truncate">{merchantName(selected.merchantId)}</span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-h-[70vh] w-64 overflow-y-auto">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Merchants</DropdownMenuLabel>
              {merchantIds.map((m) => (
                <DropdownMenuItem key={m} onClick={() => m !== selected.merchantId && open(firstOf(m), true)} className={cn(m === selected.merchantId && 'font-medium')}>
                  {merchantName(m)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/')}>All merchants</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </li>
      <li className="flex min-w-0 items-center gap-1">
        <span aria-hidden className="text-muted-foreground">/</span>
        <DropdownMenu>
          <DropdownMenuTrigger aria-label={`Switch project. Current: ${selected.name}`} className={trigger}>
            <FolderKanban className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{selected.name}</span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-h-[70vh] w-72 overflow-y-auto">
            <DropdownMenuRadioGroup value={selected.projectId} onValueChange={(v) => { const p = projects.find((x) => x.projectId === String(v)); if (p && p.projectId !== selected.projectId) open(p) }}>
              {projects
                .filter((p) => p.merchantId === selected.merchantId)
                .map((p) => (
                  <DropdownMenuRadioItem key={p.projectId} value={p.projectId} closeOnClick>
                    <ProjectOption p={p} showRole={account?.level === 'MERCHANT_USER'} />
                  </DropdownMenuRadioItem>
                ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </li>
    </>
  )
}

function Breadcrumb() {
  const { pathname } = useLocation()
  const meta = routeMetaFor(pathname)
  const pageTitle = usePageTitle((s) => s.titles[pathname]) // e.g. the case's Verification ID
  if (!meta) return null
  const inner = meta.item.layer === 'inner'
  // REQ: DEC-109 — outer: Merchants › … ; inner: Merchant ▾ / Project ▾ › group › the screens it is opened from › this screen.
  const parts: { label: string; to?: string }[] = [
    ...(!inner && meta.item.path !== '/' && !meta.item.parent ? [{ label: 'Merchants', to: '/' }] : []),
    ...(meta.item.group && meta.item.group !== meta.title ? [{ label: meta.item.group }] : []),
    ...parentsOf(meta.item).map((i) => ({ label: i.label, to: i.path })),
    { label: pageTitle ?? meta.title },
  ]
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex items-center gap-1 text-sm text-muted-foreground">
        {inner && <ProjectCrumbs />}
        {/* The page's own crumb (e.g. a long Verification ID, DEC-114) truncates first; the crumbs before it keep their width. */}
        {parts.map((p, i) => (
          <li key={i} className={cn('flex items-center gap-1', i === parts.length - 1 ? 'min-w-0 shrink-[100]' : 'shrink-0 whitespace-nowrap')}>
            {(i > 0 || inner) && <ChevronRight className="size-3.5 shrink-0" aria-hidden />}
            {p.to ? (
              <Link to={p.to} className="hover:text-foreground">
                {p.label}
              </Link>
            ) : (
              <span className={i === parts.length - 1 ? 'truncate font-medium text-foreground' : 'truncate'} aria-current={i === parts.length - 1 ? 'page' : undefined} title={i === parts.length - 1 ? p.label : undefined}>
                {p.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

/** REQ: DEC-73 — roles in the current project; on the Merchants page, the roles in each project. */
function RoleLines() {
  const { account, projects, selected } = useAccess()
  if (!account) return null
  if (account.level === 'SUPER_ADMIN') return <div>Super admin · all projects</div>
  if (account.level === 'PLATFORM_STAFF') return <div>{`${[...new Set(account.grants.map((g) => g.roleName))].join(', ') || 'No access'} · platform user`}</div>
  if (selected) return <div>{`${selected.roles.join(', ')} · ${selected.name}`}</div>
  return (
    <>
      {projects.map((p) => (
        <div key={p.projectId}>{`${p.roles.join(', ')} · ${p.name}`}</div>
      ))}
    </>
  )
}

// REQ: DEC-114 — an exact Verification ID opens the case (like Persona's Omnisearch and Stripe's ID search); anything else is
// the merchant's Reference ID (no fixed format): one exact match opens the case, otherwise the list.
const VERIFICATION_ID = /^vrf_[a-z0-9]{24}$/i

function RefSearch() {
  const navigate = useNavigate()
  const actor = useSession((s) => s.actor)
  const { account, inView } = useAccess()
  const [q, setQ] = useState('')
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const v = q.trim()
    if (!v) return
    setQ('')
    if (VERIFICATION_ID.test(v)) return navigate(`/verifications/${v.toLowerCase()}`) // the page checks access (DEC-72: "not found")
    const toList = `/verifications?status=ALL&referenceId=${encodeURIComponent(v)}`
    try {
      // REQ: DEC-109 / DEC-113 — the project in the header: the same Reference ID may have its own case in another project.
      const projectIds = inView.map((p) => p.projectId)
      const exact = (await verificationService.list({ referenceId: v, projectIds, pageSize: 50 }, actor)).items.filter((r) => r.referenceId.toLowerCase() === v.toLowerCase())
      // REQ: DEC-104 — the case opens only for View details; otherwise the list shows it.
      const canOpen = exact.length === 1 && !!account && canInProject(account, 'viewCaseDetails', exact[0])
      navigate(canOpen ? `/verifications/${exact[0].verificationId}` : toList)
    } catch {
      navigate(toList)
    }
  }
  return (
    <form role="search" onSubmit={(e) => void onSubmit(e)} className="relative hidden md:block">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Verification ID or Reference ID" aria-label="Go to Verification ID or Reference ID" className="h-8 w-64 pl-8" />
    </form>
  )
}

function useFullscreen() {
  const [on, setOn] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement)
  useEffect(() => {
    const h = () => setOn(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', h)
    return () => document.removeEventListener('fullscreenchange', h)
  }, [])
  const toggle = () => void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())
  return { on, toggle }
}

export function TopBar() {
  const navigate = useNavigate()
  const toggleSidebar = useUi((s) => s.toggleSidebar)
  const theme = useUi((s) => s.theme)
  const toggleTheme = useUi((s) => s.toggleTheme)
  const actor = useSession((s) => s.actor)
  const { account } = useAccess()
  const fullscreen = useFullscreen()
  const { pathname } = useLocation()
  const inner = routeMetaFor(pathname)?.item.layer === 'inner'
  const mock = (what: string) => () => toast.info(`${what} is not part of the mock.`)

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-3">
      <IconButton label="Toggle sidebar" onClick={toggleSidebar}>
        <PanelLeft aria-hidden />
      </IconButton>
      <div className="min-w-0 flex-1">
        <Breadcrumb />
      </div>
      {inner && <RefSearch />}
      <IconButton label="Notifications (mock)" onClick={mock('Notifications')}>
        <Bell aria-hidden />
      </IconButton>
      <IconButton label={fullscreen.on ? 'Exit full screen' : 'Full screen'} onClick={fullscreen.toggle}>
        {fullscreen.on ? <Minimize aria-hidden /> : <Maximize aria-hidden />}
      </IconButton>
      <IconButton label="Language: EN / BM (mock)" onClick={mock('Language switching')}>
        <Languages aria-hidden />
      </IconButton>
      <IconButton label={theme === 'dark' ? 'Light theme' : 'Dark theme'} onClick={toggleTheme}>
        {theme === 'dark' ? <Sun aria-hidden /> : <Moon aria-hidden />}
      </IconButton>
      <DevMenu />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="sm" aria-label={`Account: ${actor.fullName}`}>
              <span className="flex size-6 items-center justify-center rounded-full bg-blue-600 text-[11px] font-semibold text-white">
                {actor.fullName
                  .split(' ')
                  .filter((w) => /^[A-Z]/i.test(w) && !['BIN', 'BINTI', 'A/L', 'A/P'].includes(w.toUpperCase()))
                  .slice(0, 2)
                  .map((w) => w[0])
                  .join('')
                  .toUpperCase()}
              </span>
              <span className="hidden max-w-36 truncate xl:inline">{actor.fullName}</span>
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-foreground">
              <div className="text-sm font-medium">{actor.fullName}</div>
              <div className="text-xs font-normal text-muted-foreground">{account?.email ?? actor.userId}</div>
              <div className="mt-1 space-y-0.5 text-xs font-normal text-muted-foreground" aria-label="Your role">
                <RoleLines />
              </div>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => navigate('/login')}>
            <UserRound aria-hidden />
            Sign out (mock)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}

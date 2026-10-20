import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { Bell, ChevronDown, ChevronRight, FolderKanban, Languages, Maximize, Minimize, Moon, PanelLeft, Search, Sun, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { useAccess } from '@/app/access'
import { routeMetaFor } from '@/app/nav'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { Merchant } from '@/domain/types'
import { PROJECT_ROLE_LABELS } from '@/lib/labels'
import { merchantService } from '@/services/merchantService'
import type { MyProject } from '@/services/projectService'
import { ALL_PROJECTS, useSession } from '@/stores/sessionStore'
import { useUi } from '@/stores/uiStore'
import { DevMenu } from './DevMenu'

const REF_PATTERN = /^KYC-\d{6}-\d{6}$/i

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

function Breadcrumb() {
  const { pathname } = useLocation()
  const meta = routeMetaFor(pathname)
  if (!meta) return null
  const parts = [meta.item.group !== meta.title ? meta.item.group : undefined, meta.item.path === '/verifications/:referenceNo' ? 'Verifications' : undefined, meta.title].filter(Boolean)
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex items-center gap-1 text-sm text-muted-foreground">
        {parts.map((p, i) => (
          <li key={i} className="flex min-w-0 items-center gap-1">
            {i > 0 && <ChevronRight className="size-3.5 shrink-0" aria-hidden />}
            {p === 'Verifications' && i < parts.length - 1 ? (
              <Link to="/verifications" className="hover:text-foreground">
                {p}
              </Link>
            ) : (
              <span className={i === parts.length - 1 ? 'truncate font-medium text-foreground' : 'truncate'} aria-current={i === parts.length - 1 ? 'page' : undefined}>
                {p}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

/** Merchant names for grouping the switcher (Platform Admin sees projects of several merchants). */
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

/** The role is shown only for project members: Platform Admin and Merchant Owner have the same role everywhere. */
function ProjectOption({ p, showRole }: { p: MyProject; showRole: boolean }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className="truncate">{p.name}</span>
      {p.status === 'ARCHIVED' && <span className="rounded bg-muted px-1 text-[10px] uppercase text-muted-foreground">Archived</span>}
      {showRole && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{PROJECT_ROLE_LABELS[p.role]}</span>}
    </span>
  )
}

// REQ: DEC-73 — the user's projects plus "All my projects" (only with more than one); the current project is always visible.
function ProjectSwitcher() {
  const { ready, account, projects, selected } = useAccess()
  const selectProject = useSession((s) => s.selectProject)
  const merchantName = useMerchantNames()
  if (!ready) return <span className="h-8 w-40 animate-pulse rounded-md bg-muted" aria-hidden />

  const merchantIds = [...new Set(projects.map((p) => p.merchantId))]
  const several = merchantIds.length > 1
  const label = selected?.name ?? (projects.length ? 'All my projects' : 'No projects')
  const sub = selected && several ? merchantName(selected.merchantId) : undefined
  const current = (
    <>
      <FolderKanban className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="max-w-44 truncate">{label}</span>
      {sub && <span className="hidden max-w-32 truncate text-xs text-muted-foreground lg:inline">{sub}</span>}
    </>
  )
  if (projects.length <= 1) {
    return (
      <span className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm" aria-label={`Current project: ${label}`}>
        {current}
      </span>
    )
  }
  const pick = (v: unknown) => {
    const id = String(v)
    if (id === ALL_PROJECTS) return selectProject(ALL_PROJECTS)
    const p = projects.find((x) => x.projectId === id)
    if (p) selectProject(p.projectId)
  }
  const value = selected?.projectId ?? ALL_PROJECTS
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" aria-label={`Switch project. Current: ${label}`}>
            {current}
            <ChevronDown aria-hidden />
          </Button>
        }
      />
      <DropdownMenuContent className="max-h-[70vh] w-80 overflow-y-auto">
        <DropdownMenuRadioGroup value={value} onValueChange={pick}>
          <DropdownMenuRadioItem value={ALL_PROJECTS} closeOnClick>
            All my projects
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {merchantIds.map((m) => (
          <DropdownMenuGroup key={m}>
            <DropdownMenuSeparator />
            {several && <DropdownMenuLabel>{merchantName(m)}</DropdownMenuLabel>}
            <DropdownMenuRadioGroup value={value} onValueChange={pick}>
              {projects
                .filter((p) => p.merchantId === m)
                .map((p) => (
                  <DropdownMenuRadioItem key={p.projectId} value={p.projectId} closeOnClick>
                    <ProjectOption p={p} showRole={account?.level === 'MEMBER'} />
                  </DropdownMenuRadioItem>
                ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** REQ: DEC-73 — role in the current project; under "All my projects", the role in each. */
function RoleLines() {
  const { account, projects, selected } = useAccess()
  if (!account) return null
  if (selected) return <div>{`${PROJECT_ROLE_LABELS[selected.role]} · ${selected.name}`}</div>
  if (account.level !== 'MEMBER') return <div>{`${PROJECT_ROLE_LABELS[account.level]} · all projects`}</div>
  return (
    <>
      {projects.map((p) => (
        <div key={p.projectId}>{`${PROJECT_ROLE_LABELS[p.role]} · ${p.name}`}</div>
      ))}
    </>
  )
}

function RefSearch() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const v = q.trim()
    if (!v) return
    navigate(REF_PATTERN.test(v) ? `/verifications/${v.toUpperCase()}` : `/verifications?referenceNo=${encodeURIComponent(v)}`)
    setQ('')
  }
  return (
    <form role="search" onSubmit={onSubmit} className="relative hidden md:block">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Reference No" aria-label="Go to Reference No" className="h-8 w-52 pl-8" />
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
  const mock = (what: string) => () => toast.info(`${what} is not part of the mock.`)

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-3">
      <IconButton label="Toggle sidebar" onClick={toggleSidebar}>
        <PanelLeft aria-hidden />
      </IconButton>
      <div className="min-w-0 flex-1">
        <Breadcrumb />
      </div>
      <ProjectSwitcher />
      <RefSearch />
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

import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { Bell, Building2, ChevronDown, ChevronRight, Languages, Maximize, Minimize, Moon, PanelLeft, Search, Sun, UserRound } from 'lucide-react'
import { toast } from 'sonner'
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
import { can } from '@/domain/permissions'
import type { Merchant } from '@/domain/types'
import { ROLE_LABELS } from '@/lib/labels'
import { merchantService } from '@/services/merchantService'
import { ALL_MERCHANTS, useSession } from '@/stores/sessionStore'
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

function MerchantSelector() {
  const actor = useSession((s) => s.actor)
  const merchantId = useSession((s) => s.merchantId)
  const selectMerchant = useSession((s) => s.selectMerchant)
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

  const current = merchants.find((m) => m.merchantId === merchantId)
  // Reviewers are always scoped to their own merchant: show it, don't offer a choice.
  if (!can(actor, 'canViewAllMerchants')) {
    return (
      <span className="hidden items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm lg:flex">
        <Building2 className="size-4 text-muted-foreground" aria-hidden />
        {current?.name ?? actor.merchantId}
      </span>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" aria-label="Select merchant">
            <Building2 aria-hidden />
            <span className="max-w-40 truncate">{current ? `${current.name} (${current.workflowVersion})` : 'All merchants'}</span>
            <ChevronDown aria-hidden />
          </Button>
        }
      />
      <DropdownMenuContent className="w-64">
        <DropdownMenuRadioGroup value={merchantId} onValueChange={(v) => selectMerchant(String(v))}>
          <DropdownMenuRadioItem value={ALL_MERCHANTS} closeOnClick>All merchants</DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {merchants.map((m) => (
            <DropdownMenuRadioItem key={m.merchantId} value={m.merchantId} closeOnClick>
              {m.name} <span className="ml-1 text-xs text-muted-foreground">{m.workflowVersion}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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
      <MerchantSelector />
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
              <div className="text-xs font-normal text-muted-foreground">
                {actor.userId} · {ROLE_LABELS[actor.role]}
                {actor.merchantId ? ` · ${actor.merchantId}` : ''}
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

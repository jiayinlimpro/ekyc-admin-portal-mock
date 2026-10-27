// REQ: DEC-109 — the outer layer, like Langfuse's organizations: one row per merchant, its projects as cards. Go to project
// opens the inner portal on that project; ⚙ opens its Project Settings. Platform users see every merchant; a merchant user
// sees their merchant and the projects they can reach.
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Plus, Search, Settings, Users } from 'lucide-react'
import { useAccess } from '@/app/access'
import { projectLandingPath } from '@/app/landing'
import { PROJECT_SETTINGS_ACTIONS } from '@/app/nav'
import { EmptyState, ErrorState } from '@/components/common/States'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { canAnyInProject, canInMerchant, canOnPlatform, type ProjectAction } from '@/domain/access'
import { useLoad } from '@/hooks/useLoad'
import { cn } from '@/lib/utils'
import { merchantService } from '@/services/merchantService'
import type { MyProject } from '@/services/projectService'
import { useSession } from '@/stores/sessionStore'
import { CreateMerchantDialog } from '../merchants/MerchantGeneral'
import { ProjectDialog } from '../projects/ProjectDialog'

/** REQ: DEC-109 — Merchant settings opens for platform users with Merchants View, or anyone who may use one of its tabs. */
const MERCHANT_SETTINGS_ACTIONS: readonly ProjectAction[] = ['viewUsers', 'viewRoles', 'viewBilling', 'viewAudit']

function IconLink({ to, label, children }: { to: string; label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Link to={to} aria-label={label} className={buttonVariants({ variant: 'ghost', size: 'icon' })} />}>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function MerchantsHomePage() {
  const actor = useSession((s) => s.actor)
  const selectProject = useSession((s) => s.selectProject)
  const navigate = useNavigate()
  const access = useAccess()
  const { account, projects } = access
  const merchants = useLoad(() => merchantService.list(actor), [actor.userId])
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState<'merchant' | { merchantId: string }>()

  const query = q.trim().toLowerCase()
  const rows = useMemo(() => {
    const list = (merchants.data ?? []).filter((m) => account?.level !== 'MERCHANT_USER' || m.merchantId === account.merchantId || projects.some((p) => p.merchantId === m.merchantId))
    return list
      .map((m) => {
        const own = projects.filter((p) => p.merchantId === m.merchantId)
        const hit = !query || m.name.toLowerCase().includes(query)
        // Active projects first (Default first), archived last.
        const shown = own
          .filter((p) => hit || p.name.toLowerCase().includes(query))
          .sort((a, b) => Number(a.status === 'ARCHIVED') - Number(b.status === 'ARCHIVED') || Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name))
        return { merchant: m, projects: shown, visible: hit || shown.length > 0 }
      })
      .filter((r) => r.visible)
      .sort((a, b) => a.merchant.name.localeCompare(b.merchant.name))
  }, [merchants.data, projects, account, query])

  const go = (p: MyProject, to?: string) => {
    selectProject(p.projectId)
    navigate(to ?? projectLandingPath(account, p))
  }
  const may = (a: ProjectAction, merchantId: string) => !!account && canInMerchant(account, a, merchantId)

  if (merchants.error && !merchants.data) return <ErrorState message={merchants.error} onRetry={merchants.reload} />
  if (access.error) return <ErrorState message={access.error} onRetry={access.retry} />
  const loading = !access.ready || !merchants.data
  const canCreateMerchant = !!account && canOnPlatform(account, 'createMerchants')

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Merchants</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects" aria-label="Search projects" className="h-9 w-64 pl-8" />
          </div>
          {canCreateMerchant && (
            <Button onClick={() => setCreating('merchant')}>
              <Plus aria-hidden /> New merchant
            </Button>
          )}
        </div>
      </header>

      {loading ? (
        <div className="space-y-4" aria-busy aria-label="Loading merchants">
          {[0, 1].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : account?.level === 'MERCHANT_USER' && !projects.length ? (
        <EmptyState title="You don’t have access to any project yet">Ask an admin of your merchant to add you to a project (Project › Members) or give you a merchant role.</EmptyState>
      ) : !rows.length ? (
        <EmptyState title="No projects match">Try another name.</EmptyState>
      ) : (
        rows.map(({ merchant: m, projects: own }) => {
          const settings = (!!account && canOnPlatform(account, 'viewMerchants')) || MERCHANT_SETTINGS_ACTIONS.some((a) => may(a, m.merchantId))
          return (
            <section key={m.merchantId} aria-labelledby={`m-${m.merchantId}`} className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id={`m-${m.merchantId}`} className="text-lg font-semibold">
                  {m.name}
                </h2>
                <div className="flex items-center gap-1">
                  {settings && (
                    <IconLink to={`/merchants/${m.merchantId}`} label={`Merchant settings of ${m.name}`}>
                      <Settings aria-hidden />
                    </IconLink>
                  )}
                  {may('viewUsers', m.merchantId) && (
                    <IconLink to={`/merchants/${m.merchantId}?tab=users`} label={`Users of ${m.name}`}>
                      <Users aria-hidden />
                    </IconLink>
                  )}
                  {may('createProjects', m.merchantId) && (
                    <Button variant="outline" onClick={() => setCreating({ merchantId: m.merchantId })} aria-label={`New project in ${m.name}`}>
                      <Plus aria-hidden /> New project
                    </Button>
                  )}
                </div>
              </div>
              {own.length ? (
                <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label={`Projects of ${m.name}`}>
                  {own.map((p) => (
                    <li key={p.projectId} className={cn('rounded-lg border bg-card p-4', p.status === 'ARCHIVED' && 'opacity-60')}>
                      <h3 className="truncate font-medium" title={p.status === 'ARCHIVED' ? `${p.name} (archived)` : p.name}>
                        {p.name}
                      </h3>
                      <div className="mt-4 flex items-center gap-1">
                        <Button variant="secondary" onClick={() => go(p)} aria-label={`Go to project ${p.name}`}>
                          Go to project
                        </Button>
                        {!!account && canAnyInProject(account, PROJECT_SETTINGS_ACTIONS, p) && (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button variant="ghost" size="icon" aria-label={`Settings of ${p.name}`} onClick={() => go(p, '/project-settings')}>
                                  <Settings aria-hidden />
                                </Button>
                              }
                            />
                            <TooltipContent>Project Settings</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No projects you can open.</p>
              )}
            </section>
          )
        })
      )}

      {creating === 'merchant' && (
        <CreateMerchantDialog
          onClose={() => setCreating(undefined)}
          onSaved={() => {
            setCreating(undefined)
            merchants.reload()
            access.retry() // its Default project
          }}
        />
      )}
      {creating && creating !== 'merchant' && (
        <ProjectDialog
          editing={{ mode: 'create', merchantId: creating.merchantId }}
          onClose={() => setCreating(undefined)}
          onSaved={() => {
            setCreating(undefined)
            access.retry() // the new project's card
          }}
        />
      )}
    </div>
  )
}

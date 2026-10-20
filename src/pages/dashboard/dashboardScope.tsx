import { useSearchParams } from 'react-router'
import { useAccess } from '@/app/access'
import { NativeSelect } from '@/components/common/NativeSelect'
import { useLoad } from '@/hooks/useLoad'
import { analyticsService, type DashboardScope } from '@/services/analyticsService'
import { useSession } from '@/stores/sessionStore'

/**
 * REQ: DEC-86 — what Overview, System Intelligence and Billing show: the header's projects ("All my projects" or one),
 * an optional flow, and (Platform Admin under "All my projects") an optional merchant. Flow and merchant live in the URL.
 */
export function useDashboardScope() {
  const actor = useSession((s) => s.actor)
  const { inView, selected, account } = useAccess()
  const [sp, setSp] = useSearchParams()
  const filters = useLoad(() => analyticsService.filters(actor), [actor.userId])
  const f = filters.data
  const isAdmin = account?.level === 'PLATFORM_ADMIN'
  const merchantId = isAdmin && !selected && f?.merchants.some((m) => m.merchantId === sp.get('merchant')) ? sp.get('merchant')! : ''
  const inViewIds = inView.map((p) => p.projectId)
  const projects = (f?.projects ?? []).filter((p) => inViewIds.includes(p.projectId) && (!merchantId || p.merchantId === merchantId))
  const flows = (f?.flows ?? []).filter((x) => projects.some((p) => p.projectId === x.projectId))
  const flowId = flows.some((x) => x.flowId === sp.get('flow')) ? sp.get('flow')! : ''

  const scope: DashboardScope = { merchantId: merchantId || undefined, projectIds: inViewIds, flowId: flowId || undefined }
  const merchantName = (id: string) => f?.merchants.find((m) => m.merchantId === id)?.name ?? id
  const projectName = (id: string) => f?.projects.find((p) => p.projectId === id)?.name ?? id
  const flowName = (id: string) => f?.flows.find((x) => x.flowId === id)?.name ?? id
  const flow = flows.find((x) => x.flowId === flowId)
  const label = [
    selected ? selected.name : merchantId ? merchantName(merchantId) : isAdmin ? 'All merchants' : inView.length > 1 ? 'All my projects' : (inView[0]?.name ?? ''),
    flow && flow.name,
  ]
    .filter(Boolean)
    .join(' › ')

  const set = (k: 'merchant' | 'flow', v: string) =>
    setSp(
      (p) => {
        if (v) p.set(k, v)
        else p.delete(k)
        if (k === 'merchant') p.delete('flow')
        return p
      },
      { replace: true },
    )

  return {
    actor,
    ready: !!f,
    scope,
    key: JSON.stringify(scope),
    label,
    several: { merchants: !merchantId && new Set(projects.map((p) => p.merchantId)).size > 1, projects: projects.length > 1, flows: !flowId && flows.length > 1 },
    names: { merchantName, projectName, flowName },
    bar: (
      <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Dashboard filters">
        {isAdmin && !selected && (
          <label className="text-xs font-medium text-muted-foreground">
            Merchant
            <NativeSelect className="mt-1 w-56" value={merchantId} onChange={(e) => set('merchant', e.target.value)}>
              <option value="">All merchants</option>
              {(f?.merchants ?? []).map((m) => (
                <option key={m.merchantId} value={m.merchantId}>
                  {m.name}
                </option>
              ))}
            </NativeSelect>
          </label>
        )}
        <div className="text-xs font-medium text-muted-foreground">
          Project
          <div className="mt-1 flex h-8 items-center rounded-lg border px-2.5 text-sm text-foreground">{selected ? selected.name : inView.length > 1 ? 'All my projects' : (inView[0]?.name ?? '—')}</div>
        </div>
        <label className="text-xs font-medium text-muted-foreground">
          Flow
          <NativeSelect className="mt-1 w-64" value={flowId} onChange={(e) => set('flow', e.target.value)}>
            <option value="">All flows</option>
            {flows.map((x) => (
              <option key={x.flowId} value={x.flowId}>
                {projects.length > 1 ? `${projectName(x.projectId)} › ` : ''}
                {x.name} ({x.workflowVersion})
              </option>
            ))}
          </NativeSelect>
        </label>
        <p className="pb-2 text-xs text-muted-foreground">Change the project in the header.</p>
      </div>
    ),
  }
}

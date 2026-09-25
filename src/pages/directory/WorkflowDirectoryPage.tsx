import { Fragment, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { ChevronRight, SlidersHorizontal } from 'lucide-react'
import { RiskBadge } from '@/components/common/RiskBadge'
import { ErrorState } from '@/components/common/States'
import { Button } from '@/components/ui/button'
import { can } from '@/domain/permissions'
import { PHASE_LABELS, type Merchant, type MerchantConfig, type Phase } from '@/domain/types'
import { formatMyt } from '@/lib/format'
import { cn } from '@/lib/utils'
import { configService } from '@/services/configService'
import { isServiceError } from '@/services/errors'
import { merchantService } from '@/services/merchantService'
import { useSession } from '@/stores/sessionStore'

interface Row {
  merchant: Merchant
  active: MerchantConfig
  draft: MerchantConfig | null
}

function PhaseFlow({ config }: { config: MerchantConfig }) {
  const steps: { phase: Phase; enabled: boolean }[] = [
    ...config.phases.map((p) => ({ phase: p.phase as Phase, enabled: p.enabled })),
    ...(config.workflowVersion === 'V4' ? [{ phase: 'RISK_ASSESSMENT' as Phase, enabled: !!config.risk?.enabled }] : []),
  ]
  return (
    <ol className="flex flex-wrap items-center gap-1 text-xs" aria-label="Phases in order">
      {steps.map((s, i) => (
        <Fragment key={s.phase}>
          {i > 0 && <ChevronRight className="size-3 text-muted-foreground" aria-hidden />}
          <li
            className={cn(
              'rounded-full border px-2 py-0.5 whitespace-nowrap',
              s.phase === 'RISK_ASSESSMENT' && 'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-200',
              !s.enabled && 'text-muted-foreground line-through',
            )}
          >
            {PHASE_LABELS[s.phase]}
            {!s.enabled && <span className="sr-only"> (disabled)</span>}
          </li>
        </Fragment>
      ))}
    </ol>
  )
}

export function WorkflowDirectoryPage() {
  const actor = useSession((s) => s.actor)
  const selectMerchant = useSession((s) => s.selectMerchant)
  const navigate = useNavigate()
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<{ key: string; rows?: Row[]; error?: string }>({ key: '' })
  const key = `${actor.userId}|${retry}`

  useEffect(() => {
    let live = true
    merchantService
      .list(actor)
      .then((ms) => Promise.all(ms.map(async (merchant) => ({ merchant, active: await configService.getActive(merchant.merchantId, actor), draft: await configService.getDraft(merchant.merchantId, actor) }))))
      .then(
        (rows) => live && setResult({ key, rows }),
        (e: unknown) => live && setResult({ key, error: isServiceError(e) ? e.message : 'Unexpected error.' }),
      )
    return () => {
      live = false
    }
  }, [actor, key])

  const canConfigure = can(actor, 'canConfigureWorkflow')

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Merchant Workflow Directory</h1>
        <p className="text-sm text-muted-foreground">Which workflow each merchant runs. V4 adds the internal Risk Assessment phase after the capture phases; V1 has no risk gate.</p>
      </header>
      <section aria-label="Merchants and workflows" className="rounded-lg border bg-card">
        {result.error ? (
          <ErrorState message={result.error} onRetry={() => setRetry((n) => n + 1)} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-busy={result.key !== key}>
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  {['Merchant', 'Workflow', 'Phases', 'Risk gate', 'Active config', 'Draft', ''].map((h, i) => (
                    <th key={i} scope="col" className="px-4 py-2 font-medium whitespace-nowrap">
                      {h || <span className="sr-only">Actions</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.key !== key &&
                  Array.from({ length: 5 }, (_, i) => (
                    <tr key={i} className="border-t" aria-hidden>
                      <td colSpan={7} className="px-4 py-4">
                        <div className="h-3.5 animate-pulse rounded bg-muted" />
                      </td>
                    </tr>
                  ))}
                {result.key === key &&
                  result.rows?.map(({ merchant, active, draft }) => (
                    <tr key={merchant.merchantId} className="border-t">
                      <th scope="row" className="px-4 py-3 text-left font-normal">
                        <div className="font-medium">{merchant.name}</div>
                        <div className="text-xs text-muted-foreground">{merchant.merchantId}</div>
                      </th>
                      <td className="px-4 py-3">
                        <span className={cn('rounded-md px-2 py-0.5 font-mono text-xs font-semibold', merchant.workflowVersion === 'V4' ? 'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200' : 'bg-muted')}>{merchant.workflowVersion}</span>
                      </td>
                      <td className="px-4 py-3">
                        <PhaseFlow config={active} />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{active.risk ? active.risk.enabled ? <>max <RiskBadge level={active.risk.maxAllowedLevel} /></> : 'Off' : <span className="text-muted-foreground">n/a (V1)</span>}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="font-mono">{active.version}</span>
                        <div className="text-xs text-muted-foreground">
                          {active.deployedAt ? formatMyt(active.deployedAt) : '—'} · {active.updatedBy.fullName}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{draft ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">Draft {draft.version} pending</span> : <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-4 py-3 text-right">
                        {canConfigure && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              selectMerchant(merchant.merchantId)
                              navigate('/workflow')
                            }}
                          >
                            <SlidersHorizontal aria-hidden /> Open workflow
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

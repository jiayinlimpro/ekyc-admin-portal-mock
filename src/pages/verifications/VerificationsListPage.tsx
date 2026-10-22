import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useAccess } from '@/app/access'
import { Pagination } from '@/components/common/Pagination'
import { EmptyState, ErrorState } from '@/components/common/States'
import { Button } from '@/components/ui/button'
import type { Paged, VerificationSummary } from '@/domain/types'
import { isServiceError } from '@/services/errors'
import { verificationService, type FilterOptions } from '@/services/verificationService'
import { useSession } from '@/stores/sessionStore'
import { DEFAULT_FILTERS, isDefaultView, nextSort, PAGE_SIZES, parseListParams, toQuery, toSearchParams, type ListParams } from './listQuery'
import { VerificationFilters } from './VerificationFilters'
import { VerificationTable } from './VerificationTable'

/** Result of one request. `request` identifies it, so "loading" is simply "the latest result is for an older request". */
type Result = { request: string; data?: Paged<VerificationSummary>; error?: string }

const NO_OPTIONS: FilterOptions = { projects: [], flows: [] }

// REQ: DEC-40 / DEC-43 / DEC-96 — cases across the projects in the header's view ("All my projects" or one project).
export function VerificationsListPage() {
  const actor = useSession((s) => s.actor)
  const { inView } = useAccess()
  const [sp, setSp] = useSearchParams()
  const key = sp.toString()
  const params = useMemo(() => parseListParams(new URLSearchParams(key)), [key])
  const filtersKey = JSON.stringify(params.filters)
  const viewIds = useMemo(() => inView.map((p) => p.projectId), [inView])
  const viewKey = viewIds.join(',')

  const [retry, setRetry] = useState(0)
  const request = JSON.stringify([key, viewKey, actor.userId, retry])
  const [result, setResult] = useState<Result>({ request: '' })
  const [lastData, setLastData] = useState<Paged<VerificationSummary>>()
  const [allOptions, setAllOptions] = useState<FilterOptions>(NO_OPTIONS)

  useEffect(() => {
    let live = true
    // Filter options only: on failure the dropdowns just stay short; the list itself shows the error.
    verificationService.filterOptions(actor).then((o) => live && setAllOptions(o), () => live && setAllOptions(NO_OPTIONS))
    return () => {
      live = false
    }
  }, [actor])

  // Only the projects in view (and their flows) are offered as filters.
  const options = useMemo<FilterOptions>(() => {
    const ids = new Set(viewKey.split(','))
    return { projects: allOptions.projects.filter((p) => ids.has(p.projectId)), flows: allOptions.flows.filter((f) => ids.has(f.projectId)) }
  }, [allOptions, viewKey])

  useEffect(() => {
    let live = true
    verificationService.list(toQuery(params, viewKey ? viewKey.split(',') : []), actor).then(
      (data) => {
        if (!live) return
        setResult({ request, data })
        setLastData(data)
      },
      (e: unknown) => live && setResult({ request, error: isServiceError(e) ? e.message : 'Unexpected error.' }),
    )
    return () => {
      live = false
    }
  }, [request, params, viewKey, actor])

  const loading = result.request !== request
  const error = loading ? undefined : result.error
  const data = loading || error ? lastData : result.data // keep showing the last rows while loading / after an error

  // Past the last page (e.g. after narrowing the scope): jump to the last page that exists.
  useEffect(() => {
    const d = result.data
    if (d && d.total > 0 && d.items.length === 0 && params.page > 1) {
      setSp(toSearchParams({ ...params, page: Math.ceil(d.total / params.pageSize) }), { replace: true })
    }
  }, [result.data, params, setSp])

  const go = (next: ListParams) => setSp(toSearchParams(next))
  const onReset = () => go({ filters: DEFAULT_FILTERS, sort: params.sort, page: 1, pageSize: params.pageSize })
  const filtered = !isDefaultView(params.filters)

  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Verifications</h1>
        <p className="text-sm text-muted-foreground">
          {!filtered ? `Pending Review cases in your projects${params.sort ? '' : ', oldest first'}. ` : ''}Open a case to review it. Claiming happens on the detail page; claim is not a status.
        </p>
      </header>

      <VerificationFilters
        key={`${filtersKey}|${viewKey}`} // re-mount when the applied filters or the header's project change
        initial={params.filters}
        onSearch={(filters) => go({ filters, sort: params.sort, page: 1, pageSize: params.pageSize })}
        onReset={onReset}
        options={options}
      />

      <section aria-label="Results" className="rounded-lg border bg-card">
        {error && !data ? (
          <ErrorState message={error} onRetry={() => setRetry((n) => n + 1)} />
        ) : (
          <>
            {error && (
              <div role="alert" className="flex items-center justify-between gap-2 border-b bg-destructive/5 px-4 py-2 text-sm text-destructive">
                {error} Showing the last results.
                <Button variant="outline" size="sm" onClick={() => setRetry((n) => n + 1)}>
                  Try again
                </Button>
              </div>
            )}
            {!loading && data?.total === 0 ? (
              <EmptyState
                title={filtered ? 'No verifications match these filters' : 'Nothing waiting for review'}
                action={
                  <Button variant="outline" size="sm" onClick={() => (filtered ? onReset() : go({ filters: { ...DEFAULT_FILTERS, statuses: [] }, sort: params.sort, page: 1, pageSize: params.pageSize }))}>
                    {filtered ? 'Reset filters' : 'Show all statuses'}
                  </Button>
                }
              >
                {!filtered && 'No Pending Review cases in the projects in view.'}
              </EmptyState>
            ) : (
              <VerificationTable
                rows={data?.items ?? []}
                currentUserId={actor.userId}
                loading={loading}
                skeletonRows={Math.min(params.pageSize, 10)}
                showProject={options.projects.length > 1}
                showRisk={options.flows.some((f) => f.runsRisk)}
                showMerchant={new Set(options.projects.map((p) => p.merchantId)).size > 1}
                sort={params.sort}
                onSort={(by) => go({ ...params, sort: nextSort(params.sort, by), page: 1 })} // applies at once, keeps unsaved filters
              />
            )}
            {data && data.total > 0 && (
              <div className="border-t">
                <Pagination
                  page={params.page}
                  pageSize={params.pageSize}
                  total={data.total}
                  pageSizes={PAGE_SIZES}
                  onPage={(page) => go({ ...params, page })}
                  onPageSize={(pageSize) => go({ ...params, page: 1, pageSize })}
                />
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}

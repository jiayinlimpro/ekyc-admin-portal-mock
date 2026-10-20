import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Pagination } from '@/components/common/Pagination'
import { EmptyState, ErrorState } from '@/components/common/States'
import { Button } from '@/components/ui/button'
import { can } from '@/domain/permissions'
import type { Merchant, Paged, VerificationSummary } from '@/domain/types'
import { isServiceError } from '@/services/errors'
import { merchantService } from '@/services/merchantService'
import { userService, type UserSummary } from '@/services/userService'
import { verificationService } from '@/services/verificationService'
import { ALL_MERCHANTS, useSession } from '@/stores/sessionStore'
import { EMPTY_FILTERS, PAGE_SIZES, parseListParams, toQuery, toSearchParams, type ListParams } from './listQuery'
import { VerificationFilters } from './VerificationFilters'
import { VerificationTable } from './VerificationTable'

/** Result of one request. `request` identifies it, so "loading" is simply "the latest result is for an older request". */
type Result = { request: string; data?: Paged<VerificationSummary>; error?: string }

export function VerificationsListPage() {
  const actor = useSession((s) => s.actor)
  const selectedMerchant = useSession((s) => s.merchantId)
  const [sp, setSp] = useSearchParams()
  const key = sp.toString()
  const params = useMemo(() => parseListParams(new URLSearchParams(key)), [key])
  const filtersKey = JSON.stringify(params.filters)

  // Top-bar merchant selector scopes admins; reviewers are scoped by the service anyway.
  const scope = can(actor, 'canViewAllMerchants') && selectedMerchant !== ALL_MERCHANTS ? selectedMerchant : undefined

  const [retry, setRetry] = useState(0)
  const request = JSON.stringify([key, scope, actor.userId, retry])
  const [result, setResult] = useState<Result>({ request: '' })
  const [lastData, setLastData] = useState<Paged<VerificationSummary>>()
  const [merchants, setMerchants] = useState<Merchant[]>([])
  const [reviewers, setReviewers] = useState<UserSummary[]>([])

  useEffect(() => {
    let live = true
    // Filter options only: on failure the dropdowns just stay short; the list itself shows the error.
    merchantService.list(actor).then((m) => live && setMerchants(m), () => live && setMerchants([]))
    userService.listReviewers(actor).then((r) => live && setReviewers(r), () => live && setReviewers([]))
    return () => {
      live = false
    }
  }, [actor])

  useEffect(() => {
    let live = true
    verificationService.list(toQuery(params), actor).then(
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
  }, [request, params, scope, actor])

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
  const onReset = () => go({ filters: EMPTY_FILTERS, page: 1, pageSize: params.pageSize })
  const filtered = filtersKey !== JSON.stringify(EMPTY_FILTERS)

  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Verifications</h1>
        <p className="text-sm text-muted-foreground">Open a record to review it. Claiming happens on the detail page; claim is not a status.</p>
      </header>

      <VerificationFilters
        key={filtersKey} // re-mount when the applied filters change (Search, Reset, top-bar search, back button)
        initial={params.filters}
        onSearch={(filters) => go({ filters, page: 1, pageSize: params.pageSize })}
        onReset={onReset}
        actor={actor}
        merchants={merchants}
        scopedMerchant={merchants.find((m) => m.merchantId === scope)}
        reviewers={reviewers}
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
                title={filtered ? 'No verifications match these filters' : 'No verifications yet'}
                action={
                  filtered && (
                    <Button variant="outline" size="sm" onClick={onReset}>
                      Reset filters
                    </Button>
                  )
                }
              >
                {!filtered && 'Records appear here once end users start the eKYC flow for this merchant.'}
              </EmptyState>
            ) : (
              <VerificationTable rows={data?.items ?? []} currentUserId={actor.userId} loading={loading} skeletonRows={Math.min(params.pageSize, 10)} />
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

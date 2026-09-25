import { useEffect, useState } from 'react'
import { ChartCard, DataTable, StatTile, StatusLegend, StatusShareBar } from '@/components/charts/ChartKit'
import { fmtInt, fmtPct, pct } from '@/components/charts/numbers'
import { DailyStatusChart } from '@/components/charts/DailyStatusChart'
import { DateRangePresets } from '@/components/charts/DateRangePresets'
import { OpenQuestionTag } from '@/components/common/OpenQuestionTag'
import { ErrorState } from '@/components/common/States'
import type { OverviewStats } from '@/domain/analytics'
import { VERIFICATION_STATUSES } from '@/domain/types'
import { RANGE_PRESETS, useRangeDays } from '@/hooks/useRangeDays'
import { useScope } from '@/hooks/useScope'
import { formatDate } from '@/lib/format'
import { STATUS_LABELS } from '@/lib/labels'
import { analyticsService } from '@/services/analyticsService'
import { isServiceError } from '@/services/errors'

export function OverviewPage() {
  const { actor, scope, label, merchantName } = useScope()
  const [days, setDays] = useRangeDays()
  const [retry, setRetry] = useState(0)
  const request = JSON.stringify([days, scope, actor.userId, retry])
  const [result, setResult] = useState<{ request: string; data?: OverviewStats; error?: string }>({ request: '' })
  const [last, setLast] = useState<OverviewStats>()

  useEffect(() => {
    let live = true
    analyticsService.overview({ days, merchantId: scope }, actor).then(
      (data) => {
        if (!live) return
        setResult({ request, data })
        setLast(data)
      },
      (e: unknown) => live && setResult({ request, error: isServiceError(e) ? e.message : 'Unexpected error.' }),
    )
    return () => {
      live = false
    }
  }, [request, days, scope, actor])

  const loading = result.request !== request
  const s = loading ? last : (result.data ?? last)
  const rangeLabel = RANGE_PRESETS.find((p) => p.days === days)!.label.toLowerCase()

  if (!loading && result.error && !s) return <ErrorState message={result.error} onRetry={() => setRetry((n) => n + 1)} />

  const deltaPct = s && s.previousTotal ? pct(s.total - s.previousTotal, s.previousTotal) : undefined

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Overview</h1>
        <p className="text-sm text-muted-foreground">
          {label} · verifications submitted in the {rangeLabel === 'today' ? 'current day' : rangeLabel}, with their status as of now (MYT).
        </p>
      </header>

      <DateRangePresets days={days} onChange={setDays}>
        <span className="text-xs text-muted-foreground">KPI selection:</span> <OpenQuestionTag id="OQ-15" />
      </DateRangePresets>

      <div className={`grid gap-4 sm:grid-cols-3 transition-opacity ${loading && s ? 'opacity-60' : ''}`} aria-busy={loading}>
        <StatTile label="Total verifications" value={s ? fmtInt(s.total) : '—'} delta={deltaPct !== undefined ? { value: deltaPct, vs: 'previous period' } : undefined} note="Every verification is charged on entry" />
        <StatTile label="Auto-Clear" value={s ? fmtPct(pct(s.autoCleared, s.total)) : '—'} note={s ? `${fmtInt(s.autoCleared)} approved by SYSTEM · ${fmtInt(s.manuallyDecided)} decided manually` : undefined} />
        <StatTile label="Pending review" value={s ? fmtInt(s.pending.total) : '—'} note={s ? `${fmtInt(s.pending.unclaimed)} unclaimed · ${fmtInt(s.pending.claimed)} claimed` : undefined} />
      </div>

      {s && (
        <>
          <ChartCard
            title="Status split"
            subtitle={`${fmtInt(s.total)} verifications`}
            busy={loading}
            legend={<StatusLegend counts={s.byStatus} total={s.total} />}
            table={<DataTable caption="Status split" columns={['Status', 'Count', 'Share']} rows={VERIFICATION_STATUSES.map((k) => [STATUS_LABELS[k], fmtInt(s.byStatus[k]), fmtPct(pct(s.byStatus[k], s.total))])} />}
          >
            <StatusShareBar counts={s.byStatus} total={s.total} />
          </ChartCard>

          <ChartCard
            title="Daily verifications by status"
            subtitle="By submission day (MYT); status as of now"
            busy={loading}
            legend={<StatusLegend />}
            table={<DataTable caption="Daily verifications by status" columns={['Day', ...VERIFICATION_STATUSES.map((k) => STATUS_LABELS[k]), 'Total']} rows={s.daily.map((d) => [formatDate(d.day), ...VERIFICATION_STATUSES.map((k) => d.counts[k]), VERIFICATION_STATUSES.reduce((n, k) => n + d.counts[k], 0)])} />}
          >
            <DailyStatusChart daily={s.daily} />
          </ChartCard>

          {s.byMerchant.length > 1 && (
            <section aria-label="By merchant" className="rounded-lg border bg-card">
              <h2 className="border-b px-4 py-2.5 text-sm font-semibold">By merchant</h2>
              <div className="p-4">
                <DataTable
                  caption="Verifications by merchant"
                  columns={['Merchant', 'Verifications', 'Auto-Clear', 'Pending review', 'Rejected']}
                  rows={s.byMerchant.map((m) => [merchantName(m.merchantId), fmtInt(m.total), fmtPct(pct(m.autoCleared, m.total)), fmtInt(m.pending), fmtInt(m.rejected)])}
                />
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

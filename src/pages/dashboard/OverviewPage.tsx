import { ChartCard, DataTable, StatTile, StatusLegend, StatusShareBar } from '@/components/charts/ChartKit'
import { fmtInt, fmtPct, pct } from '@/components/charts/numbers'
import { DailyStatusChart } from '@/components/charts/DailyStatusChart'
import { DateRangePresets } from '@/components/charts/DateRangePresets'
import { ErrorState } from '@/components/common/States'
import type { GroupRow } from '@/domain/dashboards'
import { VERIFICATION_STATUSES } from '@/domain/types'
import { useLoad } from '@/hooks/useLoad'
import { RANGE_PRESETS, useRangeDays } from '@/hooks/useRangeDays'
import { formatDate } from '@/lib/format'
import { STATUS_LABELS } from '@/lib/labels'
import { analyticsService } from '@/services/analyticsService'
import { useDashboardScope } from './dashboardScope'

const rate = (r: GroupRow) => (r.passRate === undefined ? '—' : fmtPct(r.passRate * 100))
const hours = (h?: number) => (h === undefined ? '—' : h < 48 ? `${h} h` : `${Math.round(h / 24)} d`)

function Breakdown({ title, rows, name }: { title: string; rows: GroupRow[]; name: (key: string) => string }) {
  return (
    <section aria-label={title} className="rounded-lg border bg-card">
      <h2 className="border-b px-4 py-2.5 text-sm font-semibold">{title}</h2>
      <div className="p-4">
        <DataTable
          caption={title}
          columns={['Name', 'Cases', ...VERIFICATION_STATUSES.map((s) => STATUS_LABELS[s]), 'Auto-Clear', 'Pass rate', 'Oldest waiting', 'Average wait']}
          rows={rows.map((r) => [name(r.key), fmtInt(r.total), ...VERIFICATION_STATUSES.map((s) => fmtInt(r.byStatus[s])), fmtPct(pct(r.autoCleared, r.total)), rate(r), hours(r.oldestPendingHours), hours(r.avgPendingHours)])}
        />
        <p className="mt-2 text-xs text-muted-foreground">Pass rate = Approved out of completed (Approved + Rejected). Waiting = cases in Pending Review, since their last status change.</p>
      </div>
    </section>
  )
}

// REQ: DEC-84 / DEC-86 — everyone lands here; data scoped to the user's projects, the header's project and the filters.
export function OverviewPage() {
  const d = useDashboardScope()
  const [days, setDays] = useRangeDays()
  const stats = useLoad(() => analyticsService.overview({ days, ...d.scope }, d.actor), [days, d.key, d.actor.userId])
  const s = stats.data
  const loading = stats.loading
  const rangeLabel = RANGE_PRESETS.find((p) => p.days === days)!.label.toLowerCase()

  if (stats.error && !s) return <ErrorState message={stats.error} onRetry={stats.reload} />
  const deltaPct = s && s.previousTotal ? pct(s.total - s.previousTotal, s.previousTotal) : undefined

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Overview</h1>
        <p className="text-sm text-muted-foreground">
          {d.label} · verifications created in the {rangeLabel === 'today' ? 'current day' : rangeLabel}, with their status as of now (MYT).
        </p>
      </header>

      <div className="flex flex-wrap items-end justify-between gap-3">
        {d.bar}
        <DateRangePresets days={days} onChange={setDays} />
      </div>

      <div className={`grid gap-4 sm:grid-cols-3 transition-opacity ${loading && s ? 'opacity-60' : ''}`} aria-busy={loading}>
        <StatTile label="Total verifications" value={s ? fmtInt(s.total) : '—'} delta={deltaPct !== undefined ? { value: deltaPct, vs: 'previous period' } : undefined} note="Created in the period" />
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
            subtitle="By creation day (MYT); status as of now"
            busy={loading}
            legend={<StatusLegend />}
            table={<DataTable caption="Daily verifications by status" columns={['Day', ...VERIFICATION_STATUSES.map((k) => STATUS_LABELS[k]), 'Total']} rows={s.daily.map((x) => [formatDate(x.day), ...VERIFICATION_STATUSES.map((k) => x.counts[k]), VERIFICATION_STATUSES.reduce((n, k) => n + x.counts[k], 0)])} />}
          >
            <DailyStatusChart daily={s.daily} />
          </ChartCard>

          {s.byMerchant.length > 1 && <Breakdown title="By merchant" rows={s.byMerchant} name={d.names.merchantName} />}
          {s.byProject.length > 1 && <Breakdown title="By project" rows={s.byProject} name={d.names.projectName} />}
          {s.byFlow.length > 1 && <Breakdown title="By flow" rows={s.byFlow} name={d.names.flowName} />}
          {s.byVersion.length > 1 && <Breakdown title="By workflow version" rows={s.byVersion} name={(k) => k} />}
        </>
      )}
    </div>
  )
}

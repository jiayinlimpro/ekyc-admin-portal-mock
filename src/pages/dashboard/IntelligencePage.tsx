import { BarList, ChartCard, DataTable, StatTile } from '@/components/charts/ChartKit'
import { fmtInt, fmtPct, pct } from '@/components/charts/numbers'
import { DateRangePresets } from '@/components/charts/DateRangePresets'
import { ScoreHistogram } from '@/components/charts/ScoreHistogram'
import { ErrorState } from '@/components/common/States'
import { HISTOGRAM_BIN } from '@/domain/dashboards'
import { CHECKS, PHASE_LABELS, RISK_LEVELS } from '@/domain/types'
import { useLoad } from '@/hooks/useLoad'
import { RANGE_PRESETS, useRangeDays } from '@/hooks/useRangeDays'
import { RISK_LABELS } from '@/lib/labels'
import { analyticsService } from '@/services/analyticsService'
import { useDashboardScope } from './dashboardScope'

const avg = (n: number, of: number) => (of ? (n / of).toFixed(2) : '—')

// REQ: DEC-18 / DEC-86 — retry KPIs count face match and liveness retries only; drop-off by phase and retries by flow.
export function IntelligencePage() {
  const d = useDashboardScope()
  const [days, setDays] = useRangeDays()
  const stats = useLoad(() => analyticsService.intelligence({ days, ...d.scope }, d.actor), [days, d.key, d.actor.userId])
  const s = stats.data
  const loading = stats.loading
  if (stats.error && !s) return <ErrorState message={stats.error} onRetry={stats.reload} />
  const rangeLabel = RANGE_PRESETS.find((p) => p.days === days)!.label.toLowerCase()
  const riskTotal = s ? RISK_LEVELS.reduce((n, l) => n + s.riskLevels[l], 0) : 0
  const showSelfie = !!s?.byFlow.some((f) => f.dropOff.selfie !== undefined)

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">System Intelligence</h1>
        <p className="text-sm text-muted-foreground">
          {d.label} · sessions created in the {rangeLabel === 'today' ? 'current day' : rangeLabel} (MYT).
        </p>
      </header>

      <div className="flex flex-wrap items-end justify-between gap-3">
        {d.bar}
        <DateRangePresets days={days} onChange={setDays} />
      </div>

      <div className={`grid gap-4 sm:grid-cols-3 transition-opacity ${loading && s ? 'opacity-60' : ''}`} aria-busy={loading}>
        <StatTile label="First-attempt pass rate" value={s ? fmtPct(pct(s.firstAttemptPass, s.submitted)) : '—'} note={s ? `${fmtInt(s.firstAttemptPass)} of ${fmtInt(s.submitted)} submitted sessions passed every check first time` : undefined} />
        <StatTile label="Average retries" value={s ? avg(s.retries, s.submitted) : '—'} note={s ? `${fmtInt(s.retries)} face match and liveness retries · ID capture and selfie retakes are free and not counted` : undefined} />
        <StatTile label="Retries used up" value={s ? fmtInt(s.retriesExhausted) : '—'} note="The last attempt decided: Pending Review or Rejected" />
      </div>

      {s && (
        <>
          <ChartCard
            title="Score distribution"
            subtitle={s.thresholds ? `Last score per session · lines: this flow’s Auto-Reject and Auto-Pass` : 'Last score per session · pick one flow to overlay its Auto-Reject / Auto-Pass lines'}
            busy={loading}
            table={
              <DataTable
                caption="Sessions per score band and check"
                columns={['Score band', ...CHECKS.map((c) => PHASE_LABELS[c])]}
                rows={s.histograms.FACE_MATCH.map((_, i) => [`${i * HISTOGRAM_BIN}–${i === s.histograms.FACE_MATCH.length - 1 ? 100 : i * HISTOGRAM_BIN + HISTOGRAM_BIN - 0.1}`, ...CHECKS.map((c) => s.histograms[c][i])])}
              />
            }
          >
            <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
              {CHECKS.map((c) => (
                <div key={c}>
                  <h3 className="mb-6 text-sm font-medium">
                    {PHASE_LABELS[c]} <span className="font-normal text-muted-foreground">· {fmtInt(s.histograms[c].reduce((a, b) => a + b, 0))} sessions</span>
                  </h3>
                  <ScoreHistogram bins={s.histograms[c]} label={PHASE_LABELS[c]} thresholds={s.thresholds?.[c]} />
                </div>
              ))}
            </div>
          </ChartCard>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Retries by check"
              subtitle="Submissions after the first (DEC-18)"
              busy={loading}
              table={<DataTable caption="Retries by check" columns={['Check', 'Retries']} rows={CHECKS.map((c) => [PHASE_LABELS[c], s.retriesByCheck[c]])} />}
            >
              <BarList unit="retries" rows={CHECKS.map((c) => ({ label: PHASE_LABELS[c], value: s.retriesByCheck[c] }))} />
            </ChartCard>
            <ChartCard
              title="Risk level (V4)"
              subtitle={riskTotal ? `${fmtInt(riskTotal)} sessions with a risk result` : 'No sessions with a risk result in scope'}
              busy={loading}
              table={<DataTable caption="Risk levels" columns={['Risk level', 'Sessions', 'Share']} rows={RISK_LEVELS.map((l) => [RISK_LABELS[l], s.riskLevels[l], fmtPct(pct(s.riskLevels[l], riskTotal))])} />}
            >
              <BarList unit="sessions" rows={RISK_LEVELS.map((l) => ({ label: RISK_LABELS[l], value: s.riskLevels[l] }))} />
            </ChartCard>
          </div>

          <section aria-label="By flow" className="rounded-lg border bg-card">
            <h2 className="border-b px-4 py-2.5 text-sm font-semibold">By flow</h2>
            <div className="p-4">
              <DataTable
                caption="Retry KPIs and drop-off by flow"
                columns={[
                  'Flow',
                  'Sessions',
                  'First-attempt pass',
                  'Average retries',
                  'Retries used up',
                  'Not finished: ID capture',
                  ...(showSelfie ? ['Not finished: selfie'] : []),
                  'Not finished: liveness',
                ]}
                rows={s.byFlow.map((f) => [
                  d.names.flowName(f.flowId),
                  fmtInt(f.sessions),
                  fmtPct(pct(f.firstAttemptPass, f.submitted)),
                  avg(f.retries, f.submitted),
                  fmtInt(f.retriesExhausted),
                  fmtInt(f.dropOff.idCapture),
                  ...(showSelfie ? [f.dropOff.selfie === undefined ? '—' : fmtInt(f.dropOff.selfie)] : []),
                  fmtInt(f.dropOff.liveness),
                ])}
              />
              <p className="mt-2 text-xs text-muted-foreground">Drop-off = sessions still Processing, by the last phase they reached. Selfie applies to flows with a selfie step (V1).</p>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

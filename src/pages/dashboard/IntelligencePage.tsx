import { useEffect, useState } from 'react'
import { BarList, ChartCard, DataTable, StatTile } from '@/components/charts/ChartKit'
import { fmtInt, fmtPct, pct } from '@/components/charts/numbers'
import { DateRangePresets } from '@/components/charts/DateRangePresets'
import { ScoreHistogram } from '@/components/charts/ScoreHistogram'
import { ErrorState } from '@/components/common/States'
import { HISTOGRAM_BIN, type IntelligenceStats } from '@/domain/analytics'
import { CAPTURE_PHASES, PHASE_LABELS, RISK_LEVELS, type MerchantConfig } from '@/domain/types'
import { RANGE_PRESETS, useRangeDays } from '@/hooks/useRangeDays'
import { useScope } from '@/hooks/useScope'
import { RISK_LABELS } from '@/lib/labels'
import { analyticsService } from '@/services/analyticsService'
import { configService } from '@/services/configService'
import { isServiceError } from '@/services/errors'

export function IntelligencePage() {
  const { actor, scope, label } = useScope()
  const [days, setDays] = useRangeDays()
  const [retry, setRetry] = useState(0)
  const request = JSON.stringify([days, scope, actor.userId, retry])
  const [result, setResult] = useState<{ request: string; data?: IntelligenceStats; error?: string }>({ request: '' })
  const [last, setLast] = useState<IntelligenceStats>()
  const [config, setConfig] = useState<{ merchantId: string; value: MerchantConfig }>()
  // Thresholds differ per merchant, so the lines are drawn only when one merchant is in scope.
  const thresholdMerchant = scope ?? actor.merchantId

  useEffect(() => {
    let live = true
    analyticsService.intelligence({ days, merchantId: scope }, actor).then(
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

  useEffect(() => {
    if (!thresholdMerchant) return
    let live = true
    configService.getActive(thresholdMerchant, actor).then((value) => live && setConfig({ merchantId: thresholdMerchant, value }), () => undefined)
    return () => {
      live = false
    }
  }, [thresholdMerchant, actor])

  const loading = result.request !== request
  const s = loading ? last : (result.data ?? last)
  const cfg = thresholdMerchant && config?.merchantId === thresholdMerchant ? config.value : undefined
  if (!loading && result.error && !s) return <ErrorState message={result.error} onRetry={() => setRetry((n) => n + 1)} />
  const rangeLabel = RANGE_PRESETS.find((p) => p.days === days)!.label.toLowerCase()
  const riskTotal = s ? RISK_LEVELS.reduce((n, l) => n + s.riskLevels[l], 0) : 0

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">System Intelligence</h1>
        <p className="text-sm text-muted-foreground">{label} · sessions submitted in the {rangeLabel === 'today' ? 'current day' : rangeLabel} (MYT).</p>
      </header>

      <DateRangePresets days={days} onChange={setDays} />

      <div className={`grid gap-4 sm:grid-cols-3 transition-opacity ${loading && s ? 'opacity-60' : ''}`} aria-busy={loading}>
        <StatTile label="Retry rate" value={s ? fmtPct(pct(s.retriedSessions, s.sessions)) : '—'} note={s ? `${fmtInt(s.retriedSessions)} of ${fmtInt(s.sessions)} sessions had a user retake` : undefined} />
        <StatTile label="User retakes" value={s ? fmtInt(s.userRetakes) : '—'} note="Counts user retakes only, not system re-processing" />
        <StatTile label="Attempt limit reached" value={s ? fmtInt(s.attemptLimitReached) : '—'} note="Sent to Pending Review: “Attempt limit reached – [Phase]”" />
      </div>

      {s && (
        <>
          <ChartCard
            title="Score distribution by phase"
            subtitle={cfg ? `Latest score per session · threshold lines from ${label} config ${cfg.version}` : 'Latest score per session · pick one merchant in the top bar to overlay its Auto-Reject / Auto-Pass lines'}
            busy={loading}
            table={
              <DataTable
                caption="Sessions per score band and phase"
                columns={['Score band', ...CAPTURE_PHASES.map((p) => PHASE_LABELS[p])]}
                rows={s.histograms.DOCUMENT.map((_, i) => [`${i * HISTOGRAM_BIN}–${i === s.histograms.DOCUMENT.length - 1 ? 100 : i * HISTOGRAM_BIN + HISTOGRAM_BIN - 0.1}`, ...CAPTURE_PHASES.map((p) => s.histograms[p][i])])}
              />
            }
          >
            <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
              {CAPTURE_PHASES.map((p) => {
                const pc = cfg?.phases.find((x) => x.phase === p)
                return (
                  <div key={p}>
                    <h3 className="mb-6 text-sm font-medium">
                      {PHASE_LABELS[p]} <span className="font-normal text-muted-foreground">· {fmtInt(s.histograms[p].reduce((a, b) => a + b, 0))} sessions</span>
                    </h3>
                    <ScoreHistogram bins={s.histograms[p]} label={PHASE_LABELS[p]} thresholds={pc?.enabled ? { autoReject: pc.autoReject, autoPass: pc.autoPass } : undefined} />
                  </div>
                )
              })}
            </div>
          </ChartCard>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="User retakes by phase"
              subtitle="The phase the end user had to repeat"
              busy={loading}
              table={<DataTable caption="User retakes by phase" columns={['Phase', 'User retakes']} rows={CAPTURE_PHASES.map((p) => [PHASE_LABELS[p], s.retakesByPhase[p]])} />}
            >
              <BarList unit="user retakes" rows={CAPTURE_PHASES.map((p) => ({ label: PHASE_LABELS[p], value: s.retakesByPhase[p] }))} />
            </ChartCard>
            <ChartCard
              title="Risk level (V4)"
              subtitle={riskTotal ? `${fmtInt(riskTotal)} V4 sessions with a risk result` : 'No V4 sessions with a risk result in scope'}
              busy={loading}
              table={<DataTable caption="Risk levels" columns={['Risk level', 'Sessions', 'Share']} rows={RISK_LEVELS.map((l) => [RISK_LABELS[l], s.riskLevels[l], fmtPct(pct(s.riskLevels[l], riskTotal))])} />}
            >
              <BarList unit="sessions" rows={RISK_LEVELS.map((l) => ({ label: RISK_LABELS[l], value: s.riskLevels[l] }))} />
            </ChartCard>
          </div>
        </>
      )}
    </div>
  )
}

import { OpenQuestionTag } from '@/components/common/OpenQuestionTag'
import { RiskBadge } from '@/components/common/RiskBadge'
import { POLICY } from '@/domain/openQuestions'
import { PHASES, PHASE_LABELS, type MerchantConfig, type MetricResult, type VerificationDetail } from '@/domain/types'
import { cn } from '@/lib/utils'
import { Section } from './Section'

const RESULT_STYLE: Record<MetricResult, string> = {
  PASS: 'text-green-700 dark:text-green-400',
  REVIEW: 'text-amber-700 dark:text-amber-300',
  FAIL: 'text-red-700 dark:text-red-400',
}

// REQ: DEC-10 — metrics are display-only, grouped by phase; thresholds are per phase (the primary metric row).
export function PhaseMetrics({ v, config }: { v: VerificationDetail; config?: MerchantConfig }) {
  const phases = PHASES.filter((p) => p !== 'RISK_ASSESSMENT' && v.metrics.some((m) => m.phase === p))
  return (
    <Section title="Results by phase" aside={<span className="text-xs text-muted-foreground">Thresholds from config {v.configVersion}</span>}>
      {phases.length === 0 ? (
        <p className="text-sm text-muted-foreground">No phase results yet — the end user hasn’t finished a phase.</p>
      ) : (
        <div className="-m-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Metric</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Detected</th>
                <th scope="col" className="px-4 py-2 font-medium">Phase threshold</th>
                <th scope="col" className="px-4 py-2 font-medium">Result</th>
              </tr>
            </thead>
            {phases.map((phase) => (
              <tbody key={phase}>
                <tr className="border-t bg-muted/20">
                  <th scope="rowgroup" colSpan={4} className="px-4 py-1.5 text-left text-xs font-semibold tracking-wide uppercase">
                    {PHASE_LABELS[phase]}
                    {config && !config.phases.find((p) => p.phase === phase)?.enabled && <span className="ml-2 font-normal text-muted-foreground normal-case">(phase disabled in config)</span>}
                  </th>
                </tr>
                {v.metrics
                  .filter((m) => m.phase === phase)
                  .map((m) => (
                    <tr key={m.name} className="border-t">
                      <td className="px-4 py-2">{m.name}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{m.detected}</td>
                      <td className="px-4 py-2 text-muted-foreground">{m.threshold ?? '—'}</td>
                      <td className={cn('px-4 py-2 font-medium', RESULT_STYLE[m.result])}>{m.result}</td>
                    </tr>
                  ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </Section>
  )
}

// REQ: DEC-13 — V4 only.
export function RiskPanel({ v, config }: { v: VerificationDetail; config?: MerchantConfig }) {
  if (v.workflowVersion !== 'V4') return null
  return (
    <Section title="Risk Assessment (V4)" aside={<OpenQuestionTag id="OQ-05/06" />}>
      {v.riskLevel === undefined ? (
        <p className="text-sm text-muted-foreground">No risk result yet — risk runs after all capture phases complete.</p>
      ) : (
        <dl className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <dt className="text-muted-foreground">Risk level</dt>
            <dd className="mt-1">
              <RiskBadge level={v.riskLevel} />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Risk score</dt>
            <dd className="mt-1 tabular-nums">
              {v.riskScore} <span className="text-xs text-muted-foreground">(Medium ≥ {POLICY.riskBands.mediumFrom}, High ≥ {POLICY.riskBands.highFrom})</span>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Max allowed for auto-approval</dt>
            <dd className="mt-1">{config?.risk ? <RiskBadge level={config.risk.maxAllowedLevel} /> : '—'}</dd>
          </div>
        </dl>
      )}
    </Section>
  )
}

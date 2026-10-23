// REQ: DEC-105 — every number the engine produced, with its threshold, result and who sets the threshold.
// Face confidence (a face was detected) and similarity (two faces match) are always separate, labelled rows.
import type { Check, VerificationDetail } from '@/domain/types'
import { ENGINE_THRESHOLDS, duplicateUserText, lastFaceAttempt, flowMetric, idCaptureMetrics, matchedFaceConfidenceMetric, selfieMetrics, type MetricResult, type MetricRow } from '@/domain/telemetry'
import { formatMyt } from '@/lib/format'
import { OUTCOME_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { Section } from './Section'

const RESULT: Record<MetricResult | 'INFO', { label: string; tone: string }> = {
  PASS: { label: 'Pass', tone: 'text-green-700 dark:text-green-400' },
  REVIEW: { label: 'Review band', tone: 'text-amber-700 dark:text-amber-300' },
  FAIL: { label: 'Fail', tone: 'text-red-700 dark:text-red-400' },
  INFO: { label: 'Information only', tone: 'text-muted-foreground' },
}

function ResultText({ result }: { result: MetricResult | 'INFO' }) {
  return <span className={cn('font-medium whitespace-nowrap', RESULT[result].tone)}>{RESULT[result].label}</span>
}

function SetBy({ source }: { source: MetricRow['source'] }) {
  return (
    <span className={cn('rounded border px-1.5 py-0.5 text-[11px] whitespace-nowrap', source === 'FLOW' ? 'border-blue-300 text-blue-800 dark:border-blue-500/40 dark:text-blue-300' : 'text-muted-foreground')}>
      {source === 'FLOW' ? 'Flow' : 'Engine'}
    </span>
  )
}

type Group = { stage: string; rows: (MetricRow | (Omit<MetricRow, 'result'> & { result: 'INFO' }))[] }

function groups(v: VerificationDetail): Group[] {
  const out: Group[] = []
  const face = lastFaceAttempt(v)
  const ev = (c: Check) => v.checks.find((x) => x.check === c)
  if (v.idCapture) out.push({ stage: 'ID capture', rows: idCaptureMetrics(v.idCapture, v.documentType) })
  if (face?.telemetry?.selfie) out.push({ stage: 'Selfie', rows: selfieMetrics(face.telemetry.selfie) })
  const fm = ev('FACE_MATCH')
  if (fm?.lastScore !== undefined) {
    const label = v.steps.faceMatchMethod === 'ID_VS_SELFIE' ? 'Similarity (ID vs selfie)' : 'Similarity (ID vs liveness face)'
    const conf = v.attempts.findLast((a) => a.telemetry?.matchedFaceConfidence !== undefined)?.telemetry?.matchedFaceConfidence
    out.push({ stage: 'Face match', rows: [flowMetric('faceMatch.similarity', label, fm.lastScore, fm.thresholds), ...(conf === undefined ? [] : [matchedFaceConfidenceMetric(conf)])] })
  }
  const lv = ev('LIVENESS')
  if (lv?.lastScore !== undefined) out.push({ stage: 'Liveness', rows: [flowMetric('liveness.confidence', 'Liveness confidence', lv.lastScore, lv.thresholds)] })
  if (v.duplicateUser)
    out.push({
      stage: 'Duplicate user',
      rows: [{ id: 'duplicate', label: 'Face search', value: duplicateUserText(v.duplicateUser), threshold: `≥ ${ENGINE_THRESHOLDS.duplicateSimilarityMin} = existing user`, source: 'ENGINE', result: 'INFO' }],
    })
  return out
}

/** REQ: DEC-105 — all metrics of the latest attempt (earlier attempts are under Attempts). */
export function TelemetrySection({ v }: { v: VerificationDetail }) {
  const gs = groups(v)
  return (
    <Section title="Telemetry" aside={<span className="text-xs text-muted-foreground">Latest attempt · thresholds set by the flow or fixed by the engine</span>}>
      {!gs.length ? (
        <p className="text-sm text-muted-foreground">Nothing submitted yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Telemetry">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">Metric</th>
                <th className="py-1.5 pr-3 font-medium">Value</th>
                <th className="py-1.5 pr-3 font-medium">Threshold</th>
                <th className="py-1.5 pr-3 font-medium">Result</th>
                <th className="py-1.5 font-medium">Set by</th>
              </tr>
            </thead>
            {gs.map((g) => (
              <tbody key={g.stage}>
                <tr>
                  <th scope="rowgroup" colSpan={5} className="bg-muted/50 px-2 py-1 text-left text-xs font-semibold">
                    {g.stage}
                  </th>
                </tr>
                {g.rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <th scope="row" className="py-1.5 pr-3 pl-2 text-left font-normal">{r.label}</th>
                    <td className="py-1.5 pr-3 tabular-nums">{r.value}</td>
                    <td className="py-1.5 pr-3 text-xs text-muted-foreground">{r.threshold}</td>
                    <td className="py-1.5 pr-3"><ResultText result={r.result} /></td>
                    <td className="py-1.5"><SetBy source={r.source} /></td>
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

const n1 = (x?: number) => (x === undefined ? '—' : x.toFixed(1))

/** REQ: DEC-17 / DEC-105 — each attempt under the same Reference ID, with its face image and every score. */
export function AttemptsSection({ v }: { v: VerificationDetail }) {
  const v1 = v.steps.faceMatchMethod === 'ID_VS_SELFIE'
  const hasLiveness = v.checks.some((c) => c.check === 'LIVENESS')
  return (
    <Section title="Attempts" aside={<span className="text-xs text-muted-foreground">Same Reference ID for every retry</span>}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-label="Attempts">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-1.5 pr-3 font-medium">Attempt</th>
              <th className="py-1.5 pr-3 font-medium">Started (MYT)</th>
              <th className="py-1.5 pr-3 font-medium">Outcome</th>
              <th className="py-1.5 pr-3 font-medium">Face</th>
              <th className="py-1.5 pr-3 text-right font-medium">Similarity</th>
              <th className="py-1.5 pr-3 text-right font-medium">Matched face confidence</th>
              {hasLiveness && <th className="py-1.5 pr-3 text-right font-medium">Liveness confidence</th>}
              {v1 && <th className="py-1.5 font-medium">Selfie quality</th>}
            </tr>
          </thead>
          <tbody>
            {v.attempts.map((a) => {
              const selfie = a.telemetry?.selfie ? selfieMetrics(a.telemetry.selfie) : undefined
              const failed = selfie?.filter((r) => r.result === 'FAIL') ?? []
              return (
                <tr key={a.attemptId} className="border-b align-top last:border-0">
                  <th scope="row" className="py-1.5 pr-3 text-left font-normal">Attempt {a.attemptNo}</th>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{formatMyt(a.startedAt)}</td>
                  <td className="py-1.5 pr-3">{OUTCOME_LABELS[a.outcome]}</td>
                  <td className="py-1.5 pr-3">
                    {a.faceImage ? <img src={a.faceImage.url} alt={`Face, attempt ${a.attemptNo} (sample image, not real)`} className="h-12 w-10 rounded border object-cover" /> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{n1(a.phaseScores.FACE_MATCH)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{n1(a.telemetry?.matchedFaceConfidence)}</td>
                  {hasLiveness && <td className="py-1.5 pr-3 text-right tabular-nums">{n1(a.phaseScores.LIVENESS)}</td>}
                  {v1 && (
                    <td className="py-1.5">
                      {selfie ? (
                        <details>
                          <summary className="cursor-pointer">{failed.length ? `${failed.length} of ${selfie.length} fail` : `All ${selfie.length} pass`}</summary>
                          <ul className="mt-1 space-y-0.5 text-xs">
                            {selfie.map((r) => (
                              <li key={r.id}>
                                {r.label}: <span className="tabular-nums">{r.value}</span> <span className="text-muted-foreground">({r.threshold})</span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

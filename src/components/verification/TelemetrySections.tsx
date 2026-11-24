// REQ: DEC-105 — every number the engine produced, with its threshold, result and who sets the threshold.
// "Face match" (the flow band on the similarity with the ID photo) and "Face detection confidence" are separate rows.
import { Fragment } from 'react'
import type { Check, VerificationDetail } from '@/domain/types'
import { ENGINE_THRESHOLDS, duplicateUserText, lastFaceAttempt, flowMetric, idCaptureMetrics, faceMatchMetric, selfieMetrics, type MetricResult, type MetricRow } from '@/domain/telemetry'
import { formatMyt } from '@/lib/format'
import { OUTCOME_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { Section } from './Section'

const RESULT: Record<MetricResult, { label: string; tone: string }> = {
  PASS: { label: 'Pass', tone: 'text-green-700 dark:text-green-400' },
  REVIEW: { label: 'Review band', tone: 'text-amber-700 dark:text-amber-300' },
  FAIL: { label: 'Fail', tone: 'text-red-700 dark:text-red-400' },
  INFO: { label: 'Information only', tone: 'text-muted-foreground' },
}

function ResultText({ result }: { result: MetricResult }) {
  return <span className={cn('font-medium whitespace-nowrap', RESULT[result].tone)}>{RESULT[result].label}</span>
}


type Group = { stage: string; rows: MetricRow[] }

function groups(v: VerificationDetail): Group[] {
  const out: Group[] = []
  const face = lastFaceAttempt(v)
  const ev = (c: Check) => v.checks.find((x) => x.check === c)
  if (v.idCapture) out.push({ stage: 'ID capture', rows: idCaptureMetrics(v.idCapture, v.documentType) })
  if (face?.telemetry?.selfie) out.push({ stage: 'Selfie', rows: selfieMetrics(face.telemetry.selfie) })
  const rejected = !face?.telemetry?.selfie ? face?.telemetry?.selfieRetakes?.at(-1) : undefined
  // REQ: DEC-105 — W1: the selfie failed its quality check, so the run ended before the face comparison.
  if (rejected) out.push({ stage: 'Selfie (rejected: not compared with the ID)', rows: selfieMetrics(rejected) })
  const fm = ev('FACE_MATCH')
  const subject = v.steps.faceMatchMethod === 'ID_VS_SELFIE' ? 'selfie' : 'liveness face'
  if (fm?.lastScore !== undefined) {
    const conf = v.attempts.findLast((a) => a.telemetry?.faceMatchConfidence !== undefined)?.telemetry?.faceMatchConfidence
    out.push({
      stage: `Face match (${subject} vs ID)`,
      rows: [flowMetric('compare.faceMatch', 'Face match (similarity)', fm.lastScore, fm.thresholds), ...(conf === undefined ? [] : [faceMatchMetric(conf)])],
    })
  } else if (rejected) {
    out.push({ stage: `Face match (${subject} vs ID)`, rows: [{ id: 'compare.notRun', label: 'Face match (similarity)', value: 'Not run', threshold: 'The selfie must pass its check first', source: 'ENGINE', result: 'INFO' }] })
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
    <Section title="Telemetry" aside={<span className="text-xs text-muted-foreground">Latest attempt</span>}>
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
                <th className="py-1.5 font-medium">Result</th>
              </tr>
            </thead>
            {gs.map((g) => (
              <tbody key={g.stage}>
                <tr>
                  <th scope="rowgroup" colSpan={4} className="bg-muted/50 px-2 py-1 text-left text-xs font-semibold">
                    {g.stage}
                  </th>
                </tr>
                {g.rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <th scope="row" className="py-1.5 pr-3 pl-2 text-left font-normal">{r.label}</th>
                    <td className="py-1.5 pr-3 tabular-nums">{r.value}</td>
                    <td className="py-1.5 pr-3 text-xs text-muted-foreground">{r.threshold}</td>
                    <td className="py-1.5"><ResultText result={r.result} /></td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
          <p className="mt-2 text-xs text-muted-foreground">
            Face match: the similarity of the face with the ID photo, judged by the flow's band. Face detection confidence: a face is clearly detected (not liveness).
          </p>
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
    <Section
      title="Attempts"
      aside={<span className="text-xs text-muted-foreground">{v.sessionRows.length > 1 ? `Session ${v.sessionRows.length} (current) · ` : ''}Same Reference ID for every retry</span>}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-label="Attempts">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-1.5 pr-3 font-medium">Attempt</th>
              <th className="py-1.5 pr-3 font-medium">Started (MYT)</th>
              <th className="py-1.5 pr-3 font-medium">Outcome</th>
              <th className="py-1.5 pr-3 font-medium">Face</th>
              <th className="py-1.5 pr-3 text-right font-medium">Face match (similarity)</th>
              <th className="py-1.5 pr-3 text-right font-medium">Face detection confidence</th>
              {hasLiveness && <th className="py-1.5 pr-3 text-right font-medium">Liveness confidence</th>}
              {v1 && <th className="py-1.5 font-medium">Selfie quality</th>}
            </tr>
          </thead>
          <tbody>
            {v.attempts.map((a) => {
              const selfie = a.telemetry?.selfie ? selfieMetrics(a.telemetry.selfie) : undefined
              const failed = selfie?.filter((r) => r.result === 'FAIL') ?? []
              const retakes = a.telemetry?.selfieRetakes ?? []
              return (
                <Fragment key={a.attemptId}>
                {/* REQ: DEC-105 / DEC-108 / DEC-60 — W1: submitted selfies rejected by the quality check use a selfie retry and a token; never compared with the ID. */}
                {retakes.map((t, i) => (
                  <tr key={`${a.attemptId}-r${i}`} className="border-b align-top text-muted-foreground">
                    <th scope="row" className="py-1.5 pr-3 text-left font-normal">Attempt {a.attemptNo} · selfie retake</th>
                    <td className="py-1.5 pr-3" />
                    <td className="py-1.5 pr-3">Selfie rejected</td>
                    <td className="py-1.5 pr-3">—</td>
                    <td className="py-1.5 pr-3 text-right">Not run</td>
                    <td className="py-1.5 pr-3 text-right">Not run</td>
                    {hasLiveness && <td className="py-1.5 pr-3 text-right">—</td>}
                    {v1 && <td className="py-1.5 text-red-700 dark:text-red-400">Fail: {selfieMetrics(t).filter((m) => m.result === 'FAIL').map((m) => `${m.label} ${m.value}`).join(', ')}</td>}
                  </tr>
                ))}
                <tr className="border-b align-top last:border-0">
                  <th scope="row" className="py-1.5 pr-3 text-left font-normal">Attempt {a.attemptNo}</th>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{formatMyt(a.startedAt)}</td>
                  <td className="py-1.5 pr-3">{OUTCOME_LABELS[a.outcome]}</td>
                  <td className="py-1.5 pr-3">
                    {a.faceImage ? <img src={a.faceImage.url} alt={`Face, attempt ${a.attemptNo} (sample image, not real)`} className="h-12 w-10 rounded border object-cover" /> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{n1(a.phaseScores.FACE_MATCH)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{n1(a.telemetry?.faceMatchConfidence)}</td>
                  {hasLiveness && <td className="py-1.5 pr-3 text-right tabular-nums">{n1(a.phaseScores.LIVENESS)}</td>}
                  {v1 && (
                    <td className="py-1.5">
                      {selfie ? (
                        <details>
                          <summary className="cursor-pointer">{failed.length ? `${failed.length} checks fail` : 'Passed'}</summary>
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
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

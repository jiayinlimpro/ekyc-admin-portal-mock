// REQ: DEC-105 — Verification Detail sections (hybrid layout). Values come from the case and the flow revision it started
// on (DEC-52). Every number is shown; only face match and liveness thresholds are set by the flow (DEC-10).
import { Info } from 'lucide-react'
import { OpenQuestionTag } from '@/components/common/OpenQuestionTag'
import { RiskBadge } from '@/components/common/RiskBadge'
import type { CheckEvaluation, CheckState } from '@/domain/checkRules'
import { bandText, duplicateUserText, idCaptureMetrics, lastFaceAttempt, selfieMetrics } from '@/domain/telemetry'
import { PRESET_LABELS } from '@/domain/thresholds'
import { RISK_CATEGORIES, RISK_CATEGORY_LABELS, type Check, type ThresholdChoice, type VerificationDetail } from '@/domain/types'
import { DOCUMENT_TYPE_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { Fields, Section } from './Section'

const STATE: Record<CheckState, { label: string; tone: string }> = {
  PENDING: { label: 'Not submitted yet', tone: 'text-muted-foreground' },
  RETRY: { label: 'Below Auto-Pass · retry pending', tone: 'text-amber-700 dark:text-amber-300' },
  PASS: { label: 'Pass', tone: 'text-green-700 dark:text-green-400' },
  REVIEW: { label: 'Review band', tone: 'text-amber-700 dark:text-amber-300' },
  REJECT: { label: 'Below Auto-Reject', tone: 'text-red-700 dark:text-red-400' },
}

export const Result = ({ state }: { state: CheckState }) => <span className={cn('font-medium', STATE[state].tone)}>{STATE[state].label}</span>

const PASS_TONE = 'font-medium text-green-700 dark:text-green-400'
const FAIL_TONE = 'font-medium text-red-700 dark:text-red-400'

const thresholdText = (choice: ThresholdChoice, e: Pick<CheckEvaluation, 'thresholds'>) => `${PRESET_LABELS[choice.preset]} · ${bandText(e.thresholds)}`

const SIMILARITY_TONE: Record<CheckState, string> = {
  PENDING: 'bg-muted text-muted-foreground',
  RETRY: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100',
  REVIEW: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100',
  PASS: 'bg-green-100 text-green-900 dark:bg-green-500/20 dark:text-green-100',
  REJECT: 'bg-red-100 text-red-900 dark:bg-red-500/20 dark:text-red-100',
}

/** REQ: DEC-105 — the document front and the matched face side by side, with the similarity. */
export function EvidenceSection({ v }: { v: VerificationDetail }) {
  const doc = DOCUMENT_TYPE_LABELS[v.documentType]
  const face = lastFaceAttempt(v)
  const fm = v.checks.find((c) => c.check === 'FACE_MATCH')
  const similarity = face?.phaseScores.FACE_MATCH
  const faceLabel = v.steps.faceMatchMethod === 'ID_VS_SELFIE' ? 'Selfie' : 'Liveness frame'
  return (
    <Section title="Evidence">
      <div className="grid grid-cols-2 gap-3">
        <figure>
          <img src={v.images.docFront.url} alt={`${doc} front (sample image, not real)`} className="aspect-[4/5] w-full rounded-md border object-cover" />
          <figcaption className="mt-1 text-xs text-muted-foreground">{doc} front</figcaption>
        </figure>
        <figure>
          {face ? (
            <img src={face.faceImage!.url} alt={`${faceLabel}, attempt ${face.attemptNo} (sample image, not real)`} className="aspect-[4/5] w-full rounded-md border object-cover" />
          ) : (
            <div className="flex aspect-[4/5] w-full items-center justify-center rounded-md border border-dashed p-2 text-center text-xs text-muted-foreground">No face submitted yet</div>
          )}
          <figcaption className="mt-1 text-xs text-muted-foreground">{face ? `${faceLabel} · attempt ${face.attemptNo}${similarity === undefined ? ' (rejected)' : ''}` : faceLabel}</figcaption>
        </figure>
      </div>
      {similarity !== undefined && fm && (
        <p className={cn('mt-3 rounded-md px-3 py-2 text-sm', SIMILARITY_TONE[fm.state])}>
          <span className="font-semibold tabular-nums">Similarity {similarity.toFixed(1)}</span> · <Result state={fm.state} />
          <span className="block text-xs opacity-80">Face vs ID · {bandText(fm.thresholds)}</span>
        </p>
      )}
      {similarity === undefined && !!face?.telemetry?.selfieRetakes?.length && (
        <p className="mt-3 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">Not compared: the selfie failed its quality check.</p>
      )}
    </Section>
  )
}

function CheckLine({ v, check }: { v: VerificationDetail; check: Check }) {
  const e = v.checks.find((c) => c.check === check)
  if (!e) return null
  return (
    <div className="space-y-0.5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="tabular-nums">{e.lastScore === undefined ? '—' : e.lastScore.toFixed(1)}</span>
        <Result state={e.state} />
      </div>
      <div className="text-xs text-muted-foreground">
        {thresholdText(v.rulesApplied.checks[check].threshold, e)} · {e.retriesUsed} of {e.retriesAllowed} retries used
      </div>
    </div>
  )
}

/** REQ: DEC-105 — one line per stage: the result and its key number. The full metrics are in Telemetry. */
export function ChecksSection({ v }: { v: VerificationDetail }) {
  const idRows = v.idCapture ? idCaptureMetrics(v.idCapture, v.documentType) : []
  const idFailed = idRows.filter((r) => r.result === 'FAIL')
  const face = lastFaceAttempt(v)
  const selfie = face?.telemetry?.selfie ? selfieMetrics(face.telemetry.selfie) : undefined
  const selfieRetakes = v.attempts.reduce((n, a) => n + (a.telemetry?.selfieRetakes?.length ?? 0), 0)
  const rejectedSelfie = !selfie && face?.telemetry?.selfieRetakes?.length
  const items: [string, React.ReactNode][] = [
    [
      'ID capture',
      <div key="id" className="space-y-0.5">
        {!v.idCapture ? (
          <span className="text-muted-foreground">Not submitted yet</span>
        ) : idFailed.length ? (
          <span className={FAIL_TONE}>Fail: {idFailed.map((r) => r.label).join(', ')}</span>
        ) : (
          <span className={PASS_TONE}>Pass</span>
        )}
        <div className="text-xs text-muted-foreground">{v.idCaptureSoftRejects} retake(s) before this image · free, not counted as retries</div>
      </div>,
    ],
  ]
  if (v.steps.phases.includes('SELFIE_CAPTURE'))
    items.push([
      'Selfie',
      <div key="s" className="space-y-0.5">
        {selfie ? <span className={PASS_TONE}>Pass</span> : rejectedSelfie ? <span className={FAIL_TONE}>Fail: not compared with the ID</span> : <span className="text-muted-foreground">Not captured yet</span>}
        {selfieRetakes > 0 && <div className="text-xs text-muted-foreground">{selfieRetakes} selfie(s) rejected by the quality check · free retakes, never compared</div>}
      </div>,
    ])
  // REQ: DEC-105 — the flow-set check is the similarity of the face with the ID; "Face match" (real face) is in Telemetry.
  if (v.checks.some((c) => c.check === 'FACE_MATCH')) items.push([v.steps.faceMatchMethod === 'ID_VS_SELFIE' ? 'Similarity (selfie vs ID)' : 'Similarity (liveness face vs ID)', <CheckLine key="fm" v={v} check="FACE_MATCH" />])
  if (v.checks.some((c) => c.check === 'LIVENESS')) items.push(['Liveness', <CheckLine key="lv" v={v} check="LIVENESS" />])
  items.push([
    'Duplicate user',
    <div key="dup" className="space-y-0.5">
      <span className={cn(v.duplicateUser?.existingUser && 'font-medium text-amber-700 dark:text-amber-300')}>{duplicateUserText(v.duplicateUser)}</span>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Info className="size-3" aria-hidden /> Information only: never changes the result
      </div>
    </div>,
  ])
  return (
    <Section title="Checks">
      <Fields items={items} />
    </Section>
  )
}

/** REQ: DEC-107 — V4/V5: Clear / Flagged, and each category's 0–100 score against its minimum (higher = more genuine). */
export function RiskSection({ v }: { v: VerificationDetail }) {
  if (!v.steps.runsRisk) return null
  const minimums = v.rulesApplied.risk?.minimums
  return (
    <Section title="Risk Assessment" aside={v.riskResult && <RiskBadge result={v.riskResult} />}>
      {!v.riskScores || !minimums ? (
        <p className="text-sm text-muted-foreground">Not run yet: risk runs once onboarding completes without a reject.</p>
      ) : (
        <div className="space-y-2">
          <table className="w-full text-sm" aria-label="Risk categories">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-1 pr-2 font-medium">Category</th>
                <th className="py-1 pr-2 text-right font-medium">Score</th>
                <th className="py-1 pr-2 text-right font-medium">Minimum</th>
                <th className="py-1 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {RISK_CATEGORIES.map((c) => {
                const below = v.riskScores![c] < minimums[c]
                return (
                  <tr key={c} className="border-b last:border-0">
                    <th scope="row" className="py-1.5 pr-2 text-left font-normal whitespace-nowrap">{RISK_CATEGORY_LABELS[c]}</th>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{v.riskScores![c]}</td>
                    <td className="py-1.5 pr-2 text-right text-muted-foreground tabular-nums">{minimums[c]}</td>
                    <td className="py-1.5">{below ? <span className="font-medium text-amber-700 dark:text-amber-300">Below minimum</span> : <span className={PASS_TONE}>OK</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            Scores 0–100, higher is more genuine. Minimums {v.steps.riskMinimumsPerFlow ? 'set by this flow' : 'fixed by the platform'}. How scores are computed <OpenQuestionTag id="OQ-25" />
          </p>
        </div>
      )}
    </Section>
  )
}

/** REQ: DEC-44 / DEC-52 — the settings snapshot the case was evaluated with. */
export function RulesAppliedSection({ v }: { v: VerificationDetail }) {
  const r = v.rulesApplied
  const check = (c: Check) => {
    const e = v.checks.find((x) => x.check === c)
    return e ? `${thresholdText(r.checks[c].threshold, e)} · ${r.checks[c].retriesAllowed} retries` : undefined
  }
  return (
    <Section title="Rules applied" aside={<span className="font-mono text-xs text-muted-foreground">{v.revisionLabel}</span>}>
      <Fields
        items={[
          ['Similarity (face vs ID)', check('FACE_MATCH')],
          ['Liveness', check('LIVENESS')],
          ['Cooldown', r.cooldownMin > 0 ? `${r.cooldownMin} min after a rejection` : 'None'],
          ['Accepted documents', r.acceptedDocuments.map((d) => DOCUMENT_TYPE_LABELS[d]).join(', ')],
          ['Session expiry', Number.isFinite(r.sessionExpiryMin) ? `${r.sessionExpiryMin} min` : undefined],
          ...(r.risk ? ([['Risk minimums', r.risk.enabled ? RISK_CATEGORIES.map((c) => `${RISK_CATEGORY_LABELS[c].replace(' Score', '')} ${r.risk!.minimums[c]}`).join(' · ') : 'Off']] as [string, string][]) : []),
        ]}
      />
      <p className="mt-3 text-xs text-muted-foreground">Settings saved later apply to new sessions only.</p>
    </Section>
  )
}

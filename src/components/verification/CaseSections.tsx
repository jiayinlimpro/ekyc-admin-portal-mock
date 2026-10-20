// REQ: DEC-44 — Verification Detail sections. All values come from the case and the flow revision it started on (DEC-52).
// Granular metrics are never shown (DEC-10).
import { OpenQuestionTag } from '@/components/common/OpenQuestionTag'
import { RiskBadge } from '@/components/common/RiskBadge'
import type { CheckEvaluation, CheckState } from '@/domain/checkRules'
import { RISK_LEVELS, PHASE_LABELS, type Check, type ThresholdChoice, type VerificationDetail } from '@/domain/types'
import { PRESET_LABELS } from '@/domain/thresholds'
import { formatUpdatedBy } from '@/domain/audit'
import { formatMyt } from '@/lib/format'
import { AUDIT_ACTION_LABELS, DOCUMENT_TYPE_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { Fields, Section } from './Section'

const STATE: Record<CheckState, { label: string; tone: string }> = {
  PENDING: { label: 'Not submitted yet', tone: 'text-muted-foreground' },
  RETRY: { label: 'Below Auto-Pass · retry pending', tone: 'text-amber-700 dark:text-amber-300' },
  PASS: { label: 'Pass', tone: 'text-green-700 dark:text-green-400' },
  REVIEW: { label: 'Review band', tone: 'text-amber-700 dark:text-amber-300' },
  REJECT: { label: 'Below Auto-Reject', tone: 'text-red-700 dark:text-red-400' },
}

const Result = ({ state }: { state: CheckState }) => <span className={cn('font-medium', STATE[state].tone)}>{STATE[state].label}</span>

const threshold = (choice: ThresholdChoice, e: Pick<CheckEvaluation, 'thresholds'>) =>
  `${PRESET_LABELS[choice.preset]} · reject < ${e.thresholds.autoReject} · approve ≥ ${e.thresholds.autoPass}`

function Scores({ scores }: { scores: readonly number[] }) {
  if (!scores.length) return <span className="text-muted-foreground">—</span>
  return (
    <ol className="flex flex-wrap gap-1.5" aria-label="Scores in submission order">
      {scores.map((s, i) => (
        <li key={i} className={cn('rounded border px-1.5 text-xs tabular-nums', i === scores.length - 1 && 'border-foreground/40 font-medium')}>
          {s}
        </li>
      ))}
    </ol>
  )
}

/** Face match or liveness: result, threshold applied, scores, retries used / allowed (and cooldown for liveness). */
export function CheckSection({ v, check }: { v: VerificationDetail; check: Check }) {
  const e = v.checks.find((c) => c.check === check)
  if (!e) return null
  const method = check === 'FACE_MATCH' ? (v.steps.faceMatchMethod === 'ID_VS_SELFIE' ? 'ID vs selfie' : 'ID vs liveness face') : undefined
  const items: [string, React.ReactNode][] = [
    ['Result', <Result key="r" state={e.state} />],
    ...(method ? ([['Compares', method]] as [string, string][]) : []),
    ['Threshold applied', threshold(v.rulesApplied.checks[check].threshold, e)],
    ['Scores', <Scores key="s" scores={v.submissions[check] ?? []} />],
    ['Retries used', `${e.retriesUsed} of ${e.retriesAllowed} allowed`],
  ]
  if (check === 'LIVENESS') {
    items.push(['Cooldown applied', v.rulesApplied.cooldownMin > 0 ? `${v.rulesApplied.cooldownMin} min after a rejection` : 'None'])
    if (v.newCaseAllowedAt) items.push(['New case allowed from', `${formatMyt(v.newCaseAllowedAt)} MYT`])
  }
  return (
    <Section title={PHASE_LABELS[check]}>
      <Fields items={items} />
    </Section>
  )
}

/** ID capture: images, result and soft rejects. Retakes are unlimited and free (DEC-18). */
export function IdCaptureSection({ v }: { v: VerificationDetail }) {
  const reached = v.checks.some((c) => c.state !== 'PENDING')
  return (
    <Section title={`ID capture · ${DOCUMENT_TYPE_LABELS[v.documentType]}`}>
      <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
        <figure>
          <img src={v.images.docFront} alt={`${DOCUMENT_TYPE_LABELS[v.documentType]} front (sample image, not real)`} className="w-full rounded-md border" />
          <figcaption className="mt-1 text-xs text-muted-foreground">Document front</figcaption>
        </figure>
        <Fields
          items={[
            ['Result', reached ? <span key="r" className="font-medium text-green-700 dark:text-green-400">Passed</span> : <span key="r" className="text-muted-foreground">Not completed yet</span>],
            ['Soft rejects', `${v.idCaptureSoftRejects} retake(s) · free, not counted as retries`],
          ]}
        />
      </div>
    </Section>
  )
}

/** Selfie: V1 only (the registry version has a Selfie Capture phase). Retakes are unlimited and free; no thresholds. */
export function SelfieSection({ v }: { v: VerificationDetail }) {
  if (!v.steps.phases.includes('SELFIE_CAPTURE')) return null
  const taken = (v.submissions.FACE_MATCH?.length ?? 0) > 0
  return (
    <Section title="Selfie">
      <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
        <figure>
          <img src={v.images.selfie} alt="Selfie (sample image, not real)" className="w-full rounded-md border" />
          <figcaption className="mt-1 text-xs text-muted-foreground">Selfie</figcaption>
        </figure>
        <Fields items={[['Result', taken ? <span key="r" className="font-medium text-green-700 dark:text-green-400">Captured</span> : <span key="r" className="text-muted-foreground">Not captured yet</span>]]} />
      </div>
    </Section>
  )
}

/** REQ: DEC-13 — V4/V5. Components and their reason codes are OQ-25; the overall score and level are shown. */
export function RiskSection({ v }: { v: VerificationDetail }) {
  if (!v.steps.runsRisk) return null
  const max = v.rulesApplied.risk?.maxAllowedLevel
  const passes = v.riskLevel && max ? RISK_LEVELS.indexOf(v.riskLevel) <= RISK_LEVELS.indexOf(max) : undefined
  return (
    <Section title="Risk Assessment">
      {v.riskLevel === undefined ? (
        <p className="text-sm text-muted-foreground">Not run yet: risk runs once onboarding completes without a reject.</p>
      ) : (
        <Fields
          items={[
            ['Overall', <span key="o" className="flex items-center gap-2"><RiskBadge level={v.riskLevel} /><span className="tabular-nums">{v.riskScore} / 100</span></span>],
            ['Maximum allowed', max ? <RiskBadge key="m" level={max} /> : '—'],
            ['Result', passes ? <span key="r" className="font-medium text-green-700 dark:text-green-400">Pass</span> : <span key="r" className="font-medium text-amber-700 dark:text-amber-300">Not passed · sent to review</span>],
            ['Components', <span key="c" className="flex flex-wrap items-center gap-2 text-muted-foreground">Component scores and reason codes not defined yet <OpenQuestionTag id="OQ-25" /></span>],
          ]}
        />
      )}
    </Section>
  )
}

/** REQ: DEC-44 / DEC-52 — the settings snapshot the case was evaluated with. */
export function RulesAppliedSection({ v }: { v: VerificationDetail }) {
  const r = v.rulesApplied
  const check = (c: Check) => {
    const e = v.checks.find((x) => x.check === c)
    return e ? `${threshold(r.checks[c].threshold, e)} · ${r.checks[c].retriesAllowed} retries` : undefined
  }
  return (
    <Section title="Rules applied" aside={<span className="font-mono text-xs text-muted-foreground">{v.revisionLabel}</span>}>
      <Fields
        items={[
          ['Face match', check('FACE_MATCH')],
          ['Liveness', check('LIVENESS')],
          ['Cooldown', r.cooldownMin > 0 ? `${r.cooldownMin} min` : 'None'],
          ['Accepted documents', r.acceptedDocuments.map((d) => DOCUMENT_TYPE_LABELS[d]).join(', ')],
          ['Session expiry', Number.isFinite(r.sessionExpiryMin) ? `${r.sessionExpiryMin} min` : undefined],
          ...(r.risk ? ([['Risk', r.risk.enabled ? `Maximum allowed level ${r.risk.maxAllowedLevel}` : 'Off']] as [string, string][]) : []),
        ]}
      />
      <p className="mt-3 text-xs text-muted-foreground">Settings saved later apply to new sessions only.</p>
    </Section>
  )
}

const KIND_LABELS: Record<'SESSION_STARTED' | 'SUBMISSION' | 'SYSTEM_RESULT', string> = {
  SESSION_STARTED: 'Session started',
  SUBMISSION: 'Submission',
  SYSTEM_RESULT: 'Automated result',
}

export function ActivitySection({ v }: { v: VerificationDetail }) {
  return (
    <Section title="Activity">
      <ol className="space-y-3 border-l pl-4">
        {v.activity.map((a, i) => (
          <li key={i} className="relative text-sm">
            <span className="absolute top-1.5 -left-[1.3rem] size-2 rounded-full bg-muted-foreground/50" aria-hidden />
            <div className="font-medium">{a.kind in KIND_LABELS ? KIND_LABELS[a.kind as keyof typeof KIND_LABELS] : AUDIT_ACTION_LABELS[a.kind as keyof typeof AUDIT_ACTION_LABELS]}</div>
            <div className="text-xs text-muted-foreground">
              {formatMyt(a.at)} MYT · {formatUpdatedBy(a.by)}
            </div>
            {a.detail && <div className="mt-0.5 text-xs">{a.detail}</div>}
          </li>
        ))}
      </ol>
    </Section>
  )
}

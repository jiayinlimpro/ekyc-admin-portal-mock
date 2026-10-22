import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { AlertTriangle, ArrowLeft, FlaskConical } from 'lucide-react'
import { toast } from 'sonner'
import { useAccess } from '@/app/access'
import { FormField } from '@/components/common/FormField'
import { NativeSelect } from '@/components/common/NativeSelect'
import { OpenQuestionTag } from '@/components/common/OpenQuestionTag'
import { EmptyState, ErrorState } from '@/components/common/States'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { canInProject } from '@/domain/access'
import type { ImpactSummary } from '@/domain/flowImpact'
import { revisionLabel } from '@/domain/flowRules'
import { MIN_REASON_LENGTH } from '@/domain/flowSettings'
import { hasRisk } from '@/domain/registryRules'
import { RISK_LEVELS, VERIFICATION_STATUSES, type DocumentType, type FlowSettings, type RiskLevel } from '@/domain/types'
import { errorMessage, useLoad } from '@/hooks/useLoad'
import { formatMyt } from '@/lib/format'
import { DOCUMENT_TYPE_LABELS, RISK_LABELS, STATUS_LABELS } from '@/lib/labels'
import { isServiceError } from '@/services/errors'
import { flowService, type FlowDetail, type FlowEdit } from '@/services/flowService'
import { useSession } from '@/stores/sessionStore'
import { FlowStatusBadge } from './FlowsListPage'
import { ThresholdCard } from './ThresholdCard'
import { Card } from '../projects/settingsUi'
import { CopyId } from '@/components/common/CopyId'

const DOCUMENTS: DocumentType[] = ['MYKAD', 'PASSPORT', 'DRIVING_LICENSE']

/** History wording for the fields recorded by flowSettings.diffFlow. */
const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  description: 'Description',
  'checks.FACE_MATCH.threshold': 'Face match threshold',
  'checks.FACE_MATCH.retriesAllowed': 'Face match retries allowed',
  'checks.LIVENESS.threshold': 'Liveness threshold',
  'checks.LIVENESS.retriesAllowed': 'Liveness retries allowed',
  cooldownMin: 'Cooldown (min)',
  sessionExpiryMin: 'Session expiry (min)',
  acceptedDocuments: 'Accepted documents',
  'risk.enabled': 'Risk assessment on',
  'risk.maxAllowedLevel': 'Maximum allowed risk level',
}

const numberOrNaN = (s: string) => (s.trim() === '' ? Number.NaN : Number(s))
const shown = (n: number) => (Number.isFinite(n) ? String(n) : '')

function Preview({ result }: { result: ImpactSummary & { days: number } }) {
  return (
    <div className="space-y-2">
      <p className="text-sm">
        {result.total === 0 ? `No finished sessions in the last ${result.days} days.` : `${result.changed} of ${result.total} finished sessions in the last ${result.days} days would end differently.`}
      </p>
      {result.total > 0 && (
        <table className="text-sm">
          <caption className="sr-only">What-if results</caption>
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="pr-6 font-medium">Result</th>
              <th scope="col" className="pr-6 text-right font-medium">Current settings</th>
              <th scope="col" className="text-right font-medium">Edited settings</th>
            </tr>
          </thead>
          <tbody>
            {VERIFICATION_STATUSES.map((s) => (
              <tr key={s}>
                <th scope="row" className="pr-6 text-left font-normal">{s === 'PROCESSING' ? 'Would still be retrying' : STATUS_LABELS[s]}</th>
                <td className="pr-6 text-right tabular-nums">{result.before[s]}</td>
                <td className="text-right tabular-nums">{result.after[s]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function Editor({ detail, onSaved }: { detail: FlowDetail; onSaved: () => void }) {
  const actor = useSession((s) => s.actor)
  const { account, projects } = useAccess()
  const { flow, entry } = detail
  const project = projects.find((p) => p.projectId === flow.projectId)
  const canSetAdvanced = !!account && !!project && canInProject(account, 'setAdvancedThresholds', project)
  // REQ: DEC-70 — thresholds, retries and risk level need Change verification level and retries.
  const canChangeLevel = !!account && !!project && canInProject(account, 'changeVerificationLevel', project)
  // REQ: DEC-99 / DEC-102 — Flows View is read-only; saving needs Edit (staff: Flows Edit).
  const canEdit = !!account && !!project && canInProject(account, 'editFlows', project)
  const editable = canEdit && (flow.status === 'DRAFT' || flow.status === 'ACTIVE')
  const [draft, setDraft] = useState<FlowEdit>({ name: flow.name, description: flow.description, settings: structuredClone(flow.settings) })
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<ImpactSummary & { days: number }>()
  const set = (s: Partial<FlowSettings>) => setDraft({ ...draft, settings: { ...draft.settings, ...s } })
  const s = draft.settings
  const dirty = JSON.stringify(draft) !== JSON.stringify({ name: flow.name, description: flow.description, settings: flow.settings })
  const nextRevision = flow.status === 'ACTIVE' ? `${flow.workflowVersion}-R${flow.revision + 1}` : undefined

  const save = async () => {
    setBusy(true)
    setErrors({})
    try {
      await flowService.save(flow.flowId, draft, reason, actor)
      toast.success(nextRevision ? `Saved as ${nextRevision}` : 'Draft saved', { description: nextRevision ? 'Applies to new sessions only.' : undefined })
      setReason('')
      onSaved()
    } catch (e) {
      if (isServiceError(e) && Array.isArray(e.details)) setErrors(Object.fromEntries((e.details as { field: string; message: string }[]).map((x) => [x.field, x.message])))
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const runPreview = async () => {
    try {
      setPreview(await flowService.preview(flow.flowId, s, actor))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div className="space-y-4 pb-28">
      {!canEdit && <p className="rounded-md bg-muted px-3 py-2 text-sm">Read-only: you can view this flow but not change it.</p>}
      {canEdit && !editable && <p className="rounded-md bg-muted px-3 py-2 text-sm">{flow.status === 'RETIRING' ? 'Retiring' : 'Inactive'} flows are read-only: they keep their last settings.</p>}

      <Card title="General">
        <fieldset disabled={!editable} className="grid gap-4 sm:grid-cols-2">
          <legend className="sr-only">General</legend>
          <FormField id="fl-name" label="Flow name" error={errors.name}>
            <Input id="fl-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-invalid={!!errors.name} />
          </FormField>
          <FormField id="fl-version" label="Workflow version" hint={flow.revision > 0 ? 'Locked once the flow has been active. To change it, create a new flow.' : 'To use another version, create a new flow.'}>
            <Input id="fl-version" value={`${entry.code} — ${entry.name}`} readOnly />
          </FormField>
          <FormField id="fl-desc" label="Who this flow is for" className="sm:col-span-2">
            <Textarea id="fl-desc" rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </FormField>
        </fieldset>
      </Card>

      {editable && !canChangeLevel && (
        <p className="rounded-md bg-muted px-3 py-2 text-sm">Thresholds, retries and the risk level are read-only for you: they need the “Change verification level and retries” permission.</p>
      )}
      <section aria-label="Thresholds and retries" className="grid gap-4 lg:grid-cols-2">
        {entry.configurableChecks.map((c) => (
          <ThresholdCard key={c} check={c} value={s.checks[c]} onChange={(v) => set({ checks: { ...s.checks, [c]: v } })} canSetAdvanced={canSetAdvanced} disabled={!editable || !canChangeLevel} errors={errors} />
        ))}
      </section>

      <Card title="Session">
        <fieldset disabled={!editable} className="grid gap-4 sm:grid-cols-3">
          <legend className="sr-only">Session</legend>
          <FormField id="fl-cooldown" label={<span className="flex items-center gap-2">Cooldown after a rejection (min) <OpenQuestionTag id="OQ-22" /></span>} hint="How long the same end user waits before a new case. 0 = no wait." error={errors.cooldownMin}>
            <Input id="fl-cooldown" type="number" min={0} step={1} value={shown(s.cooldownMin)} onChange={(e) => set({ cooldownMin: numberOrNaN(e.target.value) })} aria-invalid={!!errors.cooldownMin} />
          </FormField>
          <FormField id="fl-expiry" label={<span className="flex items-center gap-2">Session expiry (min) <OpenQuestionTag id="OQ-19" /></span>} error={errors.sessionExpiryMin}>
            <Input id="fl-expiry" type="number" min={1} step={1} value={shown(s.sessionExpiryMin)} onChange={(e) => set({ sessionExpiryMin: numberOrNaN(e.target.value) })} aria-invalid={!!errors.sessionExpiryMin} />
          </FormField>
          <fieldset aria-describedby={errors.acceptedDocuments ? 'fl-docs-error' : undefined}>
            <legend className="mb-1 text-xs font-medium text-muted-foreground">Accepted documents</legend>
            {DOCUMENTS.map((d) => (
              <label key={d} className="flex items-center gap-2 py-0.5 text-sm">
                <input
                  type="checkbox"
                  checked={s.acceptedDocuments.includes(d)}
                  onChange={(e) => set({ acceptedDocuments: e.target.checked ? [...s.acceptedDocuments, d] : s.acceptedDocuments.filter((x) => x !== d) })}
                />
                {DOCUMENT_TYPE_LABELS[d]}
              </label>
            ))}
            {errors.acceptedDocuments && (
              <p id="fl-docs-error" role="alert" className="mt-1 text-xs text-destructive">
                {errors.acceptedDocuments}
              </p>
            )}
          </fieldset>
        </fieldset>
      </Card>

      {hasRisk(entry) && (
        <Card title="Risk Assessment" aside={<OpenQuestionTag id="OQ-05" />}>
          {entry.code === 'V5' ? (
            <p className="text-sm text-muted-foreground">V5 per-component risk thresholds are not defined yet.</p>
          ) : (
            <fieldset disabled={!editable || !canChangeLevel} className="max-w-sm">
              <legend className="sr-only">Risk</legend>
              <FormField id="fl-risk" label="Maximum allowed risk level" hint="Above it, a case that passed every check goes to Pending Review. Risk never auto-rejects.">
                <NativeSelect id="fl-risk" value={s.risk?.maxAllowedLevel ?? 'MEDIUM'} onChange={(e) => set({ risk: { enabled: true, maxAllowedLevel: e.target.value as RiskLevel } })}>
                  {RISK_LEVELS.map((r) => (
                    <option key={r} value={r}>
                      {RISK_LABELS[r]}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
            </fieldset>
          )}
        </Card>
      )}

      {entry.requiredInputs.includes('EMAIL') && (
        <Card title="Requirements">
          <p className="text-sm">Email required at session creation ({entry.code}).</p>
        </Card>
      )}

      <Card title="What-if" aside={<span className="flex items-center gap-1 text-xs text-muted-foreground"><FlaskConical className="size-3.5" aria-hidden /> read-only</span>}>
        <p className="mb-3 text-sm text-muted-foreground">Re-runs the status rules on this flow’s finished sessions with the settings above. Nothing changes.</p>
        <Button variant="outline" size="sm" onClick={() => void runPreview()}>
          Preview impact
        </Button>
        {preview && <div className="mt-3"><Preview result={preview} /></div>}
      </Card>

      <Card title="Developer info">
        <p className="text-sm">
          <CopyId label="Flow ID" value={flow.flowId} className="text-sm" />
        </p>
        <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs" aria-label="Sample create-session request">
          {`POST /v1/sessions   (sample, mock)
{
  "flowId": "${flow.flowId}",
  "referenceId": "your-own-reference-for-this-user",${entry.requiredInputs.includes('EMAIL') ? '\n  "email": "user@mail.example",' : ''}
  "redirectUrl": "https://app.example/kyc/done"
}`}
        </pre>
      </Card>

      <Card title="History">
        {detail.revisions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No revisions yet: the first activation records {flow.workflowVersion}-R1.</p>
        ) : (
          <ol className="space-y-3">
            {[...detail.revisions].reverse().map((r) => (
              <li key={r.revision} className="text-sm">
                <div className="font-medium">
                  <span className="font-mono">{flow.workflowVersion}-R{r.revision}</span> · {formatMyt(r.savedAt)} MYT · {r.savedBy.fullName}
                </div>
                <div className="text-muted-foreground">“{r.reason}”</div>
                {r.changes.length > 0 && (
                  <ul className="mt-1 list-disc pl-5 text-xs">
                    {r.changes.map((c) => (
                      <li key={c.field}>
                        {FIELD_LABELS[c.field] ?? c.field}: {c.from} → {c.to}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>

      {editable && (
        <div className="fixed right-0 bottom-0 left-0 z-20 border-t bg-background/95 px-6 py-3 backdrop-blur lg:left-60" role="region" aria-label="Save changes">
          <div className="mx-auto flex max-w-[1100px] flex-wrap items-end gap-3">
            {flow.status === 'ACTIVE' ? (
              <FormField id="fl-reason" label={`Reason for change (min ${MIN_REASON_LENGTH} characters)`} error={errors.reason} className="min-w-64 flex-1">
                <Input id="fl-reason" value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!errors.reason} placeholder="Why are these settings changing?" />
              </FormField>
            ) : (
              <p className="flex-1 text-sm text-muted-foreground">Draft: save freely. Full validation runs when you activate.</p>
            )}
            {nextRevision && dirty && <p className="text-xs text-muted-foreground">Creates {nextRevision} · applies to new sessions only</p>}
            <Button disabled={busy || !dirty} onClick={() => void save()}>
              {busy ? 'Saving…' : flow.status === 'ACTIVE' ? 'Save new revision' : 'Save draft'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// REQ: DEC-50 … DEC-53, DEC-94 — one flow's settings; only what applies to its workflow version.
export function FlowDetailPage() {
  const { flowId = '' } = useParams()
  const actor = useSession((s) => s.actor)
  const selectProject = useSession((s) => s.selectProject)
  const headerProject = useSession((s) => s.projectId)
  const detail = useLoad(() => flowService.get(flowId, actor), [flowId, actor.userId])
  const d = detail.data?.flow.flowId === flowId ? detail.data : undefined
  // REQ: DEC-102 — Activate / retire / set default and Duplicate each need their own permission.
  const { account, projects } = useAccess()
  const flowProject = d && projects.find((p) => p.projectId === d.flow.projectId)
  const may = (a: 'activateFlows' | 'createFlows') => !!account && !!flowProject && canInProject(account, a, flowProject)

  // REQ: DEC-96 — settings work on one project: follow the flow's project in the header.
  useEffect(() => {
    if (d && headerProject !== d.flow.projectId) selectProject(d.flow.projectId)
  }, [d, headerProject, selectProject])

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      toast.success(ok)
      detail.reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  if (detail.error && !d) {
    return /not found/i.test(detail.error) ? (
      <EmptyState title={`${flowId} not found`} action={<Link to="/flows" className="text-sm text-blue-700 hover:underline dark:text-blue-400">Back to Flows</Link>}>
        It doesn’t exist, or it belongs to a project you can’t access.
      </EmptyState>
    ) : (
      <ErrorState message={detail.error} onRetry={detail.reload} />
    )
  }
  if (!d) return <div className="mx-auto h-40 max-w-[1100px] animate-pulse rounded-lg bg-muted" aria-busy aria-label="Loading flow" />
  const f = d.flow

  return (
    <div className="mx-auto max-w-[1100px] space-y-4">
      <Link to="/flows" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Flows
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{f.name}</h1>
            <FlowStatusBadge status={f.status} />
            {d.isDefault && <span className="rounded bg-blue-100 px-1.5 text-[10px] font-medium text-blue-800 uppercase dark:bg-blue-500/20 dark:text-blue-200">Default</span>}
          </div>
          <p className="text-sm text-muted-foreground">
            {f.workflowVersion} · {revisionLabel(f) ? <span className="font-mono">{revisionLabel(f)}</span> : 'no revision yet'} · {d.inFlightCases} open case(s) · updated {formatMyt(f.updatedAt)} MYT by {f.updatedBy.fullName}
          </p>
          {d.entry.status === 'DEPRECATED' && (
            <p className="flex items-center gap-1 text-sm text-amber-700 dark:text-amber-300">
              <AlertTriangle className="size-4" aria-hidden /> Version {d.entry.code} is deprecated. This flow keeps running; new flows can’t use it.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {may('activateFlows') && f.status !== 'ACTIVE' && (
            <Button size="sm" onClick={() => void act(() => flowService.activate(f.flowId, actor), `${f.name} activated`)}>
              Activate
            </Button>
          )}
          {may('activateFlows') && f.status === 'ACTIVE' && !d.isDefault && (
            <Button size="sm" variant="outline" onClick={() => void act(() => flowService.setDefault(f.flowId, actor), `${f.name} is now the default`)}>
              Set as default
            </Button>
          )}
          {may('activateFlows') && f.status === 'ACTIVE' && (
            <Button
              size="sm"
              variant="outline"
              disabled={d.isDefault}
              title={d.isDefault ? 'Choose a new default flow before retiring this one.' : undefined}
              onClick={() => window.confirm(d.inFlightCases ? `Retire ${f.name}? It finishes its ${d.inFlightCases} open case(s), then becomes Inactive.` : `Retire ${f.name}? It becomes Inactive.`) && void act(() => flowService.retire(f.flowId, actor), `${f.name} retired`)}
            >
              Retire
            </Button>
          )}
          {may('createFlows') && (
            <Button size="sm" variant="outline" onClick={() => void act(() => flowService.duplicate(f.flowId, actor), `${f.name} duplicated as Draft`)}>
              Duplicate
            </Button>
          )}
        </div>
      </header>
      <Editor key={`${f.flowId}|${f.revision}|${f.status}|${f.updatedAt}`} detail={d} onSaved={detail.reload} />
    </div>
  )
}

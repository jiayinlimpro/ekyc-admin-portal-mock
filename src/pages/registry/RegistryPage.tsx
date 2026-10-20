import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Pencil, Plus, Star } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/FormField'
import { NativeSelect } from '@/components/common/NativeSelect'
import { ErrorState } from '@/components/common/States'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { isLocked, type RegistryInput } from '@/domain/registryRules'
import { CHECKS, ONBOARDING_PHASES, PHASE_LABELS, type FaceMatchMethod, type OnboardingPhase, type RegistryStatus } from '@/domain/types'
import { errorMessage, useLoad } from '@/hooks/useLoad'
import { formatMyt } from '@/lib/format'
import { cn } from '@/lib/utils'
import { isServiceError } from '@/services/errors'
import { registryService, type RegistryRow } from '@/services/registryService'
import { useSession } from '@/stores/sessionStore'
import { FLOW_STATUS_LABELS } from '../flows/FlowsListPage'

const PHASE_TEXT: Record<OnboardingPhase, string> = { ID_CAPTURE: 'ID Capture', SELFIE_CAPTURE: 'Selfie Capture', LIVENESS_CHECK: 'Liveness Check', RISK_ASSESSMENT: 'Risk Assessment' }
const METHOD_TEXT: Record<FaceMatchMethod, string> = { ID_VS_SELFIE: 'ID vs selfie', ID_VS_LIVENESS: 'ID vs liveness face' }
const STATUS_TEXT: Record<RegistryStatus, string> = { DRAFT: 'Draft', ACTIVE: 'Active', DEPRECATED: 'Deprecated' }
const STATUS_TONE: Record<RegistryStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-200',
  ACTIVE: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-200',
  DEPRECATED: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
}

const emptyInput = (): RegistryInput => ({ code: '', name: '', description: '', phases: ['ID_CAPTURE', 'LIVENESS_CHECK'], faceMatchMethod: 'ID_VS_LIVENESS', requiredInputs: [], configurableChecks: ['FACE_MATCH', 'LIVENESS'], stateMachineSandbox: '', stateMachineProduction: '', releaseNote: '' })
const inputOf = (e: RegistryRow): RegistryInput => ({ ...e, stateMachineSandbox: e.stateMachineSandbox ?? '', stateMachineProduction: e.stateMachineProduction ?? '', releaseNote: '' })

// REQ: DEC-56 — FRS field rules; after first activation only name, description and state machines change.
function VersionDialog({ editing, onClose, onDone }: { editing?: RegistryRow; onClose: () => void; onDone: () => void }) {
  const actor = useSession((s) => s.actor)
  const [v, setV] = useState<RegistryInput>(editing ? inputOf(editing) : emptyInput())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const locked = (f: keyof RegistryInput) => !!editing && (f === 'code' || isLocked(editing, f))
  const togglePhase = (p: OnboardingPhase) =>
    setV({ ...v, phases: ONBOARDING_PHASES.filter((x) => (x === p ? !v.phases.includes(p) : v.phases.includes(x))) }) // keeps the fixed order
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    try {
      if (editing) await registryService.update(editing.code, v, actor)
      else await registryService.register(v, actor)
      toast.success(editing ? `${editing.code} updated` : `${v.code} registered as Draft`)
      onDone()
    } catch (err) {
      if (isServiceError(err) && Array.isArray(err.details)) setErrors(Object.fromEntries((err.details as { field: string; message: string }[]).map((x) => [x.field, x.message])))
      else setErrors({ form: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.code}` : 'Register workflow version'}</DialogTitle>
            <DialogDescription>{editing?.activatedAt ? 'This version has been active: only name, description and state machines can change. Anything else needs a new code.' : 'A record only: nothing here deploys or calls AWS.'}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="r-code" label="Workflow code" hint="V<number>, never reused" error={errors.code}>
              <Input id="r-code" value={v.code} disabled={locked('code')} onChange={(e) => setV({ ...v, code: e.target.value })} aria-invalid={!!errors.code} />
            </FormField>
            <FormField id="r-name" label="Name" error={errors.name}>
              <Input id="r-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} aria-invalid={!!errors.name} />
            </FormField>
            <FormField id="r-desc" label="Description" error={errors.description} className="sm:col-span-2">
              <Textarea id="r-desc" rows={2} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
            </FormField>
            <fieldset disabled={locked('phases')}>
              <legend className="mb-1 text-xs font-medium text-muted-foreground">Onboarding phases (in order)</legend>
              {ONBOARDING_PHASES.map((p) => (
                <label key={p} className="flex items-center gap-2 py-0.5 text-sm">
                  <input type="checkbox" checked={v.phases.includes(p)} disabled={p === 'ID_CAPTURE'} onChange={() => togglePhase(p)} />
                  {PHASE_TEXT[p]}
                  {p === 'ID_CAPTURE' && <span className="text-xs text-muted-foreground">(always first)</span>}
                </label>
              ))}
              {errors.phases && <p role="alert" className="text-xs text-destructive">{errors.phases}</p>}
            </fieldset>
            <div className="space-y-3">
              <FormField id="r-method" label="Face match" error={errors.faceMatchMethod}>
                <NativeSelect id="r-method" value={v.faceMatchMethod} disabled={locked('faceMatchMethod')} onChange={(e) => setV({ ...v, faceMatchMethod: e.target.value as FaceMatchMethod })}>
                  {Object.entries(METHOD_TEXT).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={v.requiredInputs.includes('EMAIL')} disabled={locked('requiredInputs')} onChange={(e) => setV({ ...v, requiredInputs: e.target.checked ? ['EMAIL'] : [] })} />
                Email required at session creation
              </label>
              <fieldset disabled={locked('configurableChecks')}>
                <legend className="mb-1 text-xs font-medium text-muted-foreground">Configurable thresholds</legend>
                {CHECKS.map((c) => (
                  <label key={c} className="flex items-center gap-2 py-0.5 text-sm">
                    <input type="checkbox" checked={v.configurableChecks.includes(c)} onChange={(e) => setV({ ...v, configurableChecks: e.target.checked ? CHECKS.filter((x) => x === c || v.configurableChecks.includes(x)) : v.configurableChecks.filter((x) => x !== c) })} />
                    {PHASE_LABELS[c]}
                  </label>
                ))}
                {errors.configurableChecks && <p role="alert" className="text-xs text-destructive">{errors.configurableChecks}</p>}
              </fieldset>
            </div>
            <FormField id="r-sand" label="State machine ARN (sandbox)" error={errors.stateMachineSandbox} className="sm:col-span-2">
              <Input id="r-sand" value={v.stateMachineSandbox} onChange={(e) => setV({ ...v, stateMachineSandbox: e.target.value })} placeholder="arn:aws:states:…" aria-invalid={!!errors.stateMachineSandbox} />
            </FormField>
            <FormField id="r-prod" label="State machine ARN (production)" error={errors.stateMachineProduction} className="sm:col-span-2">
              <Input id="r-prod" value={v.stateMachineProduction} onChange={(e) => setV({ ...v, stateMachineProduction: e.target.value })} placeholder="arn:aws:states:…" aria-invalid={!!errors.stateMachineProduction} />
            </FormField>
            <FormField id="r-note" label="Release note" error={errors.releaseNote} className="sm:col-span-2">
              <Textarea id="r-note" rows={2} value={v.releaseNote} onChange={(e) => setV({ ...v, releaseNote: e.target.value })} aria-invalid={!!errors.releaseNote} />
            </FormField>
          </div>
          {errors.form && <p role="alert" className="text-sm text-destructive">{errors.form}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{editing ? 'Save' : 'Register'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// REQ: DEC-56 / DEC-57 — Draft → Active (complete), Draft → Deprecated, Active ↔ Deprecated; never back to Draft.
function StatusDialog({ row, onClose, onDone }: { row: RegistryRow; onClose: () => void; onDone: () => void }) {
  const actor = useSession((s) => s.actor)
  const to: RegistryStatus = row.status === 'ACTIVE' ? 'DEPRECATED' : 'ACTIVE'
  const [target, setTarget] = useState<RegistryStatus>(to)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string>()
  const save = async () => {
    try {
      await registryService.changeStatus(row.code, target, reason, actor)
      toast.success(`${row.code} is now ${STATUS_TEXT[target]}`)
      onDone()
    } catch (e) {
      setError(errorMessage(e))
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change status of {row.code}</DialogTitle>
          <DialogDescription>Deprecated versions can’t be chosen for new flows; existing flows keep running. A version never goes back to Draft.</DialogDescription>
        </DialogHeader>
        <FormField id="s-to" label="New status">
          <NativeSelect id="s-to" value={target} onChange={(e) => setTarget(e.target.value as RegistryStatus)}>
            {(row.status === 'DRAFT' ? (['ACTIVE', 'DEPRECATED'] as const) : ([to] as const)).map((s) => (
              <option key={s} value={s}>
                {STATUS_TEXT[s]}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField id="s-reason" label="Reason for change" error={error}>
          <Input id="s-reason" value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!error} />
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()}>Change status</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function FlowsUsing({ code }: { code: string }) {
  const actor = useSession((s) => s.actor)
  const flows = useLoad(() => registryService.flowsUsing(code, actor), [code, actor.userId])
  if (!flows.data) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (!flows.data.length) return <p className="text-sm text-muted-foreground">No flows use this version.</p>
  return (
    <ul className="space-y-1 text-sm" aria-label={`Flows using ${code}`}>
      {flows.data.map((f) => (
        <li key={f.flowId}>
          {f.merchantName} › {f.projectName} › <Link to={`/flows/${f.flowId}`} className="text-blue-700 hover:underline dark:text-blue-400">{f.name}</Link>{' '}
          <span className="text-xs text-muted-foreground">({FLOW_STATUS_LABELS[f.status]})</span>
        </li>
      ))}
    </ul>
  )
}

// REQ: DEC-56 … DEC-58, DEC-85 — Platform Admin only. A record of versions; nothing here builds or deploys.
export function RegistryPage() {
  const actor = useSession((s) => s.actor)
  const rows = useLoad(() => registryService.list(actor), [actor.userId])
  const [editing, setEditing] = useState<RegistryRow | 'new'>()
  const [status, setStatus] = useState<RegistryRow>()
  const [open, setOpen] = useState<string>()
  const done = () => {
    setEditing(undefined)
    setStatus(undefined)
    rows.reload()
  }
  const setDefault = async (r: RegistryRow) => {
    try {
      await registryService.setDefault(r.code, actor)
      toast.success(`${r.code} is now the default for new merchants`)
      rows.reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  if (rows.error && !rows.data) return <ErrorState message={rows.error} onRetry={rows.reload} />

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Workflow Registry</h1>
          <p className="text-sm text-muted-foreground">Versions merchants’ flows are built on. Only Active versions can be chosen for new flows.</p>
        </div>
        <Button onClick={() => setEditing('new')}>
          <Plus aria-hidden /> Register version
        </Button>
      </header>
      <section aria-label="Version list" className="overflow-x-auto rounded-lg border bg-card">
        <table className={cn('w-full text-sm', rows.loading && rows.data && 'opacity-60')} aria-busy={rows.loading}>
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              {['Version', 'Status', 'Phases', 'Face match', 'Flows using it', 'Updated'].map((h) => (
                <th key={h} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>
              ))}
              <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          {(rows.data ?? []).map((r) => (
            <tbody key={r.code} className="border-t">
              <tr>
                <th scope="row" className="px-3 py-2 text-left font-normal">
                  <button type="button" className="text-left" aria-expanded={open === r.code} onClick={() => setOpen(open === r.code ? undefined : r.code)}>
                    <span className="font-mono font-medium">{r.code}</span> · {r.name}
                    {r.isDefault && <span className="ml-2 rounded bg-blue-100 px-1.5 text-[10px] font-medium text-blue-800 uppercase dark:bg-blue-500/20 dark:text-blue-200">Default for new merchants</span>}
                  </button>
                  <div className="text-xs text-muted-foreground">{r.description}</div>
                </th>
                <td className="px-3 py-2"><span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', STATUS_TONE[r.status])}>{STATUS_TEXT[r.status]}</span></td>
                <td className="px-3 py-2 text-xs">{r.phases.map((p) => PHASE_TEXT[p]).join(' → ')}</td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">{METHOD_TEXT[r.faceMatchMethod]}{r.requiredInputs.includes('EMAIL') ? ' · email' : ''}</td>
                <td className="px-3 py-2 tabular-nums">{r.flowsUsing}</td>
                <td className="px-3 py-2 whitespace-nowrap">{formatMyt(r.updatedAt).split(', ')[0]}<div className="text-xs text-muted-foreground">{r.updatedBy}</div></td>
                <td className="px-2 py-2 text-right whitespace-nowrap">
                  <Button variant="ghost" size="icon-sm" aria-label={`Edit ${r.code}`} title="Edit" onClick={() => setEditing(r)}><Pencil aria-hidden /></Button>
                  <Button variant="ghost" size="sm" onClick={() => setStatus(r)} aria-label={`Change status of ${r.code}`}>Status</Button>
                  {r.status === 'ACTIVE' && !r.isDefault && (
                    <Button variant="ghost" size="icon-sm" aria-label={`Make ${r.code} the default`} title="Default for new merchants" onClick={() => void setDefault(r)}><Star aria-hidden /></Button>
                  )}
                </td>
              </tr>
              {open === r.code && (
                <tr className="bg-muted/30">
                  <td colSpan={7} className="px-4 py-3">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <h3 className="mb-1 text-xs font-medium text-muted-foreground uppercase">Flows using it</h3>
                        <FlowsUsing code={r.code} />
                      </div>
                      <div>
                        <h3 className="mb-1 text-xs font-medium text-muted-foreground uppercase">Release notes</h3>
                        <ol className="space-y-1 text-sm">
                          {[...r.releaseNotes].reverse().map((n, i) => (
                            <li key={i}><span className="text-xs text-muted-foreground">{formatMyt(n.at).split(', ')[0]} · {n.by}:</span> {n.text}</li>
                          ))}
                        </ol>
                        <p className="mt-2 font-mono text-[11px] break-all text-muted-foreground">{r.stateMachineProduction ?? 'No production state machine yet'}</p>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          ))}
        </table>
      </section>
      {editing && <VersionDialog editing={editing === 'new' ? undefined : editing} onClose={() => setEditing(undefined)} onDone={done} />}
      {status && <StatusDialog row={status} onClose={() => setStatus(undefined)} onDone={done} />}
    </div>
  )
}

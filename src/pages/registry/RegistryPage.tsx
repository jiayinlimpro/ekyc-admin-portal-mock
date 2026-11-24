import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { AlertTriangle, ArrowRightLeft, MoreVertical, Pencil, Plus, Star } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/FormField'
import { NativeSelect } from '@/components/common/NativeSelect'
import { ErrorState } from '@/components/common/States'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { CopyButton } from '@/components/common/CopyId'
import { normaliseDefinition, readDefinition, setDefaultError, type RegistryInput } from '@/domain/registryRules'
import { REGISTRY_STATUSES, type RegistryStatus } from '@/domain/types'
import { errorMessage, useLoad } from '@/hooks/useLoad'
import { formatMyt } from '@/lib/format'
import { cn } from '@/lib/utils'
import { isServiceError } from '@/services/errors'
import { merchantService } from '@/services/merchantService'
import { registryService, type RegistryRow } from '@/services/registryService'
import { useSession } from '@/stores/sessionStore'
import { FLOW_STATUS_LABELS, stepsText, tunableText } from '@/lib/labels'
import { useAccess } from '@/app/access'

// REQ: DEC-56 — who may choose a version for a new flow follows its status.
const STATUS_TEXT: Record<RegistryStatus, string> = { DRAFT: 'Draft', INTERNAL_TESTING: 'Internal testing', LIMITED_RELEASE: 'Limited release', ACTIVE: 'Active', DEPRECATED: 'Deprecated' }
const STATUS_HINT: Record<RegistryStatus, string> = {
  DRAFT: 'Nobody can choose it for a new flow.',
  INTERNAL_TESTING: 'Only super admins and platform users can build flows on it. Sessions are not charged.',
  LIMITED_RELEASE: 'Internal users and the merchants ticked under Merchant access (Edit) can choose it.',
  ACTIVE: 'Everyone who may create flows can choose it.',
  DEPRECATED: 'Nobody can choose it for a new flow; existing flows keep running.',
}
const STATUS_TONE: Record<RegistryStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-200',
  INTERNAL_TESTING: 'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200',
  LIMITED_RELEASE: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200',
  ACTIVE: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-200',
  DEPRECATED: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
}

// REQ: DEC-57 — why a version can't become the default (already it, or not Active); undefined when it can.
const defaultBlocked = (r: RegistryRow) => setDefaultError(r)

const EXAMPLE = '{\n  "workflowCode": "W7",\n  "steps": ["DOCUMENT", "LIVENESS"],\n  "tunable": ["FACE_MATCH", "LIVENESS"]\n}'
const emptyInput = (): RegistryInput => ({ code: '', name: '', definition: '', accessMerchantIds: [] })
const inputOf = (e: RegistryRow): RegistryInput => ({ code: e.code, name: e.name, definition: e.definition, accessMerchantIds: e.accessMerchantIds })

// REQ: DEC-115 — Register / Edit: the code, a name and the workflow JSON from the backend. The workflow decides what runs;
// the portal shows what it read (steps, tunable). Editable at any status; for a version flows use, a changed definition
// needs a reason, and those flows follow it for new sessions.
function VersionDialog({ editing, onClose, onDone }: { editing?: RegistryRow; onClose: () => void; onDone: () => void }) {
  const actor = useSession((s) => s.actor)
  // REQ: DEC-56 — Limited release: the merchants that may choose this version.
  const limited = editing?.status === 'LIMITED_RELEASE'
  const merchants = useLoad(() => (limited ? merchantService.list(actor) : Promise.resolve([])), [actor.userId, limited])
  const [v, setV] = useState<RegistryInput>(editing ? inputOf(editing) : emptyInput())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  // REQ: DEC-115 — a changed definition of a version that flows use: say how many, and ask why.
  const definitionChanged = !!editing && normaliseDefinition(v.definition) !== editing.definition
  const affects = definitionChanged && editing.flowsUsing > 0 ? editing.flowsUsing : 0
  const read = v.definition.trim() ? readDefinition(v.definition, v.code).definition : undefined
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    try {
      if (editing) await registryService.update(editing.code, v, actor)
      else await registryService.register(v, actor)
      toast.success(editing ? `${editing.code} updated` : `${v.code.trim()} registered as Draft`)
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.code}` : 'Register workflow version'}</DialogTitle>
            <DialogDescription>
              The workflow decides what runs. Paste its definition (JSON): the portal reads the steps and what flows can tune.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <FormField id="r-code" label="Workflow code" hint="W<number>, never reused" error={errors.code}>
              <Input id="r-code" value={v.code} disabled={!!editing} onChange={(e) => setV({ ...v, code: e.target.value })} aria-invalid={!!errors.code} />
            </FormField>
            <FormField id="r-name" label="Name" error={errors.name}>
              <Input id="r-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} aria-invalid={!!errors.name} />
            </FormField>
          </div>
          <FormField
            id="r-json"
            label="Definition (JSON)"
            hint="From the backend. Read: workflowCode, steps, tunable; other keys are kept."
            error={errors.definition}
          >
            <Textarea
              id="r-json"
              rows={8}
              spellCheck={false}
              className="font-mono text-xs"
              placeholder={EXAMPLE}
              value={v.definition}
              onChange={(e) => setV({ ...v, definition: e.target.value })}
              aria-invalid={!!errors.definition}
            />
          </FormField>
          {read && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border bg-muted/40 px-3 py-2 text-sm" aria-label="What the portal reads">
              <dt className="text-muted-foreground">Steps</dt>
              <dd>{stepsText(read.phases)}</dd>
              <dt className="text-muted-foreground">Tunable</dt>
              <dd>{tunableText(read)}</dd>
            </dl>
          )}
          {affects > 0 && (
            <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-500/10">
              <p className="flex gap-2 text-sm" role="status">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
                <span>
                  {affects} flow(s) use {editing!.code}. Their new sessions follow the new definition, and Flow Detail shows the settings it allows.
                </span>
              </p>
              <FormField id="r-reason" label="Reason for change" error={errors.reason}>
                <Input id="r-reason" value={v.reason ?? ''} onChange={(e) => setV({ ...v, reason: e.target.value })} aria-invalid={!!errors.reason} />
              </FormField>
            </div>
          )}
          {limited && (
            <fieldset className="rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">Merchant access</legend>
              <p className="mb-2 text-xs text-muted-foreground">Merchants that may choose this version for new flows while it is in Limited release. Internal users always can.</p>
              <div className="grid gap-1 sm:grid-cols-2">
                {(merchants.data ?? []).map((m) => (
                  <label key={m.merchantId} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={v.accessMerchantIds.includes(m.merchantId)}
                      onChange={(e) => setV({ ...v, accessMerchantIds: e.target.checked ? [...v.accessMerchantIds, m.merchantId] : v.accessMerchantIds.filter((id) => id !== m.merchantId) })}
                    />
                    {m.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
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

// REQ: DEC-56 / DEC-57 — no lifecycle: any other status, with a reason (the default must stay Active).
function StatusDialog({ row, onClose, onDone }: { row: RegistryRow; onClose: () => void; onDone: () => void }) {
  const actor = useSession((s) => s.actor)
  const choices = REGISTRY_STATUSES.filter((s) => s !== row.status)
  const [target, setTarget] = useState<RegistryStatus>(row.status === 'ACTIVE' ? 'DEPRECATED' : 'ACTIVE')
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
          <DialogDescription>The status decides who can choose this version for new flows; existing flows keep running.</DialogDescription>
        </DialogHeader>
        <FormField id="s-to" label="New status" hint={STATUS_HINT[target]}>
          <NativeSelect id="s-to" value={target} onChange={(e) => setTarget(e.target.value as RegistryStatus)}>
            {choices.map((s) => (
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
          {f.merchantName} › {f.projectName} › <Link to={`/flows/${f.flowId}?project=${f.projectId}`} className="text-blue-700 hover:underline dark:text-blue-400">{f.name}</Link>{' '}
          <span className="text-xs text-muted-foreground">({FLOW_STATUS_LABELS[f.status]})</span>
        </li>
      ))}
    </ul>
  )
}

// REQ: DEC-56 … DEC-58, DEC-85, DEC-115 — Super admin only. A record of versions (code, name, workflow JSON); nothing here builds or deploys.
export function RegistryPage() {
  const actor = useSession((s) => s.actor)
  // REQ: DEC-99 — Registry View is read-only; registering and changing versions needs Manage.
  const canManage = useAccess().allows({ platform: 'manageRegistry' })
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
          <p className="text-sm text-muted-foreground">Versions flows are built on. Active: everyone; Limited release: listed merchants; Internal testing: internal users only.</p>
        </div>
        <Button className={canManage ? undefined : 'hidden'} onClick={() => setEditing('new')}>
          <Plus aria-hidden /> Register version
        </Button>
      </header>
      <section aria-label="Version list" className="overflow-x-auto rounded-lg border bg-card">
        <table className={cn('w-full text-sm', rows.loading && rows.data && 'opacity-60')} aria-busy={rows.loading}>
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              {['Version', 'Status', 'Steps', 'Tunable', 'Flows using it', 'Updated'].map((h) => (
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
                </th>
                <td className="px-3 py-2">
                  <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap', STATUS_TONE[r.status])} title={STATUS_HINT[r.status]}>{STATUS_TEXT[r.status]}</span>
                  {r.status === 'LIMITED_RELEASE' && <div className="mt-1 text-xs text-muted-foreground">{r.accessMerchantIds.length ? `${r.accessMerchantIds.length} merchant(s)` : 'No merchants yet'}</div>}
                </td>
                <td className="px-3 py-2 text-xs">{stepsText(r.phases)}</td>
                <td className="px-3 py-2 text-xs">{tunableText(r)}</td>
                <td className="px-3 py-2 tabular-nums">{r.flowsUsing}</td>
                <td className="px-3 py-2 whitespace-nowrap">{formatMyt(r.updatedAt).split(', ')[0]}<div className="text-xs text-muted-foreground">{r.updatedBy}</div></td>
                {/* REQ: DEC-78 — one actions menu per row, as on Flows and Roles; what the state blocks is disabled with the reason. */}
                <td className={cn('px-2 py-2 text-right', !canManage && 'hidden')}>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${r.code}`}>
                          <MoreVertical aria-hidden />
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end" className="w-72">
                      <DropdownMenuItem onClick={() => setEditing(r)}>
                        <Pencil aria-hidden /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setStatus(r)}>
                        <ArrowRightLeft aria-hidden /> Change status…
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem disabled={!!defaultBlocked(r)} onClick={() => void setDefault(r)} className="items-start">
                        <Star aria-hidden className="mt-0.5" />
                        <span>
                          Make default for new merchants
                          {defaultBlocked(r) && <span className="block text-xs text-muted-foreground">{defaultBlocked(r)}</span>}
                        </span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
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
                        {/* REQ: DEC-115 — the workflow JSON as registered, read-only. */}
                        <h3 className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground uppercase">
                          Definition (JSON) <CopyButton label="Definition (JSON)" value={r.definition} />
                        </h3>
                        <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs" aria-label={`Definition (JSON) of ${r.code}`}>{r.definition}</pre>
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

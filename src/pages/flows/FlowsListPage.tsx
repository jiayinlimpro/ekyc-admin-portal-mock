import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { AlertTriangle, Copy, MoreVertical, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/FormField'
import { NativeSelect } from '@/components/common/NativeSelect'
import { RequireProject } from '@/components/common/RequireProject'
import { ErrorState } from '@/components/common/States'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { revisionLabel } from '@/domain/flowRules'
import type { FlowStatus } from '@/domain/types'
import { errorMessage, useLoad } from '@/hooks/useLoad'
import { formatMyt } from '@/lib/format'
import { FLOW_STATUS_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { flowService, type FlowRow } from '@/services/flowService'
import type { MyProject } from '@/services/projectService'
import { registryService } from '@/services/registryService'
import { useSession } from '@/stores/sessionStore'
import { CopyId } from '@/components/common/CopyId'
import { useAccess } from '@/app/access'
import { canInProject } from '@/domain/access'

const STATUS_TONE: Record<FlowStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-200',
  ACTIVE: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-200',
  RETIRING: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
  INACTIVE: 'bg-muted text-muted-foreground',
}
export const FlowStatusBadge = ({ status }: { status: FlowStatus }) => <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', STATUS_TONE[status])}>{FLOW_STATUS_LABELS[status]}</span>

// REQ: DEC-56 / DEC-94 — create on a version this user may choose for this merchant; then fill it in on Flow Detail.
function NewFlowDialog({ project, onClose }: { project: MyProject; onClose: () => void }) {
  const actor = useSession((s) => s.actor)
  const navigate = useNavigate()
  const versions = useLoad(() => registryService.listSelectable(actor, project.merchantId), [actor.userId, project.merchantId])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [version, setVersion] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const options = versions.data ?? []
  const chosen = version || options.find((v) => v.isDefault)?.code || options[0]?.code || ''
  const entry = options.find((v) => v.code === chosen)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const f = await flowService.create(project.projectId, { name, description, workflowVersion: chosen }, actor)
      toast.success(`${f.name} created as Draft`, { description: 'Complete its settings, then activate it.' })
      navigate(`/flows/${f.flowId}`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>New flow</DialogTitle>
            <DialogDescription>In {project.name}. It starts as Draft on Standard thresholds. The version can’t change once the flow has been active.</DialogDescription>
          </DialogHeader>
          <FormField id="nf-name" label="Flow name">
            <Input id="nf-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </FormField>
          <FormField id="nf-desc" label="Who this flow is for">
            <Textarea id="nf-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
          <FormField id="nf-version" label="Workflow version" hint={entry ? `${entry.name}: ${entry.description}` : 'Only Active versions can be chosen.'}>
            <NativeSelect id="nf-version" value={chosen} onChange={(e) => setVersion(e.target.value)}>
              {options.map((v) => (
                <option key={v.code} value={v.code}>
                  {v.code} — {v.name}
                  {v.isDefault ? ' (default)' : ''}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !chosen}>
              Create flow
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Flows({ project }: { project: MyProject }) {
  const actor = useSession((s) => s.actor)
  const { account } = useAccess()
  // REQ: DEC-99 — Flows View opens the list read-only; creating and changing flows needs Manage flows (staff: Edit).
  // REQ: DEC-102 — Create (and Duplicate) and Activate / retire (and Set as default) are separate permissions.
  const canCreate = !!account && canInProject(account, 'createFlows', project)
  const canActivate = !!account && canInProject(account, 'activateFlows', project)
  const navigate = useNavigate()
  const rows = useLoad(() => flowService.listRows(project.projectId, actor), [project.projectId, actor.userId])
  const [creating, setCreating] = useState(false)
  const [retiring, setRetiring] = useState<FlowRow>()

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      toast.success(ok)
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
          <h1 className="text-2xl font-semibold">Flows</h1>
          <p className="text-sm text-muted-foreground">{project.name} · settings live on each flow; saving an active flow creates a new revision for new sessions.</p>
        </div>
        {project.status === 'ACTIVE' && canCreate && (
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden /> New flow
          </Button>
        )}
      </header>
      <section aria-label="Flow list" className="overflow-x-auto rounded-lg border bg-card">
        <table className={cn('w-full text-sm', rows.loading && rows.data && 'opacity-60')} aria-busy={rows.loading}>
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              {/* REQ: DEC-95 — no routing: every session names its flow by Flow ID [PO 2026-11-20]. */}
              {['Flow', 'Version', 'Rules applied', 'Status', 'Open cases', 'Updated'].map((h) => (
                <th key={h} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
              <th scope="col" className="px-3 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {(rows.data ?? []).map((f) => (
              <tr key={f.flowId} className="border-t">
                <th scope="row" className="px-3 py-2 text-left font-normal">
                  <Link to={`/flows/${f.flowId}`} className="font-medium text-blue-700 hover:underline dark:text-blue-400">
                    {f.name}
                  </Link>
                  {f.isDefault && <span className="ml-2 rounded bg-blue-100 px-1.5 text-[10px] font-medium text-blue-800 uppercase dark:bg-blue-500/20 dark:text-blue-200">Default</span>}
                  <div className="text-xs text-muted-foreground">{f.description}</div>
                  {/* REQ: DEC-97 — merchants send it as flow_id; copy from here ([MS] Flows List). */}
                  <CopyId label="Flow ID" value={f.flowId} className="mt-0.5" />
                </th>
                <td className="px-3 py-2 whitespace-nowrap">
                  {f.workflowVersion}
                  {f.versionStatus === 'DEPRECATED' && (
                    <span className="ml-1 inline-flex items-center gap-0.5 text-xs text-amber-700 dark:text-amber-300" title="This version is deprecated; existing flows keep running.">
                      <AlertTriangle className="size-3" aria-hidden /> deprecated
                    </span>
                  )}
                  {/* REQ: DEC-56 — only internal users get these rows; say that the merchant's users don't see it. */}
                  {f.versionStatus === 'INTERNAL_TESTING' && (
                    <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase" title="Internal testing version: hidden from the merchant’s users.">
                      Internal only
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{revisionLabel(f) ?? '—'}</td>
                <td className="px-3 py-2">
                  <FlowStatusBadge status={f.status} />
                </td>
                <td className="px-3 py-2 tabular-nums">{f.inFlightCases}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {formatMyt(f.updatedAt).split(', ')[0]}
                  <div className="text-xs text-muted-foreground">{f.updatedBy.fullName}</div>
                </td>
                <td className="px-2 py-2 text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${f.name}`}>
                          <MoreVertical aria-hidden />
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem onClick={() => navigate(`/flows/${f.flowId}`)}>Open</DropdownMenuItem>
                      {canCreate && <DropdownMenuItem onClick={() => void act(() => flowService.duplicate(f.flowId, actor), `${f.name} duplicated as Draft`)}>
                        <Copy aria-hidden /> Duplicate
                      </DropdownMenuItem>}
                      {canActivate && f.status === 'ACTIVE' && !f.isDefault && <DropdownMenuItem onClick={() => void act(() => flowService.setDefault(f.flowId, actor), `${f.name} is now the default`)}>Set as default</DropdownMenuItem>}
                      {canActivate && f.status !== 'ACTIVE' && <DropdownMenuItem onClick={() => void act(() => flowService.activate(f.flowId, actor), `${f.name} activated`)}>Activate</DropdownMenuItem>}
                      {canActivate && f.status === 'ACTIVE' && <DropdownMenuItem onClick={() => setRetiring(f)}>Retire</DropdownMenuItem>}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {creating && <NewFlowDialog project={project} onClose={() => setCreating(false)} />}
      {retiring && (
        <Dialog open onOpenChange={(o) => !o && setRetiring(undefined)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Retire {retiring.name}?</DialogTitle>
              <DialogDescription>
                {retiring.isDefault
                  ? 'This is the default flow. Set another flow as default first.'
                  : retiring.inFlightCases > 0
                    ? `It takes no new sessions and becomes Retiring until its ${retiring.inFlightCases} open case(s) are decided, then Inactive.`
                    : 'It has no open cases, so it becomes Inactive at once. Flows are never deleted; past cases keep their flow.'}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRetiring(undefined)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={retiring.isDefault}
                onClick={() => {
                  const f = retiring
                  setRetiring(undefined)
                  void act(() => flowService.retire(f.flowId, actor), `${f.name} retired`)
                }}
              >
                Retire flow
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

// REQ: DEC-94 / DEC-96 — the flows of the header's project.
export function FlowsListPage() {
  return <RequireProject action="viewFlows" title="Flows">{(p) => <Flows key={p.projectId} project={p} />}</RequireProject>
}

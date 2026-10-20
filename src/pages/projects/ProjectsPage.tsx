import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { Archive, GitBranch, Pencil, Plus, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAccess } from '@/app/access'
import { FormField } from '@/components/common/FormField'
import { NativeSelect } from '@/components/common/NativeSelect'
import { ErrorState } from '@/components/common/States'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { errorMessage, useLoad } from '@/hooks/useLoad'
import { formatMyt } from '@/lib/format'
import { PROJECT_ROLE_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { isServiceError } from '@/services/errors'
import { projectService, type ProjectRow } from '@/services/projectService'
import { useSession } from '@/stores/sessionStore'

type Editing = { mode: 'create' } | { mode: 'rename'; row: ProjectRow } | { mode: 'archive'; row: ProjectRow }

function fieldError(e: unknown, field: string): string | undefined {
  if (!isServiceError(e) || !Array.isArray(e.details)) return undefined
  return (e.details as { field: string; message: string }[]).find((d) => d.field === field)?.message
}

// REQ: DEC-93 — create (name required, unique per merchant), rename, archive. MOCK-12: a new project starts with a Draft default flow.
function ProjectDialog({ editing, onClose, onSaved }: { editing: Editing; onClose: () => void; onSaved: (projectId?: string) => void }) {
  const actor = useSession((s) => s.actor)
  const merchants = useLoad(() => projectService.creatableMerchants(actor), [actor.userId])
  const [name, setName] = useState(editing.mode === 'rename' ? editing.row.name : '')
  const [merchantId, setMerchantId] = useState('')
  const [error, setError] = useState<{ field?: string; message: string }>()
  const [busy, setBusy] = useState(false)
  const options = merchants.data ?? []
  const chosenMerchant = merchantId || options[0]?.merchantId || ''

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      if (editing.mode === 'create') {
        const p = await projectService.create(chosenMerchant, { name }, actor)
        toast.success(`${p.name} created`, { description: 'Its Draft “Default flow” needs settings before it can be activated.' })
        onSaved(p.projectId)
      } else if (editing.mode === 'rename') {
        await projectService.rename(editing.row.projectId, name, actor)
        toast.success('Project renamed')
        onSaved()
      } else {
        await projectService.archive(editing.row.projectId, actor)
        toast.success(`${editing.row.name} archived`, { description: 'No new sessions. Existing cases stay reviewable.' })
        onSaved()
      }
    } catch (err) {
      setError({ field: fieldError(err, 'name') ? 'name' : undefined, message: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  const title = editing.mode === 'create' ? 'New project' : editing.mode === 'rename' ? `Rename ${editing.row.name}` : `Archive ${editing.row.name}?`
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {editing.mode === 'create' && 'A project has its own members, cases and settings. It starts with a Draft “Default flow” on the registry’s default version.'}
              {editing.mode === 'rename' && 'Names are unique within the merchant.'}
              {editing.mode === 'archive' && 'Archived projects take no new sessions. Existing cases stay reviewable. Projects are never deleted.'}
            </DialogDescription>
          </DialogHeader>
          {editing.mode === 'create' && options.length > 1 && (
            <FormField id="p-merchant" label="Merchant">
              <NativeSelect id="p-merchant" value={chosenMerchant} onChange={(e) => setMerchantId(e.target.value)}>
                {options.map((m) => (
                  <option key={m.merchantId} value={m.merchantId}>
                    {m.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          )}
          {editing.mode !== 'archive' && (
            <FormField id="p-name" label="Project name" error={error?.field === 'name' ? error.message : undefined}>
              <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={error?.field === 'name'} autoFocus />
            </FormField>
          )}
          {error && error.field !== 'name' && (
            <p role="alert" className="text-sm text-destructive">
              {error.message}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant={editing.mode === 'archive' ? 'destructive' : 'default'} disabled={busy || (editing.mode === 'create' && !chosenMerchant)}>
              {busy ? 'Saving…' : editing.mode === 'create' ? 'Create project' : editing.mode === 'rename' ? 'Save' : 'Archive project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const Tag = ({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'blue' }) => (
  <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase', tone === 'blue' ? 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-200' : 'bg-muted text-muted-foreground')}>
    {children}
  </span>
)

// REQ: DEC-90 / DEC-93 — the projects the user can reach, with their role; Platform Admin sees every merchant's.
export function ProjectsPage() {
  const actor = useSession((s) => s.actor)
  const selectProject = useSession((s) => s.selectProject)
  const access = useAccess()
  const navigate = useNavigate()
  const rows = useLoad(() => projectService.listRows(actor), [actor.userId])
  const creatable = useLoad(() => projectService.creatableMerchants(actor), [actor.userId])
  const [editing, setEditing] = useState<Editing>()

  if (rows.error && !rows.data) return <ErrorState message={rows.error} onRetry={rows.reload} />
  const data = rows.data ?? []
  const several = new Set(data.map((r) => r.merchantId)).size > 1
  const open = (r: ProjectRow, to: string) => {
    selectProject(r.projectId, r.merchantId) // settings pages work on the header's project (DEC-96)
    navigate(to)
  }
  const saved = (projectId?: string) => {
    setEditing(undefined)
    rows.reload()
    access.retry() // the switcher lists projects too
    if (projectId) toast.info('Open its flows to complete and activate the Default flow.')
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="text-sm text-muted-foreground">Each project has its own members, cases and settings. Settings pages work on the project chosen in the header.</p>
        </div>
        {!!creatable.data?.length && (
          <Button onClick={() => setEditing({ mode: 'create' })}>
            <Plus aria-hidden /> New project
          </Button>
        )}
      </header>

      <section aria-label="Project list" className="overflow-x-auto rounded-lg border bg-card">
        <table className={cn('w-full text-sm', rows.loading && rows.data && 'opacity-60')} aria-busy={rows.loading}>
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              {['Project', ...(several ? ['Merchant'] : []), 'Your role', 'Flows', 'Default flow', 'Members', 'Open cases', 'Claim timeout', 'Created'].map((h) => (
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
            {data.map((r) => (
              <tr key={r.projectId} className={cn('border-t', r.status === 'ARCHIVED' && 'text-muted-foreground')}>
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span>{r.name}</span>
                    {r.isDefault && <Tag tone="blue">Default</Tag>}
                    {r.status === 'ARCHIVED' && <Tag>Archived</Tag>}
                  </span>
                  <span className="font-mono text-[11px] font-normal text-muted-foreground">{r.projectId}</span>
                </th>
                {several && <td className="px-3 py-2 whitespace-nowrap">{r.merchantName}</td>}
                <td className="px-3 py-2 whitespace-nowrap">{PROJECT_ROLE_LABELS[r.role]}</td>
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                  {r.activeFlows} active / {r.flows}
                </td>
                <td className="px-3 py-2">{r.defaultFlowName}</td>
                <td className="px-3 py-2 tabular-nums">{r.members}</td>
                <td className="px-3 py-2 tabular-nums">{r.inFlightCases}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.claimTimeoutMin} min</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {formatMyt(r.createdAt).split(', ')[0]}
                  <div className="text-xs text-muted-foreground">{r.createdBy}</div>
                </td>
                <td className="px-2 py-2 text-right whitespace-nowrap">
                  <Button variant="ghost" size="icon-sm" aria-label={`Flows of ${r.name}`} title="Flows" onClick={() => open(r, '/flows')}>
                    <GitBranch aria-hidden />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Settings of ${r.name}`} title="Project Settings" onClick={() => open(r, '/project-settings')}>
                    <Settings2 aria-hidden />
                  </Button>
                  {r.canManage && (
                    <>
                      <Button variant="ghost" size="icon-sm" aria-label={`Rename ${r.name}`} title="Rename" onClick={() => setEditing({ mode: 'rename', row: r })}>
                        <Pencil aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Archive ${r.name}`}
                        title={r.status === 'ARCHIVED' ? 'Already archived' : 'Archive'}
                        disabled={r.status === 'ARCHIVED'}
                        onClick={() => setEditing({ mode: 'archive', row: r })}
                      >
                        <Archive aria-hidden />
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {editing && <ProjectDialog editing={editing} onClose={() => setEditing(undefined)} onSaved={saved} />}
    </div>
  )
}

import { useEffect, useState, type FormEvent } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { NativeSelect } from '@/components/common/NativeSelect'
import { ErrorState } from '@/components/common/States'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { WORKFLOW_VERSIONS, type WorkflowVersion } from '@/domain/types'
import { cn } from '@/lib/utils'
import { isServiceError } from '@/services/errors'
import { uamService, type MerchantAdminRow } from '@/services/uamService'
import { useSession } from '@/stores/sessionStore'

const message = (e: unknown) => (isServiceError(e) ? e.message : 'Unexpected error.')

type Editing = { mode: 'create' } | { mode: 'rename'; row: MerchantAdminRow }

function MerchantDialog({ editing, onClose, onSaved }: { editing: Editing; onClose: () => void; onSaved: () => void }) {
  const actor = useSession((s) => s.actor)
  const [name, setName] = useState(editing.mode === 'rename' ? editing.row.name : '')
  const [version, setVersion] = useState<WorkflowVersion>('V4')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      if (editing.mode === 'create') {
        const m = await uamService.createMerchant({ name, workflowVersion: version }, actor)
        toast.success(`${m.name} created (${m.merchantId}) with config v1.0.0 and an API key`)
      } else {
        await uamService.renameMerchant(editing.row.merchantId, name, actor)
        toast.success('Merchant renamed')
      }
      onSaved()
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>{editing.mode === 'create' ? 'New merchant' : `Rename ${editing.row.merchantId}`}</DialogTitle>
            <DialogDescription>{editing.mode === 'create' ? 'Starts with the default per-phase config (v1.0.0) and a mock API key.' : 'The workflow version can’t be changed here.'}</DialogDescription>
          </DialogHeader>
          <div>
            <label htmlFor="m-name" className="mb-1 block text-xs font-medium text-muted-foreground">Merchant name</label>
            <Input id="m-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!error} aria-describedby={error ? 'm-err' : undefined} autoFocus />
          </div>
          {editing.mode === 'create' && (
            <div>
              <label htmlFor="m-version" className="mb-1 block text-xs font-medium text-muted-foreground">Workflow version</label>
              <NativeSelect id="m-version" value={version} onChange={(e) => setVersion(e.target.value as WorkflowVersion)}>
                {WORKFLOW_VERSIONS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                    {v === 'V4' ? ' — adds Risk Assessment' : ''}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          {error && <p id="m-err" role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : editing.mode === 'create' ? 'Create merchant' : 'Save'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function MerchantsPage() {
  const actor = useSession((s) => s.actor)
  const [rows, setRows] = useState<{ key: number; data?: MerchantAdminRow[]; error?: string }>({ key: -1 })
  const [refresh, setRefresh] = useState(0)
  const [editing, setEditing] = useState<Editing>()

  useEffect(() => {
    let live = true
    uamService.listMerchants(actor).then(
      (data) => live && setRows({ key: refresh, data }),
      (e: unknown) => live && setRows({ key: refresh, error: message(e) }),
    )
    return () => {
      live = false
    }
  }, [actor, refresh])

  const remove = async (r: MerchantAdminRow) => {
    if (!window.confirm(`Delete ${r.name} (${r.merchantId})? This cannot be undone.`)) return
    try {
      await uamService.deleteMerchant(r.merchantId, actor)
      toast.success(`${r.name} deleted`)
      setRefresh((n) => n + 1)
    } catch (e) {
      toast.error(message(e))
    }
  }

  if (rows.error) return <ErrorState message={rows.error} onRetry={() => setRefresh((n) => n + 1)} />

  return (
    <div className="mx-auto max-w-[1200px] space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Merchants</h1>
          <p className="text-sm text-muted-foreground">Merchants using the eKYC service. Workflow thresholds are set in eKYC Workflow.</p>
        </div>
        <Button onClick={() => setEditing({ mode: 'create' })}>
          <Plus aria-hidden /> New merchant
        </Button>
      </header>
      <section aria-label="Merchant list" className="overflow-x-auto rounded-lg border bg-card">
        <table className={cn('w-full text-sm', rows.key !== refresh && rows.data && 'opacity-60')} aria-busy={rows.key !== refresh}>
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              {['Merchant', 'ID', 'Workflow', 'Active config', 'Users', 'Verifications', ''].map((h, i) => (
                <th key={i} scope="col" className={cn('px-4 py-2 font-medium', (i === 4 || i === 5) && 'text-right')}>{h || <span className="sr-only">Actions</span>}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.data?.map((r) => {
              const deletable = r.users === 0 && r.verifications === 0
              return (
                <tr key={r.merchantId} className="border-t">
                  <th scope="row" className="px-4 py-2 text-left font-medium">{r.name}</th>
                  <td className="px-4 py-2 font-mono text-xs">{r.merchantId}</td>
                  <td className="px-4 py-2">{r.workflowVersion}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.activeConfigVersion}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.users}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.verifications}</td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    <Button variant="ghost" size="icon-sm" aria-label={`Rename ${r.name}`} onClick={() => setEditing({ mode: 'rename', row: r })}>
                      <Pencil aria-hidden />
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label={deletable ? `Delete ${r.name}` : `${r.name} can’t be deleted: it has users or verifications`} title={deletable ? undefined : 'Has users or verifications'} disabled={!deletable} onClick={() => void remove(r)}>
                      <Trash2 aria-hidden />
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>
      {editing && <MerchantDialog editing={editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); setRefresh((n) => n + 1) }} />}
    </div>
  )
}

import { useState, type FormEvent } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/FormField'
import { ErrorState } from '@/components/common/States'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { errorMessage, useLoad } from '@/hooks/useLoad'
import { cn } from '@/lib/utils'
import { isServiceError } from '@/services/errors'
import { merchantAdminService, type MerchantRow } from '@/services/merchantAdminService'
import { useSession } from '@/stores/sessionStore'

type Editing = { mode: 'create' } | { mode: 'rename'; row: MerchantRow }

function MerchantDialog({ editing, onClose, onSaved }: { editing: Editing; onClose: () => void; onSaved: () => void }) {
  const actor = useSession((s) => s.actor)
  const [name, setName] = useState(editing.mode === 'rename' ? editing.row.name : '')
  const [ownerName, setOwnerName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    try {
      if (editing.mode === 'create') {
        const m = await merchantAdminService.create({ name, ownerName, ownerEmail }, actor)
        toast.success(`${m.name} created (${m.merchantId})`, { description: 'Default project and Draft default flow created; the owner is invited.' })
      } else {
        await merchantAdminService.rename(editing.row.merchantId, name, actor)
        toast.success('Merchant renamed')
      }
      onSaved()
    } catch (err) {
      if (isServiceError(err) && Array.isArray(err.details)) setErrors(Object.fromEntries((err.details as { field: string; message: string }[]).map((x) => [x.field, x.message])))
      else setErrors({ form: errorMessage(err) })
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
            <DialogDescription>
              {editing.mode === 'create' ? 'Creates its Default project with a Draft default flow on the registry’s default version, and invites the first user as Merchant Owner.' : 'Names are unique.'}
            </DialogDescription>
          </DialogHeader>
          <FormField id="m-name" label="Merchant name" error={errors.name}>
            <Input id="m-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} autoFocus />
          </FormField>
          {editing.mode === 'create' && (
            <>
              <FormField id="m-owner" label="Merchant Owner: full name" error={errors.ownerName}>
                <Input id="m-owner" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} aria-invalid={!!errors.ownerName} />
              </FormField>
              <FormField id="m-email" label="Merchant Owner: email" error={errors.ownerEmail}>
                <Input id="m-email" type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} aria-invalid={!!errors.ownerEmail} />
              </FormField>
            </>
          )}
          {errors.form && (
            <p role="alert" className="text-sm text-destructive">
              {errors.form}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : editing.mode === 'create' ? 'Create merchant' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// REQ: DEC-70 / DEC-92 — Platform Admin only.
export function MerchantsPage() {
  const actor = useSession((s) => s.actor)
  const rows = useLoad(() => merchantAdminService.list(actor), [actor.userId])
  const [editing, setEditing] = useState<Editing>()

  const remove = async (r: MerchantRow) => {
    if (!window.confirm(`Delete ${r.name} (${r.merchantId})? Its projects, flows and users are removed too. This cannot be undone.`)) return
    try {
      await merchantAdminService.remove(r.merchantId, actor)
      toast.success(`${r.name} deleted`)
      rows.reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  if (rows.error && !rows.data) return <ErrorState message={rows.error} onRetry={rows.reload} />
  return (
    <div className="mx-auto max-w-[1200px] space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Merchants</h1>
          <p className="text-sm text-muted-foreground">Merchants using the eKYC service. Their projects, flows and users are managed inside each merchant.</p>
        </div>
        <Button onClick={() => setEditing({ mode: 'create' })}>
          <Plus aria-hidden /> New merchant
        </Button>
      </header>
      <section aria-label="Merchant list" className="overflow-x-auto rounded-lg border bg-card">
        <table className={cn('w-full text-sm', rows.loading && rows.data && 'opacity-60')} aria-busy={rows.loading}>
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              {['Merchant', 'ID', 'Merchant Owner', 'Projects', 'Users', 'Cases'].map((h, i) => (
                <th key={h} scope="col" className={cn('px-4 py-2 font-medium', i >= 3 && 'text-right')}>
                  {h}
                </th>
              ))}
              <th scope="col" className="px-4 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {(rows.data ?? []).map((r) => (
              <tr key={r.merchantId} className="border-t">
                <th scope="row" className="px-4 py-2 text-left font-medium">
                  {r.name}
                </th>
                <td className="px-4 py-2 font-mono text-xs">{r.merchantId}</td>
                <td className="px-4 py-2">
                  {r.owner ? (
                    <>
                      {r.owner.fullName}
                      <div className="text-xs text-muted-foreground">
                        {r.owner.email}
                        {r.owner.status === 'PENDING' ? ' · Pending' : ''}
                      </div>
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{r.projects}</td>
                <td className="px-4 py-2 text-right tabular-nums">{r.users}</td>
                <td className="px-4 py-2 text-right tabular-nums">{r.cases}</td>
                <td className="px-2 py-2 text-right whitespace-nowrap">
                  <Button variant="ghost" size="icon-sm" aria-label={`Rename ${r.name}`} onClick={() => setEditing({ mode: 'rename', row: r })}>
                    <Pencil aria-hidden />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={r.deletable ? `Delete ${r.name}` : `${r.name} can’t be deleted: it has cases`} title={r.deletable ? undefined : 'Has cases'} disabled={!r.deletable} onClick={() => void remove(r)}>
                    <Trash2 aria-hidden />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {editing && <MerchantDialog editing={editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); rows.reload() }} />}
    </div>
  )
}

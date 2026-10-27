// REQ: DEC-93 / DEC-109 — New project (from a merchant row on the Merchants page), rename and archive (Project Settings ›
// General). MOCK-12: a new project starts with a Draft default flow.
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/FormField'
import { NativeSelect } from '@/components/common/NativeSelect'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { Project } from '@/domain/types'
import { errorMessage, useLoad } from '@/hooks/useLoad'
import { isServiceError } from '@/services/errors'
import { projectService } from '@/services/projectService'
import { useSession } from '@/stores/sessionStore'

/** A project to rename or archive: what the dialog needs to know. */
export type ProjectRef = Pick<Project, 'projectId' | 'name'>
export type ProjectEditing = { mode: 'create'; merchantId?: string } | { mode: 'rename'; row: ProjectRef } | { mode: 'archive'; row: ProjectRef }

function fieldError(e: unknown, field: string): string | undefined {
  if (!isServiceError(e) || !Array.isArray(e.details)) return undefined
  return (e.details as { field: string; message: string }[]).find((d) => d.field === field)?.message
}

// REQ: DEC-93 — create (name required, unique per merchant), rename, archive. MOCK-12: a new project starts with a Draft default flow.
export function ProjectDialog({ editing, onClose, onSaved }: { editing: ProjectEditing; onClose: () => void; onSaved: (projectId?: string) => void }) {
  const actor = useSession((s) => s.actor)
  const merchants = useLoad(() => projectService.creatableMerchants(actor), [actor.userId])
  const [name, setName] = useState(editing.mode === 'rename' ? editing.row.name : '')
  const [merchantId, setMerchantId] = useState(editing.mode === 'create' ? (editing.merchantId ?? '') : '')
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
          {editing.mode === 'create' && !editing.merchantId && options.length > 1 && (
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

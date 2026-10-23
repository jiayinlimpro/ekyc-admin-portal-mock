// REQ: DEC-106 — Project Settings › Review operations › Decision reasons: what reviewers choose on Approve or Reject in
// this project. System Default reasons are locked (turn off only); Custom ones are added, renamed or turned off.
import { useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/FormField'
import { NativeSelect } from '@/components/common/NativeSelect'
import { Switch } from '@/components/common/Switch'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { canTurnOff, REASON_NAME_MAX, reasonsOf, REJECT_GROUP_LABELS } from '@/domain/decisionReasons'
import { REJECT_REASON_GROUPS, type DecisionOutcome, type DecisionReason, type Project, type RejectReasonGroup } from '@/domain/types'
import { errorMessage, fieldErrors } from '@/hooks/useLoad'
import { projectService } from '@/services/projectService'
import { useSession } from '@/stores/sessionStore'
import { Card } from './settingsUi'

type Editing = { mode: 'create' } | { mode: 'edit'; reason: DecisionReason }

function ReasonDialog({ project, editing, onClose, onSaved }: { project: Project; editing: Editing; onClose: () => void; onSaved: () => void }) {
  const actor = useSession((s) => s.actor)
  const start = editing.mode === 'edit' ? editing.reason : undefined
  const [outcome, setOutcome] = useState<DecisionOutcome>(start?.outcome ?? 'REJECT')
  const [group, setGroup] = useState<RejectReasonGroup | ''>(start?.group ?? '')
  const [name, setName] = useState(start?.name ?? '')
  const [noteRequired, setNoteRequired] = useState(start?.noteRequired ?? false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    const input = { name, group: outcome === 'REJECT' ? group || undefined : undefined, noteRequired }
    try {
      if (start) await projectService.updateDecisionReason(project.projectId, start.code, input, actor)
      else await projectService.addDecisionReason(project.projectId, { ...input, outcome }, actor)
      toast.success(start ? 'Reason saved' : 'Reason added', { description: 'Reviewers see it on their next decision.' })
      onSaved()
    } catch (err) {
      setErrors(fieldErrors(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{start ? 'Edit reason' : 'New decision reason'}</DialogTitle>
          <DialogDescription>{start ? 'Past decisions keep the name they were made with.' : 'Reasons are never deleted; turn one off when it is no longer used.'}</DialogDescription>
        </DialogHeader>
        <form id="reason-form" onSubmit={(e) => void submit(e)} noValidate className="space-y-3">
          <fieldset>
            <legend className="mb-1 text-sm font-medium">Outcome</legend>
            <div className="flex gap-4 text-sm">
              {(['REJECT', 'APPROVE'] as const).map((o) => (
                <label key={o} className="flex items-center gap-2">
                  <input type="radio" name="reason-outcome" checked={outcome === o} disabled={!!start} onChange={() => setOutcome(o)} />
                  {o === 'REJECT' ? 'Reject' : 'Approve'}
                </label>
              ))}
            </div>
          </fieldset>
          {outcome === 'REJECT' && (
            <FormField id="reason-group" label="Group" error={errors.group}>
              <NativeSelect id="reason-group" value={group} onChange={(e) => setGroup(e.target.value as RejectReasonGroup)} aria-invalid={!!errors.group}>
                <option value="">Choose a group</option>
                {REJECT_REASON_GROUPS.map((g) => (
                  <option key={g} value={g}>
                    {REJECT_GROUP_LABELS[g]}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          )}
          <FormField id="reason-name" label="Name" error={errors.name} hint={`Shown to reviewers. At most ${REASON_NAME_MAX} characters.`}>
            <Input id="reason-name" value={name} maxLength={REASON_NAME_MAX} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} />
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={noteRequired} onChange={(e) => setNoteRequired(e.target.checked)} />
            Reviewer must add a note
          </label>
          {errors.form && <p className="text-sm text-destructive">{errors.form}</p>}
        </form>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="reason-form" disabled={busy}>
            {busy ? 'Saving…' : start ? 'Save' : 'Add reason'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReasonTable({ title, rows, showGroup, canEdit, onToggle, onEdit }: { title: string; rows: DecisionReason[]; showGroup: boolean; canEdit: boolean; onToggle: (r: DecisionReason) => void; onEdit: (r: DecisionReason) => void }) {
  return (
    <div className="-mx-4 overflow-x-auto">
      <table className="w-full text-sm" aria-label={title}>
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="px-4 py-2 font-medium">Reason</th>
            {showGroup && <th className="px-2 py-2 font-medium">Group</th>}
            <th className="px-2 py-2 font-medium">Type</th>
            <th className="px-2 py-2 font-medium">Note</th>
            <th className="px-2 py-2 font-medium">On</th>
            {canEdit && <th className="px-4 py-2 font-medium"><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code} className={`border-b last:border-0 ${r.active ? '' : 'text-muted-foreground'}`}>
              <th scope="row" className="px-4 py-2 text-left font-normal">{r.name}</th>
              {showGroup && <td className="px-2 py-2 whitespace-nowrap">{r.group ? REJECT_GROUP_LABELS[r.group] : '—'}</td>}
              <td className="px-2 py-2 whitespace-nowrap">{r.system ? 'System Default' : 'Custom'}</td>
              <td className="px-2 py-2 whitespace-nowrap">{r.noteRequired ? 'Required' : 'Optional'}</td>
              <td className="px-2 py-2">
                {/* REQ: DEC-78 — "Other" stays on, so the switch is disabled with the reason beside it. */}
                <span className="flex items-center gap-2">
                  <Switch checked={r.active} label={`${r.name} on`} disabled={!canEdit || !canTurnOff(r)} onChange={() => onToggle(r)} />
                  {!canTurnOff(r) && <span className="text-xs text-muted-foreground">Always on</span>}
                </span>
              </td>
              {canEdit && (
                <td className="px-4 py-2 text-right">
                  {!r.system && (
                    <Button size="sm" variant="ghost" onClick={() => onEdit(r)} aria-label={`Edit ${r.name}`}>
                      Edit
                    </Button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function DecisionReasonsCard({ project, canEdit, onSaved }: { project: Project; canEdit: boolean; onSaved: () => void }) {
  const actor = useSession((s) => s.actor)
  const [editing, setEditing] = useState<Editing>()
  const all = reasonsOf(project.decisionReasons)
  const toggle = async (r: DecisionReason) => {
    try {
      await projectService.setDecisionReasonActive(project.projectId, r.code, !r.active, actor)
      toast.success(`${r.name} turned ${r.active ? 'off' : 'on'}`)
      onSaved()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <Card
      title="Decision reasons"
      aside={
        canEdit && (
          <Button size="sm" variant="outline" onClick={() => setEditing({ mode: 'create' })}>
            <Plus aria-hidden /> New reason
          </Button>
        )
      }
    >
      <p className="mb-3 text-sm text-muted-foreground">
        What reviewers choose: one or more reasons to reject, exactly one to approve. System Default reasons are the same in every project and can only be turned off. Reasons are never
        deleted, because past decisions use them.
      </p>
      <div className="space-y-5">
        <div>
          <h3 className="mb-1 text-sm font-medium">Reject reasons</h3>
          <ReasonTable title="Reject reasons" rows={all.filter((r) => r.outcome === 'REJECT')} showGroup canEdit={canEdit} onToggle={(r) => void toggle(r)} onEdit={(reason) => setEditing({ mode: 'edit', reason })} />
        </div>
        <div>
          <h3 className="mb-1 text-sm font-medium">Approve reasons</h3>
          <ReasonTable title="Approve reasons" rows={all.filter((r) => r.outcome === 'APPROVE')} showGroup={false} canEdit={canEdit} onToggle={(r) => void toggle(r)} onEdit={(reason) => setEditing({ mode: 'edit', reason })} />
        </div>
      </div>
      {editing && (
        <ReasonDialog
          key={editing.mode === 'edit' ? editing.reason.code : 'new'}
          project={project}
          editing={editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined)
            onSaved()
          }}
        />
      )}
    </Card>
  )
}

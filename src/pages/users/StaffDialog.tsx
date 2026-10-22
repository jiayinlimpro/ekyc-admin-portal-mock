// REQ: DEC-99 — a platform staff member's details: Access table (Role | Merchant access | Added by | Date | Ends) with
// Add / Edit / Remove, Resend invitation, Suspend / Reactivate. Super admins only.
import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { errorMessage, useLoad } from '@/hooks/useLoad'
import { formatMyt } from '@/lib/format'
import { merchantService } from '@/services/merchantService'
import { staffService, type StaffAssignmentRow } from '@/services/staffService'
import type { AssignmentInput } from '@/services/userAdminService'
import { useSession } from '@/stores/sessionStore'
import { AssignmentDialog, UserStatusBadge } from './AccessFields'

type Editing = { mode: 'add' } | { mode: 'edit'; row: StaffAssignmentRow }

export function StaffDialog({ userId, onClose, onChanged }: { userId: string; onClose: () => void; onChanged: () => void }) {
  const actor = useSession((s) => s.actor)
  const user = useLoad(() => staffService.get(userId, actor), [userId, actor.userId])
  const roles = useLoad(() => staffService.assignableRoles(actor), [actor.userId])
  const merchants = useLoad(() => merchantService.list(actor), [actor.userId])
  const [editing, setEditing] = useState<Editing>()
  const u = user.data

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      toast.success(ok)
      user.reload()
      onChanged()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const save = async (v: AssignmentInput) => {
    if (!u || !editing) return
    if (editing.mode === 'add') await staffService.addAssignment(u.userId, v, actor)
    else await staffService.changeAssignment(u.userId, editing.row.assignmentId, v, actor)
    toast.success(editing.mode === 'add' ? 'Access added' : 'Access changed')
    user.reload()
    onChanged()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{u ? u.fullName : 'Staff member'}</DialogTitle>
          <DialogDescription>{u ? `${u.email} · Platform (internal)` : 'Loading…'}</DialogDescription>
        </DialogHeader>
        {u && (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">User ID</dt>
                <dd className="font-mono text-xs break-all">{u.userId}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Status</dt>
                <dd><UserStatusBadge status={u.status} /></dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Created at</dt>
                <dd>{formatMyt(u.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Last active</dt>
                <dd>{u.lastActiveAt ? formatMyt(u.lastActiveAt) : '—'}</dd>
              </div>
            </dl>
            <section aria-label="Access">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Access</h3>
                <Button size="sm" variant="outline" onClick={() => setEditing({ mode: 'add' })}>
                  <Plus aria-hidden /> Add access
                </Button>
              </div>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      {['Staff role', 'Merchant access', 'Added by', 'Date', 'Ends'].map((h) => (
                        <th key={h} scope="col" className="px-3 py-2 font-medium">
                          {h}
                        </th>
                      ))}
                      <th scope="col" className="px-3 py-2">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {u.assignments.map((a) => (
                      <tr key={a.assignmentId} className={a.ended ? 'border-t text-muted-foreground' : 'border-t'}>
                        <th scope="row" className="px-3 py-2 text-left font-medium">{a.roleName}</th>
                        <td className="px-3 py-2">{a.scopeLabel}</td>
                        <td className="px-3 py-2">{a.addedBy.fullName}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{formatMyt(a.addedAt).split(', ')[0]}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{a.endsAt ? `${a.ended ? 'Ended' : 'Ends'} ${formatMyt(a.endsAt).split(', ')[0]}` : 'Never'}</td>
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          {a.editable && (
                            <>
                              <Button variant="ghost" size="icon-sm" aria-label={`Edit ${a.roleName} · ${a.scopeLabel}`} onClick={() => setEditing({ mode: 'edit', row: a })}>
                                <Pencil aria-hidden />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Remove ${a.roleName} · ${a.scopeLabel}`}
                                onClick={() => window.confirm(`Remove ${a.roleName} · ${a.scopeLabel} from ${u.fullName}?`) && void act(() => staffService.removeAssignment(u.userId, a.assignmentId, actor), 'Access removed')}
                              >
                                <Trash2 aria-hidden />
                              </Button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!u.assignments.length && <p className="px-3 py-4 text-sm text-muted-foreground">No access yet. Add access so they can use the portal.</p>}
              </div>
            </section>
          </div>
        )}
        <DialogFooter>
          {u?.status === 'PENDING' && (
            <Button variant="outline" onClick={() => void act(() => staffService.resendInvitation(u.userId, actor), `Invitation resent to ${u.email}`)}>
              Resend invitation
            </Button>
          )}
          {u && u.status !== 'SUSPENDED' && (
            <Button variant="destructive" onClick={() => window.confirm(`Suspend ${u.fullName}? They can’t sign in until reactivated.`) && void act(() => staffService.suspend(u.userId, actor), `${u.fullName} suspended`)}>
              Suspend
            </Button>
          )}
          {u?.status === 'SUSPENDED' && (
            <Button variant="outline" onClick={() => void act(() => staffService.reactivate(u.userId, actor), `${u.fullName} reactivated`)}>
              Reactivate
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
        {editing && u && (
          <AssignmentDialog
            title={editing.mode === 'add' ? `Add access for ${u.fullName}` : `Edit ${editing.row.roleName} for ${u.fullName}`}
            who={u.fullName}
            staff
            initial={editing.mode === 'edit' ? { roleId: editing.row.roleId, scope: editing.row.scope, endsAt: editing.row.endsAt } : undefined}
            roles={roles.data ?? []}
            projects={[]}
            merchants={merchants.data ?? []}
            onSave={save}
            onClose={() => setEditing(undefined)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

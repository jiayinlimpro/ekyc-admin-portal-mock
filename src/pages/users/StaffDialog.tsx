// REQ: DEC-99 / DEC-104 — a platform staff member's details: their one platform role (Change role; no merchant scope),
// Resend invitation, Suspend / Reactivate. Super admins only.
import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { errorMessage, useLoad } from '@/hooks/useLoad'
import { formatMyt } from '@/lib/format'
import { staffService } from '@/services/staffService'
import { useSession } from '@/stores/sessionStore'
import { ChangeRoleDialog, UserStatusBadge } from './AccessFields'

export function StaffDialog({ userId, onClose, onChanged }: { userId: string; onClose: () => void; onChanged: () => void }) {
  const actor = useSession((s) => s.actor)
  const user = useLoad(() => staffService.get(userId, actor), [userId, actor.userId])
  const roles = useLoad(() => staffService.assignableRoles(actor), [actor.userId])
  const [changing, setChanging] = useState(false)
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
  const saveRole = async (roleId: string) => {
    if (!u) return
    await staffService.setRole(u.userId, roleId, actor)
    toast.success('Role changed')
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
            <section aria-label="Staff role" className="rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground">Staff role</h3>
                  <p className="text-sm font-medium">{u.roleName ?? '—'}</p>
                  <p className="text-xs text-muted-foreground">Applies to every merchant.</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setChanging(true)}>
                  <Pencil aria-hidden /> Change role
                </Button>
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
        {changing && u && <ChangeRoleDialog who={u.fullName} merchant={false} roles={roles.data ?? []} initialRoleId={u.roleId} onSave={saveRole} onClose={() => setChanging(false)} />}
      </DialogContent>
    </Dialog>
  )
}

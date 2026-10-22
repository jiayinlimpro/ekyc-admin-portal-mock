// REQ: DEC-79 — Admins: the internal Platform Admin accounts. No roles or scopes; their rights are fixed (DEC-70).
import { useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/FormField'
import { ErrorState } from '@/components/common/States'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { errorMessage, fieldErrors, useLoad } from '@/hooks/useLoad'
import { formatMyt } from '@/lib/format'
import { cn } from '@/lib/utils'
import { adminService, type AdminRow } from '@/services/adminService'
import { useSession } from '@/stores/sessionStore'
import { UserStatusBadge } from '../users/AccessFields'

function InviteAdminDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const actor = useSession((s) => s.actor)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  // REQ: DEC-97 — the User ID is generated when the form opens and shown read-only.
  const draft = useLoad(() => adminService.draftUserId(actor), [actor.userId])
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    try {
      const a = await adminService.invite({ userId: draft.data, fullName, email }, actor)
      toast.success(`${a.fullName} invited`, { description: 'Pending until they accept the invitation.' })
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
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>New admin</DialogTitle>
            <DialogDescription>Platform Admins work in every merchant with a fixed set of rights. They are Pending until they accept the invitation.</DialogDescription>
          </DialogHeader>
          <FormField id="na-id" label="User ID" hint="Generated; it can’t be changed.">
            <Input id="na-id" value={draft.data ?? ''} placeholder={draft.loading ? 'Generating…' : ''} readOnly disabled className="font-mono text-xs" />
          </FormField>
          <FormField id="na-name" label="Full name" error={errors.fullName}>
            <Input id="na-name" value={fullName} onChange={(e) => setFullName(e.target.value)} aria-invalid={!!errors.fullName} autoFocus />
          </FormField>
          <FormField id="na-email" label="Work email" error={errors.email}>
            <Input id="na-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors.email} />
          </FormField>
          {errors.form && (
            <p role="alert" className="text-sm text-destructive">
              {errors.form}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !draft.data}>
              {busy ? 'Inviting…' : 'Invite admin'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function AdminsPage() {
  const actor = useSession((s) => s.actor)
  const rows = useLoad(() => adminService.list(actor), [actor.userId])
  const [inviting, setInviting] = useState(false)

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      toast.success(ok)
      rows.reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const actions = (r: AdminRow) => (
    <span className="flex justify-end gap-2">
      {r.status === 'PENDING' && (
        <Button size="sm" variant="outline" onClick={() => void act(() => adminService.resendInvitation(r.userId, actor), `Invitation resent to ${r.email}`)}>
          Resend invitation
        </Button>
      )}
      {r.status === 'SUSPENDED' ? (
        <Button size="sm" variant="outline" onClick={() => void act(() => adminService.reactivate(r.userId, actor), `${r.fullName} reactivated`)}>
          Reactivate
        </Button>
      ) : (
        // REQ: DEC-78 — blocked by the current state: shown disabled with the reason.
        <span title={r.suspendBlocked} className="inline-flex">
          <Button
            size="sm"
            variant="outline"
            disabled={!!r.suspendBlocked}
            aria-label={`Suspend ${r.fullName}`}
            aria-description={r.suspendBlocked}
            onClick={() => window.confirm(`Suspend ${r.fullName}? They can’t sign in until reactivated.`) && void act(() => adminService.suspend(r.userId, actor), `${r.fullName} suspended`)}
          >
            Suspend
          </Button>
        </span>
      )}
    </span>
  )

  if (rows.error && !rows.data) return <ErrorState message={rows.error} onRetry={rows.reload} />
  return (
    <div className="mx-auto max-w-[1200px] space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Admins</h1>
          <p className="text-sm text-muted-foreground">Platform Admin accounts. Merchant users are on the Users screen.</p>
        </div>
        <Button onClick={() => setInviting(true)}>
          <Plus aria-hidden /> New admin
        </Button>
      </header>
      <section aria-label="Admin list" className="overflow-x-auto rounded-lg border bg-card">
        <table className={cn('w-full text-sm', rows.loading && rows.data && 'opacity-60')} aria-busy={rows.loading}>
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              {['Full Name', 'Email', 'Status', 'Created At', 'Last active'].map((h) => (
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
            {(rows.data ?? []).map((r) => (
              <tr key={r.userId} className="border-t">
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  {r.fullName}
                  {r.userId === actor.userId && <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span>}
                </th>
                <td className="px-3 py-2">{r.email}</td>
                <td className="px-3 py-2">
                  <UserStatusBadge status={r.status} />
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{formatMyt(r.createdAt)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.lastActiveAt ? formatMyt(r.lastActiveAt) : '—'}</td>
                <td className="px-3 py-2">{actions(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {inviting && (
        <InviteAdminDialog
          onClose={() => setInviting(false)}
          onSaved={() => {
            setInviting(false)
            rows.reload()
          }}
        />
      )}
    </div>
  )
}

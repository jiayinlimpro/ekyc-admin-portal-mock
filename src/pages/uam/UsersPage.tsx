import { useEffect, useState, type FormEvent } from 'react'
import { MoreVertical, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { NativeSelect } from '@/components/common/NativeSelect'
import { EmptyState, ErrorState } from '@/components/common/States'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ROLES, type Merchant, type RoleType, type UserRecord } from '@/domain/types'
import { formatMyt } from '@/lib/format'
import { ROLE_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { isServiceError } from '@/services/errors'
import { merchantService } from '@/services/merchantService'
import { uamService, type UserInput } from '@/services/uamService'
import { useSession } from '@/stores/sessionStore'

const message = (e: unknown) => (isServiceError(e) ? e.message : 'Unexpected error.')

function UserDialog({ user, merchants, onClose, onSaved }: { user?: UserRecord; merchants: Merchant[]; onClose: () => void; onSaved: () => void }) {
  const actor = useSession((s) => s.actor)
  const [form, setForm] = useState<UserInput>({ fullName: user?.fullName ?? '', role: user?.role ?? 'MERCHANT_REVIEWER', merchantId: user?.merchantId ?? merchants[0]?.merchantId })
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const saved = user ? await uamService.updateUser(user.userId, form, actor) : await uamService.createUser(form, actor)
      toast.success(user ? 'User updated' : `${saved.fullName} created (${saved.userId})`)
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
            <DialogTitle>{user ? `Edit ${user.userId}` : 'New user'}</DialogTitle>
            <DialogDescription>Mock only: there is no invitation email or password. Use Dev → Switch user to act as them.</DialogDescription>
          </DialogHeader>
          <div>
            <label htmlFor="u-name" className="mb-1 block text-xs font-medium text-muted-foreground">Full name</label>
            <Input id="u-name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} autoFocus />
          </div>
          <fieldset>
            <legend className="mb-1 text-xs font-medium text-muted-foreground">Role</legend>
            <div className="flex gap-4 text-sm">
              {ROLES.map((r) => (
                <label key={r} className="flex items-center gap-2">
                  <input type="radio" name="role" value={r} checked={form.role === r} onChange={() => setForm({ ...form, role: r as RoleType })} />
                  {ROLE_LABELS[r]}
                </label>
              ))}
            </div>
          </fieldset>
          {form.role === 'MERCHANT_REVIEWER' && (
            <div>
              <label htmlFor="u-merchant" className="mb-1 block text-xs font-medium text-muted-foreground">Merchant</label>
              <NativeSelect id="u-merchant" value={form.merchantId ?? ''} onChange={(e) => setForm({ ...form, merchantId: e.target.value })}>
                {merchants.map((m) => (
                  <option key={m.merchantId} value={m.merchantId}>{m.name}</option>
                ))}
              </NativeSelect>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : user ? 'Save' : 'Create user'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function UsersPage() {
  const actor = useSession((s) => s.actor)
  const [refresh, setRefresh] = useState(0)
  const [result, setResult] = useState<{ key: number; users?: UserRecord[]; error?: string }>({ key: -1 })
  const [merchants, setMerchants] = useState<Merchant[]>([])
  const [q, setQ] = useState('')
  const [role, setRole] = useState<'' | RoleType>('')
  const [editing, setEditing] = useState<{ user?: UserRecord }>()

  useEffect(() => {
    let live = true
    uamService.listUsers(actor).then((users) => live && setResult({ key: refresh, users }), (e: unknown) => live && setResult({ key: refresh, error: message(e) }))
    merchantService.list(actor).then((m) => live && setMerchants(m), () => undefined)
    return () => {
      live = false
    }
  }, [actor, refresh])

  const merchantName = (id?: string) => (id ? (merchants.find((m) => m.merchantId === id)?.name ?? id) : 'All merchants')
  const setActive = async (u: UserRecord, active: boolean) => {
    try {
      await uamService.setUserActive(u.userId, active, actor)
      toast.success(`${u.fullName} ${active ? 'reactivated' : 'deactivated'}`)
      setRefresh((n) => n + 1)
    } catch (e) {
      toast.error(message(e))
    }
  }

  if (result.error) return <ErrorState message={result.error} onRetry={() => setRefresh((n) => n + 1)} />
  const needle = q.trim().toLowerCase()
  const users = (result.users ?? []).filter((u) => (!role || u.role === role) && (!needle || u.fullName.toLowerCase().includes(needle) || u.userId.toLowerCase().includes(needle)))

  return (
    <div className="mx-auto max-w-[1200px] space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Users</h1>
          <p className="text-sm text-muted-foreground">Deactivated users can’t claim or decide. Their open claims still end by timeout.</p>
        </div>
        <Button onClick={() => setEditing({})}>
          <Plus aria-hidden /> New user
        </Button>
      </header>
      <div className="flex flex-wrap gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or user ID" aria-label="Search users" className="w-64 pl-8" />
        </div>
        <NativeSelect value={role} onChange={(e) => setRole(e.target.value as '' | RoleType)} aria-label="Filter by role" className="w-52">
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </NativeSelect>
      </div>
      <section aria-label="User list" className="overflow-x-auto rounded-lg border bg-card">
        {result.users && !users.length ? (
          <EmptyState title="No users match" />
        ) : (
          <table className="w-full text-sm" aria-busy={result.key !== refresh}>
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                {['Name', 'User ID', 'Role', 'Merchant', 'Status', 'Created (MYT)', ''].map((h, i) => (
                  <th key={i} scope="col" className="px-4 py-2 font-medium">{h || <span className="sr-only">Actions</span>}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.userId} className={cn('border-t', !u.active && 'text-muted-foreground')}>
                  <th scope="row" className="px-4 py-2 text-left font-medium">
                    {u.fullName}
                    {u.userId === actor.userId && <span className="ml-1 rounded bg-blue-100 px-1 text-[10px] text-blue-800 dark:bg-blue-500/20 dark:text-blue-300">You</span>}
                  </th>
                  <td className="px-4 py-2 font-mono text-xs">{u.userId}</td>
                  <td className="px-4 py-2">{ROLE_LABELS[u.role]}</td>
                  <td className="px-4 py-2">{merchantName(u.merchantId)}</td>
                  <td className="px-4 py-2">
                    <span className={cn('rounded px-1.5 py-0.5 text-xs', u.active ? 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-200' : 'bg-muted')}>{u.active ? 'Active' : 'Inactive'}</span>
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">{formatMyt(u.createdAt)}</td>
                  <td className="px-2 py-2 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${u.fullName}`}><MoreVertical aria-hidden /></Button>} />
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem onClick={() => setEditing({ user: u })}>Edit</DropdownMenuItem>
                        {u.active ? (
                          <DropdownMenuItem variant="destructive" disabled={u.userId === actor.userId} onClick={() => void setActive(u, false)}>Deactivate</DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => void setActive(u, true)}>Reactivate</DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {editing && <UserDialog user={editing.user} merchants={merchants} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); setRefresh((n) => n + 1) }} />}
    </div>
  )
}

// REQ: DEC-74 — [FRS] User Management › Users, with scoped role assignments (DEC-70).
import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import { Pencil, Plus, RotateCcw, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAccess } from '@/app/access'
import { FormField } from '@/components/common/FormField'
import { NativeSelect } from '@/components/common/NativeSelect'
import { Pagination } from '@/components/common/Pagination'
import { EmptyState, ErrorState } from '@/components/common/States'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { USER_STATUSES, type UserStatus } from '@/domain/types'
import { errorMessage, useLoad } from '@/hooks/useLoad'
import { formatMyt } from '@/lib/format'
import { USER_STATUS_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { merchantService } from '@/services/merchantService'
import { roleService } from '@/services/roleService'
import { userAdminService, type AssignmentInput, type AssignmentRow, type UserRow } from '@/services/userAdminService'
import { useSession } from '@/stores/sessionStore'
import { AssignmentDialog, AssignmentFields, fieldErrors, UserStatusBadge, type ProjectOption } from './AccessFields'

const PAGE_SIZES = [10, 20, 50] as const

/** Active projects of a merchant, for the scope picker (archived projects take no new members, DEC-77). */
function useMerchantProjects(merchantId: string | undefined): ProjectOption[] {
  const { projects } = useAccess()
  return projects.filter((p) => p.merchantId === merchantId && p.status === 'ACTIVE').map(({ projectId, name }) => ({ projectId, name }))
}

function InviteDialog({ merchants, defaultMerchantId, onClose, onSaved }: { merchants: { merchantId: string; name: string }[]; defaultMerchantId?: string; onClose: () => void; onSaved: () => void }) {
  const actor = useSession((s) => s.actor)
  const [merchantId, setMerchantId] = useState(defaultMerchantId ?? '')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [assignment, setAssignment] = useState<AssignmentInput>({ roleId: '', scope: { kind: 'PROJECTS', projectIds: [] } })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const roles = useLoad(() => (merchantId ? roleService.assignable(merchantId, actor) : Promise.resolve([])), [merchantId, actor.userId])
  const projects = useMerchantProjects(merchantId)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!merchantId) return setErrors({ merchantId: 'Choose a merchant.' })
    if (!assignment.roleId) return setErrors({ roleId: 'Choose a role.' })
    setBusy(true)
    setErrors({})
    try {
      const u = await userAdminService.invite(merchantId, { fullName, email, assignment }, actor)
      toast.success(`${u.fullName} invited (${u.userId})`, { description: 'Pending until they accept the invitation.' })
      onSaved()
    } catch (err) {
      setErrors(fieldErrors(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>New user</DialogTitle>
            <DialogDescription>The user is Pending until they accept the emailed invitation. Add more access later on their details.</DialogDescription>
          </DialogHeader>
          {merchants.length > 1 && (
            <FormField id="nu-merchant" label="Merchant" error={errors.merchantId}>
              <NativeSelect id="nu-merchant" value={merchantId} onChange={(e) => { setMerchantId(e.target.value); setAssignment({ roleId: '', scope: { kind: 'PROJECTS', projectIds: [] } }) }}>
                <option value="">Choose a merchant</option>
                {merchants.map((m) => (
                  <option key={m.merchantId} value={m.merchantId}>
                    {m.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          )}
          <FormField id="nu-name" label="Full name" error={errors.fullName}>
            <Input id="nu-name" value={fullName} onChange={(e) => setFullName(e.target.value)} aria-invalid={!!errors.fullName} autoFocus />
          </FormField>
          <FormField id="nu-email" label="Work email" error={errors.email}>
            <Input id="nu-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors.email} />
          </FormField>
          {merchantId && <AssignmentFields idPrefix="nu" roles={roles.data ?? []} projects={projects} value={assignment} onChange={setAssignment} errors={errors} />}
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
              {busy ? 'Inviting…' : 'Invite user'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type Editing = { mode: 'add' } | { mode: 'edit'; row: AssignmentRow }

function UserDialog({ userId, onClose, onChanged }: { userId: string; onClose: () => void; onChanged: () => void }) {
  const actor = useSession((s) => s.actor)
  const user = useLoad(() => userAdminService.get(userId, actor), [userId, actor.userId])
  const u = user.data
  const roles = useLoad(() => (u ? roleService.assignable(u.merchantId, actor) : Promise.resolve([])), [u?.merchantId, actor.userId])
  const projects = useMerchantProjects(u?.merchantId)
  const [editing, setEditing] = useState<Editing>()

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
    if (editing.mode === 'add') await userAdminService.addAssignment(u.userId, v, actor)
    else await userAdminService.changeAssignment(u.userId, editing.row.assignmentId, v, actor)
    toast.success(editing.mode === 'add' ? 'Access added' : 'Access changed')
    user.reload()
    onChanged()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{u ? u.fullName : 'User'}</DialogTitle>
          <DialogDescription>{u ? `${u.userId} · ${u.email} · ${u.merchantName}` : 'Loading…'}</DialogDescription>
        </DialogHeader>
        {user.error && !u && <ErrorState message={user.error} onRetry={user.reload} />}
        {u && (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
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
                {u.canManage && (
                  <Button size="sm" variant="outline" onClick={() => setEditing({ mode: 'add' })}>
                    <Plus aria-hidden /> Add access
                  </Button>
                )}
              </div>
              {u.isSelf && <p className="mb-2 text-xs text-muted-foreground">You can’t change your own access.</p>}
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      {['Role', 'Scope', 'Added by', 'Date'].map((h) => (
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
                      <tr key={a.assignmentId} className="border-t">
                        <th scope="row" className="px-3 py-2 text-left font-medium">{a.roleName}</th>
                        <td className="px-3 py-2">{a.scope.kind === 'ALL_PROJECTS' ? <span title="Includes projects created later">All projects</span> : a.scopeLabel}</td>
                        <td className="px-3 py-2">{a.addedBy.fullName}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{formatMyt(a.addedAt).split(', ')[0]}</td>
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          {a.editable && (
                            <>
                              <Button variant="ghost" size="icon-sm" aria-label={`Edit ${a.roleName} (${a.scopeLabel})`} onClick={() => setEditing({ mode: 'edit', row: a })}>
                                <Pencil aria-hidden />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Remove ${a.roleName} (${a.scopeLabel})`}
                                onClick={() => window.confirm(`Remove ${a.roleName} (${a.scopeLabel}) from ${u.fullName}? Their open claims there are released.`) && void act(() => userAdminService.removeAssignment(u.userId, a.assignmentId, actor), 'Access removed')}
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
                {!u.assignments.length && <p className="px-3 py-4 text-sm text-muted-foreground">No access yet: this user can sign in but sees no project.</p>}
              </div>
            </section>
          </div>
        )}
        <DialogFooter>
          {u?.canManage && u.status === 'PENDING' && (
            <Button variant="outline" onClick={() => void act(() => userAdminService.resendInvitation(u.userId, actor), `Invitation resent to ${u.email}`)}>
              Resend invitation
            </Button>
          )}
          {u?.canManage && u.status !== 'SUSPENDED' && (
            <Button variant="destructive" onClick={() => window.confirm(`Suspend ${u.fullName}? They can’t sign in and their open claims are released.`) && void act(() => userAdminService.suspend(u.userId, actor), `${u.fullName} suspended`)}>
              Suspend
            </Button>
          )}
          {u?.canManage && u.status === 'SUSPENDED' && (
            <Button variant="outline" onClick={() => void act(() => userAdminService.reactivate(u.userId, actor), `${u.fullName} reactivated`)}>
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
            initial={editing.mode === 'edit' ? { roleId: editing.row.roleId, scope: editing.row.scope } : undefined}
            roles={roles.data ?? []}
            projects={projects}
            onSave={save}
            onClose={() => setEditing(undefined)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

type Filters = { q: string; status: '' | UserStatus; merchantId: string }

const matches = (r: UserRow, f: Filters) => {
  const q = f.q.trim().toLowerCase()
  return (!q || [r.userId, r.fullName, r.email].some((x) => x.toLowerCase().includes(q))) && (!f.status || r.status === f.status) && (!f.merchantId || r.merchantId === f.merchantId)
}

export function UsersPage() {
  const actor = useSession((s) => s.actor)
  const { account } = useAccess()
  const isAdmin = account?.level === 'PLATFORM_ADMIN'
  const [sp, setSp] = useSearchParams()
  const applied: Filters = { q: sp.get('q') ?? '', status: (sp.get('status') ?? '') as Filters['status'], merchantId: sp.get('merchantId') ?? '' }
  const [form, setForm] = useState<Filters>(applied)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0])
  const [inviting, setInviting] = useState(false)
  const [open, setOpen] = useState<string>()
  const rows = useLoad(() => userAdminService.list(actor), [actor.userId])
  const merchants = useLoad(() => merchantService.list(actor), [actor.userId])

  const apply = (f: Filters) => {
    setSp(Object.fromEntries(Object.entries(f).filter(([, v]) => v)), { replace: true })
    setPage(1)
  }
  const filtered = (rows.data ?? []).filter((r) => matches(r, applied))
  const shown = filtered.slice((page - 1) * pageSize, page * pageSize)
  const headers = ['User ID', 'Full Name', 'Email', ...(isAdmin ? ['Merchant'] : []), 'Access', 'Status', 'Created At']

  if (rows.error && !rows.data) return <ErrorState message={rows.error} onRetry={rows.reload} />
  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Users</h1>
          <p className="text-sm text-muted-foreground">Access is a role and where it applies: All projects (including new ones) or selected projects.</p>
        </div>
        <Button onClick={() => setInviting(true)}>
          <Plus aria-hidden /> New user
        </Button>
      </header>
      <form
        noValidate
        className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3"
        onSubmit={(e) => {
          e.preventDefault()
          apply(form)
        }}
      >
        <FormField id="uf-q" label="User ID, name or email" className="w-64">
          <Input id="uf-q" value={form.q} onChange={(e) => setForm({ ...form, q: e.target.value })} />
        </FormField>
        <FormField id="uf-status" label="Status" className="w-40">
          <NativeSelect id="uf-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Filters['status'] })}>
            <option value="">All</option>
            {USER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {USER_STATUS_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        {isAdmin && (
          <FormField id="uf-merchant" label="Merchant" className="w-48">
            <NativeSelect id="uf-merchant" value={form.merchantId} onChange={(e) => setForm({ ...form, merchantId: e.target.value })}>
              <option value="">All</option>
              {(merchants.data ?? []).map((m) => (
                <option key={m.merchantId} value={m.merchantId}>
                  {m.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        )}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="outline" onClick={() => { const empty = { q: '', status: '', merchantId: '' } as Filters; setForm(empty); apply(empty) }}>
            <RotateCcw aria-hidden /> Reset
          </Button>
          <Button type="submit">
            <Search aria-hidden /> Search
          </Button>
        </div>
      </form>
      <section aria-label="User list" className="overflow-x-auto rounded-lg border bg-card">
        <table className={cn('w-full text-sm', rows.loading && rows.data && 'opacity-60')} aria-busy={rows.loading}>
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              {headers.map((h) => (
                <th key={h} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.userId} className="border-t">
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{r.userId}</td>
                <th scope="row" className="px-3 py-2 text-left font-normal">
                  <button type="button" className="font-medium text-blue-700 hover:underline dark:text-blue-400" onClick={() => setOpen(r.userId)}>
                    {r.fullName}
                  </button>
                </th>
                <td className="px-3 py-2">{r.email}</td>
                {isAdmin && <td className="px-3 py-2 whitespace-nowrap">{r.merchantName}</td>}
                <td className="px-3 py-2">{r.access || <span className="text-muted-foreground">No access</span>}</td>
                <td className="px-3 py-2">
                  <UserStatusBadge status={r.status} />
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{formatMyt(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.data && !filtered.length && <EmptyState title="No Records Found" />}
        <Pagination page={page} pageSize={pageSize} total={filtered.length} pageSizes={PAGE_SIZES} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1) }} />
      </section>
      {inviting && (
        <InviteDialog
          merchants={isAdmin ? (merchants.data ?? []) : []}
          defaultMerchantId={isAdmin ? undefined : account?.merchantId}
          onClose={() => setInviting(false)}
          onSaved={() => {
            setInviting(false)
            rows.reload()
          }}
        />
      )}
      {open && <UserDialog userId={open} onClose={() => setOpen(undefined)} onChanged={rows.reload} />}
    </div>
  )
}

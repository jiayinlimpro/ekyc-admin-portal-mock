// REQ: DEC-74 / DEC-104 / DEC-109 — [FRS] Users: one merchant role per user (Merchant settings › Users); project roles come
// from Members. The same screen lists platform staff (Platform staff).
import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import { Lock, Pencil, Plus, RotateCcw, Search } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/FormField'
import { NativeSelect } from '@/components/common/NativeSelect'
import { Pagination } from '@/components/common/Pagination'
import { EmptyState, ErrorState } from '@/components/common/States'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { USER_STATUSES, type UserStatus } from '@/domain/types'
import { errorMessage, fieldErrors, useLoad } from '@/hooks/useLoad'
import { formatMyt } from '@/lib/format'
import { PERMISSION_LABELS, USER_STATUS_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { merchantService } from '@/services/merchantService'
import { roleService } from '@/services/roleService'
import { userAdminService, type UserDetail, type UserRow } from '@/services/userAdminService'
import { useSession } from '@/stores/sessionStore'
import { DEFAULT_MERCHANT_ROLE_ID } from '@/domain/roles'
import { AccessChip, AccessPreview, ChangeRoleDialog, MERCHANT_ROLE_HINT, RoleSelect, UserStatusBadge, type MerchantOption } from './AccessFields'
import { StaffDialog } from './StaffDialog'
import { staffService } from '@/services/staffService'
import { STAFF_EMAIL_DOMAIN } from '@/domain/openQuestions'

const PAGE_SIZES = [10, 20, 50] as const

type AccountKind = 'PLATFORM' | 'MERCHANT'

/**
 * REQ: DEC-74 / DEC-99 / DEC-104 — New user. Type first (super admins choose; merchant admins see it locked to their
 * merchant), then the generated User ID, then: Platform = name, email, staff role; Merchant = merchant, name, email,
 * merchant role (Member by default, with the help text).
 */
function InviteDialog({ merchants, isSuper, internal, ownMerchant, fixedKind, onClose, onSaved }: { merchants: MerchantOption[]; isSuper: boolean; /** REQ: DEC-104 — super admins and staff pick the merchant. */ internal: boolean; ownMerchant?: MerchantOption; /** REQ: DEC-109 — the page decides: a merchant's users or platform staff. */ fixedKind?: AccountKind; onClose: () => void; onSaved: () => void }) {
  const actor = useSession((s) => s.actor)
  const [kind, setKind] = useState<AccountKind>(fixedKind ?? 'MERCHANT')
  const [merchantId, setMerchantId] = useState(ownMerchant?.merchantId ?? '')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [roleId, setRoleId] = useState<string>(fixedKind === 'PLATFORM' ? '' : DEFAULT_MERCHANT_ROLE_ID)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const platform = kind === 'PLATFORM'
  const roles = useLoad(() => (platform ? staffService.assignableRoles(actor) : merchantId ? roleService.assignable(merchantId, actor) : Promise.resolve([])), [kind, merchantId, actor.userId])
  const role = roles.data?.find((r) => r.roleId === roleId)
  // REQ: DEC-97 — the User ID is generated when the form opens and shown read-only.
  const draft = useLoad(() => userAdminService.draftUserId(actor), [actor.userId])

  const changeKind = (k: AccountKind) => {
    setKind(k)
    setRoleId(k === 'PLATFORM' ? '' : DEFAULT_MERCHANT_ROLE_ID)
    setErrors({})
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!platform && !merchantId) return setErrors({ merchantId: 'Choose a merchant.' })
    if (!roleId) return setErrors({ roleId: platform ? 'Choose a staff role.' : 'Choose a role.' })
    setBusy(true)
    setErrors({})
    try {
      const input = { userId: draft.data, fullName, email, roleId }
      const u = platform ? await staffService.invite(input, actor) : await userAdminService.invite(merchantId, input, actor)
      toast.success(`${u.fullName} invited`, { description: 'Pending until they accept the invitation.' })
      onSaved()
    } catch (err) {
      setErrors(fieldErrors(err))
    } finally {
      setBusy(false)
    }
  }
  const nameField = (
    <FormField id="nu-name" label="Full name" error={errors.fullName}>
      <Input id="nu-name" value={fullName} onChange={(e) => setFullName(e.target.value)} aria-invalid={!!errors.fullName} />
    </FormField>
  )
  const emailField = (
    <FormField id="nu-email" label="Work email" error={errors.email} hint={platform ? `A company email (@${STAFF_EMAIL_DOMAIN}).` : `Company staff emails (@${STAFF_EMAIL_DOMAIN}) can’t be used.`}>
      <Input id="nu-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors.email} />
    </FormField>
  )
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>New user</DialogTitle>
            <DialogDescription>The user is Pending until they accept the emailed invitation.</DialogDescription>
          </DialogHeader>
          <FormField id="nu-type" label="Type" hint="Can’t be changed after creation.">
            {fixedKind === 'PLATFORM' ? (
              <Input id="nu-type" value="Platform (internal)" readOnly disabled />
            ) : isSuper && !fixedKind ? (
              <NativeSelect id="nu-type" value={kind} onChange={(e) => changeKind(e.target.value as AccountKind)}>
                <option value="PLATFORM">Platform (internal)</option>
                <option value="MERCHANT">Merchant</option>
              </NativeSelect>
            ) : (
              <Input id="nu-type" value={internal ? 'Merchant' : `Merchant · ${ownMerchant?.name ?? ''}`} readOnly disabled />
            )}
          </FormField>
          <FormField id="nu-id" label="User ID" hint="Generated; it can’t be changed.">
            <Input id="nu-id" value={draft.data ?? ''} placeholder={draft.loading ? 'Generating…' : ''} readOnly disabled className="font-mono text-xs" />
          </FormField>
          {platform ? (
            <>
              {nameField}
              {emailField}
              <RoleSelect id="nu-role" label="Staff role" roles={roles.data ?? []} value={roleId} onChange={setRoleId} error={errors.roleId} hint="Applies to every merchant." />
            </>
          ) : (
            <>
              <FormField id="nu-merchant" label="Merchant" error={errors.merchantId} hint={internal ? 'Changing it resets the role.' : undefined}>
                {internal ? (
                  <NativeSelect id="nu-merchant" value={merchantId} onChange={(e) => { setMerchantId(e.target.value); setRoleId(DEFAULT_MERCHANT_ROLE_ID) }}>
                    <option value="">Choose a merchant</option>
                    {merchants.map((m) => (
                      <option key={m.merchantId} value={m.merchantId}>
                        {m.name}
                      </option>
                    ))}
                  </NativeSelect>
                ) : (
                  <Input id="nu-merchant" value={ownMerchant?.name ?? ''} readOnly disabled />
                )}
              </FormField>
              {nameField}
              {emailField}
              {merchantId && (
                <>
                  <RoleSelect id="nu-role" label="Merchant role" roles={roles.data ?? []} value={roleId} onChange={setRoleId} error={errors.roleId} hint={MERCHANT_ROLE_HINT} />
                  {role && <AccessPreview who={fullName.trim() || 'The user'} permissions={role.permissions} where="every project (including new ones)" />}
                </>
              )}
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
            <Button type="submit" disabled={busy || !draft.data}>
              {busy ? 'Inviting…' : 'Invite user'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** REQ: DEC-74 — "Why can Ali approve this case?": the permissions in one project and the roles they come from. */
function EffectiveAccess({ user }: { user: UserDetail }) {
  const [projectId, setProjectId] = useState(user.effective.find((e) => e.permissions.length)?.projectId ?? user.effective[0]?.projectId ?? '')
  const shown = user.effective.find((e) => e.projectId === projectId)
  return (
    <section aria-label="Effective access">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <h3 className="text-sm font-semibold">Effective access</h3>
        <FormField id="ea-project" label="Project" className="w-56">
          <NativeSelect id="ea-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {user.effective.map((e) => (
              <option key={e.projectId} value={e.projectId}>
                {e.projectName}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Permission</th>
              <th scope="col" className="px-3 py-2 font-medium">Comes from</th>
            </tr>
          </thead>
          <tbody>
            {shown?.permissions.map((p) => (
              <tr key={p.permission} className="border-t">
                <th scope="row" className="px-3 py-2 text-left font-normal">{PERMISSION_LABELS[p.permission]}</th>
                <td className="px-3 py-2">
                  <span className="flex flex-wrap gap-1">
                    {p.from.map((f) => (
                      <AccessChip key={f} label={f} />
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown?.permissions.length && <p className="px-3 py-4 text-sm text-muted-foreground">No access in this project.</p>}
      </div>
    </section>
  )
}

function UserDialog({ userId, onClose, onChanged }: { userId: string; onClose: () => void; onChanged: () => void }) {
  const actor = useSession((s) => s.actor)
  const user = useLoad(() => userAdminService.get(userId, actor), [userId, actor.userId])
  const u = user.data
  const roles = useLoad(() => (u?.can.changeRole ? roleService.assignable(u.merchantId, actor) : Promise.resolve([])), [u?.merchantId, u?.can.changeRole, actor.userId])
  const [changing, setChanging] = useState(false)

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
    await userAdminService.setRole(u.userId, roleId, actor)
    toast.success('Role changed')
    user.reload()
    onChanged()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{u ? u.fullName : 'User'}</DialogTitle>
          <DialogDescription>{u ? `${u.email} · ${u.merchantName}` : 'Loading…'}</DialogDescription>
        </DialogHeader>
        {user.error && !u && <ErrorState message={user.error} onRetry={user.reload} />}
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
            {/* REQ: DEC-104 — the merchant role (whole merchant), changed here; project roles come from Project › Members. */}
            <section aria-label="Merchant role" className="rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground">Merchant role</h3>
                  <p className="text-sm font-medium">{u.merchantRole?.roleName ?? '—'}</p>
                  <p className="text-xs text-muted-foreground">Applies to the whole merchant and all its projects.</p>
                </div>
                {u.can.changeRole && (
                  <span title={u.changeRoleBlocked} className="inline-flex">
                    <Button size="sm" variant="outline" disabled={!!u.changeRoleBlocked} aria-description={u.changeRoleBlocked} onClick={() => setChanging(true)}>
                      <Pencil aria-hidden /> Change role
                    </Button>
                  </span>
                )}
              </div>
              {u.isSelf && <p className="mt-2 text-xs text-muted-foreground">You can’t change your own access.</p>}
            </section>
            <section aria-label="Project access">
              <h3 className="mb-2 text-sm font-semibold">Project access</h3>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      {['Project', 'Role', 'Added by', 'Date'].map((h) => (
                        <th key={h} scope="col" className="px-3 py-2 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {u.projectRoles.map((a) => (
                      <tr key={`${a.assignmentId}|${a.projectId}`} className="border-t">
                        <th scope="row" className="px-3 py-2 text-left font-medium">{a.projectName}</th>
                        <td className="px-3 py-2">{a.roleName}</td>
                        <td className="px-3 py-2">{a.addedBy.fullName}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{formatMyt(a.addedAt).split(', ')[0]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!u.projectRoles.length && <p className="px-3 py-4 text-sm text-muted-foreground">No project roles. Add the user in a project’s Members.</p>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Managed in each project’s Members.</p>
            </section>
            <EffectiveAccess key={u.userId} user={u} />
          </div>
        )}
        <DialogFooter>
          {u?.can.resendInvitation && u.status === 'PENDING' && (
            <Button variant="outline" onClick={() => void act(() => userAdminService.resendInvitation(u.userId, actor), `Invitation resent to ${u.email}`)}>
              Resend invitation
            </Button>
          )}
          {u?.can.suspend && u.status !== 'SUSPENDED' && (
            <span title={u.suspendBlocked} className="inline-flex">
              <Button variant="destructive" disabled={!!u.suspendBlocked} aria-description={u.suspendBlocked} onClick={() => window.confirm(`Suspend ${u.fullName}? They can’t sign in and their open claims are released.`) && void act(() => userAdminService.suspend(u.userId, actor), `${u.fullName} suspended`)}>
                Suspend
              </Button>
            </span>
          )}
          {u?.can.suspend && u.status === 'SUSPENDED' && (
            <Button variant="outline" onClick={() => void act(() => userAdminService.reactivate(u.userId, actor), `${u.fullName} reactivated`)}>
              Reactivate
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
        {changing && u && <ChangeRoleDialog who={u.fullName} roles={roles.data ?? []} initialRoleId={u.merchantRole?.roleId} onSave={saveRole} onClose={() => setChanging(false)} />}
      </DialogContent>
    </Dialog>
  )
}

type Filters = { q: string; status: '' | UserStatus; merchantId: string; type: '' | AccountKind }
/** A row on the Users list: a merchant user, or (super admins only) a platform staff member (DEC-99). */
type ListRow = UserRow & { type: AccountKind; /** REQ: DEC-110 — the super admin: shown, never opened or changed. */ fixed?: true }

const matches = (r: ListRow, f: Filters) => {
  const q = f.q.trim().toLowerCase()
  return (!q || [r.fullName, r.email].some((x) => x.toLowerCase().includes(q))) && (!f.status || r.status === f.status) && (!f.merchantId || r.merchantId === f.merchantId) && (!f.type || r.type === f.type)
}

/** REQ: DEC-109 — where the list lives: one merchant's users (Merchant settings › Users) or platform staff (Platform staff). */
export type UsersScope = { merchantId: string } | 'PLATFORM'

export function UsersPage({ scope }: { scope: UsersScope }) {
  const actor = useSession((s) => s.actor)
  const platform = scope === 'PLATFORM'
  const merchantId = platform ? undefined : scope.merchantId
  const [sp, setSp] = useSearchParams()
  const applied: Filters = { q: sp.get('q') ?? '', status: (sp.get('status') ?? '') as Filters['status'], merchantId: '', type: '' }
  const [form, setForm] = useState<Filters>(applied)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0])
  const [inviting, setInviting] = useState(false)
  // ?user=<id> opens a merchant user's details (linked from the Members tab, DEC-77).
  const [open, setOpen] = useState<{ userId: string; type: AccountKind } | undefined>(sp.get('user') ? { userId: sp.get('user')!, type: platform ? 'PLATFORM' : 'MERCHANT' } : undefined)
  // REQ: DEC-99 / DEC-109 — a merchant's users, or (super admins) the platform staff; never both on one list.
  const rows = useLoad(async (): Promise<ListRow[]> => {
    if (platform) return (await staffService.list(actor)).map(({ access, ...r }): ListRow => ({ ...r, merchantRoleName: access[0]?.label ?? '', merchantId: '', merchantName: '—', type: 'PLATFORM', fixed: r.fixed }))
    return (await userAdminService.list(actor, merchantId)).map((r): ListRow => ({ ...r, type: 'MERCHANT' }))
  }, [actor.userId, platform, merchantId])
  const merchants = useLoad(() => merchantService.list(actor), [actor.userId])
  const ownMerchant = merchantId ? { merchantId, name: (merchants.data ?? []).find((m) => m.merchantId === merchantId)?.name ?? '' } : undefined

  const apply = (f: Filters) => {
    const { q, status } = f
    setSp((p) => {
      for (const [k, v] of Object.entries({ q, status })) {
        if (v) p.set(k, v)
        else p.delete(k)
      }
      return p
    }, { replace: true })
    setPage(1)
  }
  const filtered = (rows.data ?? []).filter((r) => matches(r, applied))
  const shown = filtered.slice((page - 1) * pageSize, page * pageSize)
  // REQ: DEC-74 (2026-10-27) — the role only: a merchant role covers every project; project roles are in the details.
  const headers = ['Full Name', 'Email', platform ? 'Platform role' : 'Merchant role', 'Status', 'Created At']

  if (rows.error && !rows.data) return <ErrorState message={rows.error} onRetry={rows.reload} />
  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{platform ? 'Platform staff' : 'Users'}</h1>
          <p className="text-sm text-muted-foreground">
            {platform ? 'Each staff member has one platform role; it applies to every merchant. The super admin is created at setup and can’t be changed.' : 'Each user has one merchant role (all projects); project roles are added in Project › Members.'}
          </p>
        </div>
        <Button onClick={() => setInviting(true)}>
          <Plus aria-hidden /> {platform ? 'New staff member' : 'New user'}
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
        <FormField id="uf-q" label="Name or email" className="w-64">
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
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="outline" onClick={() => { const empty: Filters = { q: '', status: '', merchantId: '', type: '' }; setForm(empty); apply(empty) }}>
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
                <th scope="row" className="px-3 py-2 text-left font-normal">
                  {r.fixed ? (
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.fullName}</span>
                      <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                        <Lock aria-hidden className="size-3" /> Created at setup · can’t be changed
                      </Badge>
                    </span>
                  ) : (
                    <button type="button" className="font-medium text-blue-700 hover:underline dark:text-blue-400" onClick={() => setOpen({ userId: r.userId, type: r.type })}>
                      {r.fullName}
                    </button>
                  )}
                </th>
                <td className="px-3 py-2">{r.email}</td>
                <td className="px-3 py-2">{r.merchantRoleName || <span className="text-muted-foreground">No role</span>}</td>
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
          merchants={merchants.data ?? []}
          isSuper={false}
          internal={false}
          fixedKind={platform ? 'PLATFORM' : 'MERCHANT'}
          ownMerchant={ownMerchant}
          onClose={() => setInviting(false)}
          onSaved={() => {
            setInviting(false)
            rows.reload()
          }}
        />
      )}
      {open?.type === 'PLATFORM' && <StaffDialog userId={open.userId} onClose={() => setOpen(undefined)} onChanged={rows.reload} />}
      {open?.type === 'MERCHANT' && <UserDialog userId={open.userId} onClose={() => setOpen(undefined)} onChanged={rows.reload} />}
    </div>
  )
}

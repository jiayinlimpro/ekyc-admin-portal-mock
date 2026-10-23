// REQ: DEC-76 / DEC-102 — [FRS] User Management › Roles: the permission matrix; System Default roles locked.
import { useState, type FormEvent } from 'react'
import { MoreVertical, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useAccess } from '@/app/access'
import { FormField } from '@/components/common/FormField'
import { NativeSelect } from '@/components/common/NativeSelect'
import { OpenQuestionTag } from '@/components/common/OpenQuestionTag'
import { ErrorState } from '@/components/common/States'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ROLE_IN_USE } from '@/domain/roles'
import type { Permission, RoleAudience, RoleStatus } from '@/domain/types'
import { errorMessage, fieldErrors, useLoad } from '@/hooks/useLoad'
import { formatMyt } from '@/lib/format'
import { cn } from '@/lib/utils'
import { merchantService } from '@/services/merchantService'
import { roleService, type RoleRow } from '@/services/roleService'
import { useSession } from '@/stores/sessionStore'
import { PermissionMatrix } from './PermissionMatrix'

type Editing = { mode: 'create'; from?: RoleRow } | { mode: 'edit'; row: RoleRow }

/** REQ: DEC-76 / DEC-78 — why a role can't be deactivated now; shown on the disabled control. */
function deactivateBlocked(row: Pick<RoleRow, 'type' | 'users' | 'status'>): string | undefined {
  if (row.type === 'SYSTEM_DEFAULT') return 'System Default roles are shared and can’t be deactivated.'
  if (row.status === 'ACTIVE' && row.users > 0) return ROLE_IN_USE
  return undefined
}

function RoleDialog({
  editing,
  merchants,
  defaultMerchantId,
  isSuper,
  ownMerchantName,
  onClose,
  onSaved,
  onDuplicate,
  can,
}: {
  editing: Editing
  /** REQ: DEC-102 — Create (and Duplicate), Edit and Activate / deactivate are separate permissions. */
  can: { create: boolean; edit: boolean; changeStatus: boolean }
  merchants: { merchantId: string; name: string }[]
  defaultMerchantId?: string
  /** REQ: DEC-99 — only super admins choose the Type; merchant admins see it locked to their merchant. */
  isSuper: boolean
  ownMerchantName?: string
  onClose: () => void
  onSaved: () => void
  onDuplicate: (row: RoleRow) => void
}) {
  const actor = useSession((s) => s.actor)
  const row = editing.mode === 'edit' ? editing.row : undefined
  const systemDefault = row?.type === 'SYSTEM_DEFAULT'
  const locked = systemDefault || (!!row && !can.edit) // name and permissions read-only
  // REQ: DEC-76 — Duplicate starts a new Custom role from a copy of another (System Default included).
  const from = editing.mode === 'create' ? editing.from : undefined
  const [merchantId, setMerchantId] = useState(row?.merchantId ?? from?.merchantId ?? defaultMerchantId ?? '')
  const [name, setName] = useState(row?.name ?? (from ? `Copy of ${from.name}` : ''))
  const [permissions, setPermissions] = useState<Permission[]>(row?.permissions ?? from?.permissions ?? [])
  const [audience, setAudience] = useState<RoleAudience>(row?.audience ?? from?.audience ?? 'MERCHANT')
  const platform = audience === 'PLATFORM'
  const [status, setStatus] = useState<RoleStatus>(row?.status ?? 'ACTIVE')
  // REQ: DEC-76 — the Role ID is generated when the dialog opens and shown read-only.
  const draft = useLoad(() => (row ? Promise.resolve(row.roleId) : roleService.draftRoleId(actor)), [row?.roleId, actor.userId])
  const blocked = row ? deactivateBlocked(row) : undefined
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    setErrors({})
    try {
      await fn()
      toast.success(ok)
      onSaved()
    } catch (err) {
      setErrors(fieldErrors(err))
    } finally {
      setBusy(false)
    }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (row) {
      return void run(async () => {
        if (!locked) await roleService.update(row.roleId, { name, permissions }, actor)
        if (status !== row.status) await roleService.setStatus(row.roleId, status, actor)
      }, `${name.trim()} saved`)
    }
    if (!platform && !merchantId) return setErrors({ merchantId: 'Choose a merchant.' })
    void run(() => roleService.create(platform ? undefined : merchantId, { roleId: draft.data, name, permissions, status, audience }, actor), `${name.trim()} created`)
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>{row ? row.name : from ? `New role from ${from.name}` : 'New role'}</DialogTitle>
            <DialogDescription>
              {systemDefault
                ? 'System Default roles are shared and can’t be changed.'
                : locked
                  ? 'Read-only: you can view this role but not edit it.'
                : platform
                  ? 'A role for internal staff: it applies to every merchant (staff have one role, no scope).'
                  : 'Given on Users, the role applies to the whole merchant; given in Project › Members, to that project only.'}
            </DialogDescription>
          </DialogHeader>
          {/* REQ: DEC-99 — Type first: chosen by super admins on create; locked afterwards and for merchant admins. */}
          <FormField id="r-type" label="Type" hint={row ? 'Can’t be changed after creation.' : undefined}>
            {isSuper && !row ? (
              <NativeSelect id="r-type" value={audience} onChange={(e) => { setAudience(e.target.value as RoleAudience); setPermissions([]) }}>
                <option value="PLATFORM">Platform (internal)</option>
                <option value="MERCHANT">Merchant</option>
              </NativeSelect>
            ) : (
              <Input
                id="r-type"
                value={platform ? 'Platform (internal)' : `Merchant · ${row ? (row.merchantName ?? 'All merchants (System Default)') : (merchants.find((m) => m.merchantId === merchantId)?.name ?? ownMerchantName ?? '')}`}
                readOnly
                disabled
              />
            )}
          </FormField>
          <FormField id="r-id" label="Role ID" hint={row ? undefined : 'Generated; it can’t be changed.'}>
            <Input id="r-id" value={draft.data ?? ''} placeholder={draft.loading ? 'Generating…' : ''} readOnly disabled className="font-mono text-xs" />
          </FormField>
          {!row && !platform && merchants.length > 1 && (
            <FormField id="r-merchant" label="Merchant" error={errors.merchantId}>
              <NativeSelect id="r-merchant" value={merchantId} onChange={(e) => setMerchantId(e.target.value)}>
                <option value="">Choose a merchant</option>
                {merchants.map((m) => (
                  <option key={m.merchantId} value={m.merchantId}>
                    {m.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          )}
          <FormField id="r-name" label="Role name" error={errors.name}>
            <Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} readOnly={locked} aria-invalid={!!errors.name} autoFocus={!locked} />
          </FormField>
          <div className="space-y-3" aria-describedby={errors.permissions ? 'r-perm-error' : undefined}>
            <PermissionMatrix audience={audience} value={permissions} onChange={setPermissions} disabled={locked || busy} />
            {errors.permissions && (
              <p id="r-perm-error" role="alert" className="text-xs text-destructive">
                {errors.permissions}
              </p>
            )}
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              Permission list and System Default roles not confirmed yet <OpenQuestionTag id="OQ-09" />
            </p>
          </div>
          {/* REQ: DEC-76 — Status; deactivating is blocked for System Default roles and for roles still assigned (DEC-78). */}
          <fieldset aria-describedby="r-status-hint" disabled={!!row && !can.changeStatus}>
            <legend className="mb-1 text-xs font-medium text-muted-foreground">Status</legend>
            <div className="flex gap-4">
              {(['ACTIVE', 'INACTIVE'] as const).map((s) => (
                <label key={s} className={cn('flex items-center gap-2 text-sm', s === 'INACTIVE' && !!blocked && status === 'ACTIVE' && 'text-muted-foreground')}>
                  <input type="radio" name="r-status" checked={status === s} disabled={busy || (s === 'INACTIVE' && !!blocked && status === 'ACTIVE')} onChange={() => setStatus(s)} />
                  {s === 'ACTIVE' ? 'Active' : 'Inactive'}
                </label>
              ))}
            </div>
            <p id="r-status-hint" className="mt-1 text-xs text-muted-foreground">
              {blocked && status === 'ACTIVE' ? blocked : 'An inactive role grants nothing and can’t be given to users.'}
            </p>
          </fieldset>
          {row && !locked && row.users > 0 && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" role="status">
              Affects {row.users} user{row.users === 1 ? '' : 's'} in {row.projects} project{row.projects === 1 ? '' : 's'}: changes apply at once wherever they hold this role.
            </p>
          )}
          {errors.form && (
            <p role="alert" className="text-sm text-destructive">
              {errors.form}
            </p>
          )}
          {errors.status && (
            <p role="alert" className="text-sm text-destructive">
              {errors.status}
            </p>
          )}
          <DialogFooter>
            {row && can.create && (
              <Button type="button" variant="outline" disabled={busy} onClick={() => onDuplicate(row)}>
                Duplicate
              </Button>
            )}
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {locked ? 'Close' : 'Cancel'}
            </Button>
            {(!locked || status !== row?.status) && (
              <Button type="submit" disabled={busy || (!row && !draft.data)}>
                {busy ? 'Saving…' : row ? 'Save' : 'Create role'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function RolesPage() {
  const actor = useSession((s) => s.actor)
  const { account, allows } = useAccess()
  const isAdmin = account?.level === 'SUPER_ADMIN'
  // REQ: DEC-102 / DEC-78 — hide what the user's permissions never allow.
  const can = { create: allows({ project: 'createRoles' }), edit: allows({ project: 'editRoles' }), changeStatus: allows({ project: 'changeRoleStatus' }) }
  const rows = useLoad(() => roleService.list(actor), [actor.userId])
  const merchants = useLoad(() => merchantService.list(actor), [actor.userId])
  const [editing, setEditing] = useState<Editing>()
  const headers = ['Role Name', ...(isAdmin ? ['Type', 'Merchant'] : []), 'Role Type', 'Status', 'Users', 'Created At', 'Actions']
  const toggle = async (r: RoleRow) => {
    const to = r.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
    if (to === 'INACTIVE' && !window.confirm(`Deactivate ${r.name}? It can no longer be given to users.`)) return
    try {
      await roleService.setStatus(r.roleId, to, actor)
      toast.success(`${r.name} ${to === 'ACTIVE' ? 'activated' : 'deactivated'}`)
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
          <h1 className="text-2xl font-semibold">Roles</h1>
          <p className="text-sm text-muted-foreground">What users may do. Given on Users, a role applies to the whole merchant; given in Project › Members, to that project only.</p>
        </div>
        {can.create && (
          <Button onClick={() => setEditing({ mode: 'create' })}>
            <Plus aria-hidden /> New role
          </Button>
        )}
      </header>
      <section aria-label="Role list" className="overflow-x-auto rounded-lg border bg-card">
        <table className={cn('w-full text-sm', rows.loading && rows.data && 'opacity-60')} aria-busy={rows.loading}>
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              {headers.map((h) => (
                <th key={h} scope="col" className={cn('px-3 py-2 font-medium whitespace-nowrap', h === 'Users' && 'text-right')}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(rows.data ?? []).map((r) => (
              <tr key={r.roleId} className="border-t">
                <th scope="row" className="px-3 py-2 text-left font-normal">
                  <button type="button" className="font-medium text-blue-700 hover:underline dark:text-blue-400" onClick={() => setEditing({ mode: 'edit', row: r })}>
                    {r.name}
                  </button>
                </th>
                {isAdmin && <td className="px-3 py-2 whitespace-nowrap">{r.audience === 'PLATFORM' ? 'Platform (internal)' : 'Merchant'}</td>}
                {isAdmin && <td className="px-3 py-2 whitespace-nowrap">{r.audience === 'PLATFORM' ? '—' : (r.merchantName ?? 'All merchants')}</td>}
                <td className="px-3 py-2 whitespace-nowrap">{r.type === 'SYSTEM_DEFAULT' ? 'System Default' : 'Custom'}</td>
                <td className="px-3 py-2">{r.status === 'ACTIVE' ? 'Active' : 'Inactive'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.users}</td>
                <td className="px-3 py-2 whitespace-nowrap">{formatMyt(r.createdAt)}</td>
                <td className="px-3 py-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${r.name}`}>
                          <MoreVertical aria-hidden />
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end" className="w-64">
                      <DropdownMenuItem onClick={() => setEditing({ mode: 'edit', row: r })}>{r.type === 'SYSTEM_DEFAULT' || !can.edit ? 'View' : 'Edit'}</DropdownMenuItem>
                      {can.create && <DropdownMenuItem onClick={() => setEditing({ mode: 'create', from: r })}>Duplicate</DropdownMenuItem>}
                      {!can.changeStatus ? null : r.status === 'INACTIVE' ? (
                        <DropdownMenuItem onClick={() => void toggle(r)}>Activate</DropdownMenuItem>
                      ) : (
                        // REQ: DEC-78 — blocked by state: shown disabled with the reason.
                        <DropdownMenuItem disabled={!!deactivateBlocked(r)} onClick={() => void toggle(r)}>
                          <span className="flex flex-col">
                            Deactivate
                            {deactivateBlocked(r) && <span className="text-xs text-muted-foreground">{deactivateBlocked(r)}</span>}
                          </span>
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {editing && (
        <RoleDialog
          key={editing.mode === 'edit' ? editing.row.roleId : `new-${editing.from?.roleId ?? ''}`}
          editing={editing}
          onDuplicate={(from) => setEditing({ mode: 'create', from })}
          can={can}
          merchants={isAdmin ? (merchants.data ?? []) : []}
          defaultMerchantId={isAdmin ? undefined : account?.merchantId}
          isSuper={isAdmin}
          ownMerchantName={(merchants.data ?? []).find((m) => m.merchantId === account?.merchantId)?.name}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined)
            rows.reload()
          }}
        />
      )}
    </div>
  )
}

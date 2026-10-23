// REQ: DEC-76 / DEC-102 / DEC-104 — the role table and role dialog shared by the two role tables: merchant roles (Roles
// screen) and project roles (Project Settings › Roles of one project). System Default roles are locked; Duplicate copies.
import { useState, type FormEvent } from 'react'
import { MoreVertical } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/FormField'
import { NativeSelect } from '@/components/common/NativeSelect'
import { OpenQuestionTag } from '@/components/common/OpenQuestionTag'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ROLE_IN_USE } from '@/domain/roles'
import type { Permission, RoleAudience, RoleStatus } from '@/domain/types'
import { fieldErrors, useLoad } from '@/hooks/useLoad'
import { formatMyt } from '@/lib/format'
import { cn } from '@/lib/utils'
import { roleService, type RoleRow } from '@/services/roleService'
import { useSession } from '@/stores/sessionStore'
import { PermissionMatrix } from './PermissionMatrix'

export type Editing = { mode: 'create'; from?: RoleRow } | { mode: 'edit'; row: RoleRow }
/** REQ: DEC-102 — Create (and Duplicate), Edit and Activate / deactivate are separate permissions. */
export type RoleCan = { create: boolean; edit: boolean; changeStatus: boolean }
/** REQ: DEC-104 — a project role table belongs to one project. */
export type RoleProject = { projectId: string; name: string; merchantId: string }

/** REQ: DEC-76 / DEC-78 — why a role can't be deactivated now; shown on the disabled control. */
const deactivateBlocked = (row: Pick<RoleRow, 'type' | 'users' | 'status'>): string | undefined =>
  row.type === 'SYSTEM_DEFAULT' ? 'System Default roles are shared and can’t be deactivated.' : row.status === 'ACTIVE' && row.users > 0 ? ROLE_IN_USE : undefined

export function RoleDialog({
  editing,
  can,
  project,
  merchants = [],
  defaultMerchantId,
  isSuper = false,
  ownMerchantName,
  onClose,
  onSaved,
  onDuplicate,
}: {
  editing: Editing
  can: RoleCan
  /** A project role of this project; otherwise a merchant role (or, for super admins, a platform role). */
  project?: RoleProject
  merchants?: { merchantId: string; name: string }[]
  defaultMerchantId?: string
  /** REQ: DEC-99 — only super admins choose the Type; merchant admins see it locked to their merchant. */
  isSuper?: boolean
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
  const [merchantId, setMerchantId] = useState(project?.merchantId ?? row?.merchantId ?? from?.merchantId ?? defaultMerchantId ?? '')
  const [name, setName] = useState(row?.name ?? (from ? `Copy of ${from.name}` : ''))
  const [permissions, setPermissions] = useState<Permission[]>(row?.permissions ?? from?.permissions ?? [])
  const [audience, setAudience] = useState<RoleAudience>(project ? 'MERCHANT' : (row?.audience ?? from?.audience ?? 'MERCHANT'))
  const platform = audience === 'PLATFORM'
  const level = project ? 'PROJECT' : 'MERCHANT'
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
    void run(() => roleService.create(platform ? undefined : merchantId, { roleId: draft.data, name, permissions, status, audience, projectId: project?.projectId }, actor), `${name.trim()} created`)
  }
  const typeText = project
    ? `Project role · ${project.name}`
    : platform
      ? 'Platform (internal)'
      : `Merchant role · ${row ? (row.merchantName ?? 'All merchants (System Default)') : (merchants.find((m) => m.merchantId === merchantId)?.name ?? ownMerchantName ?? '')}`
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>{row ? row.name : from ? `New role from ${from.name}` : project ? 'New project role' : 'New role'}</DialogTitle>
            <DialogDescription>
              {systemDefault
                ? 'System Default roles are shared and can’t be changed.'
                : locked
                  ? 'Read-only: you can view this role but not edit it.'
                  : project
                    ? `A project role is given in Members and applies in ${project.name} only.`
                    : platform
                      ? 'A role for internal staff: it applies to every merchant (staff have one role, no scope).'
                      : 'A merchant role is given on Users and applies to the whole merchant and all its projects.'}
            </DialogDescription>
          </DialogHeader>
          {/* REQ: DEC-99 — Type first: chosen by super admins on create; locked afterwards, for merchant admins and for project roles. */}
          <FormField id="r-type" label="Type" hint={row ? 'Can’t be changed after creation.' : undefined}>
            {isSuper && !row && !project ? (
              <NativeSelect id="r-type" value={audience} onChange={(e) => { setAudience(e.target.value as RoleAudience); setPermissions([]) }}>
                <option value="PLATFORM">Platform (internal)</option>
                <option value="MERCHANT">Merchant role</option>
              </NativeSelect>
            ) : (
              <Input id="r-type" value={typeText} readOnly disabled />
            )}
          </FormField>
          <FormField id="r-id" label="Role ID" hint={row ? undefined : 'Generated; it can’t be changed.'}>
            <Input id="r-id" value={draft.data ?? ''} placeholder={draft.loading ? 'Generating…' : ''} readOnly disabled className="font-mono text-xs" />
          </FormField>
          {!row && !platform && !project && merchants.length > 1 && (
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
            <PermissionMatrix audience={audience} level={level} value={permissions} onChange={setPermissions} disabled={locked || busy} />
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
              Affects {row.users} user{row.users === 1 ? '' : 's'}
              {project ? '' : ` in ${row.projects} project${row.projects === 1 ? '' : 's'}`}: changes apply at once wherever they hold this role.
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

/** One role table: name, (super admin: Type and Merchant), Role Type, Status, Users, Created At and an Actions menu. */
export function RoleTable({
  label,
  rows,
  loading,
  can,
  showTypeAndMerchant = false,
  onOpen,
  onDuplicate,
  onToggle,
}: {
  label: string
  rows: RoleRow[]
  loading: boolean
  can: RoleCan
  showTypeAndMerchant?: boolean
  onOpen: (row: RoleRow) => void
  onDuplicate: (row: RoleRow) => void
  onToggle: (row: RoleRow) => void
}) {
  const headers = ['Role Name', ...(showTypeAndMerchant ? ['Type', 'Merchant'] : []), 'Role Type', 'Status', 'Users', 'Created At', 'Actions']
  return (
    <section aria-label={label} className="overflow-x-auto rounded-lg border bg-card">
      <table className={cn('w-full text-sm', loading && rows.length > 0 && 'opacity-60')} aria-busy={loading}>
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
          {rows.map((r) => (
            <tr key={r.roleId} className="border-t">
              <th scope="row" className="px-3 py-2 text-left font-normal">
                <button type="button" className="font-medium text-blue-700 hover:underline dark:text-blue-400" onClick={() => onOpen(r)}>
                  {r.name}
                </button>
              </th>
              {showTypeAndMerchant && <td className="px-3 py-2 whitespace-nowrap">{r.audience === 'PLATFORM' ? 'Platform (internal)' : 'Merchant role'}</td>}
              {showTypeAndMerchant && <td className="px-3 py-2 whitespace-nowrap">{r.audience === 'PLATFORM' ? '—' : (r.merchantName ?? 'All merchants')}</td>}
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
                    <DropdownMenuItem onClick={() => onOpen(r)}>{r.type === 'SYSTEM_DEFAULT' || !can.edit ? 'View' : 'Edit'}</DropdownMenuItem>
                    {can.create && <DropdownMenuItem onClick={() => onDuplicate(r)}>Duplicate</DropdownMenuItem>}
                    {!can.changeStatus ? null : r.status === 'INACTIVE' ? (
                      <DropdownMenuItem onClick={() => onToggle(r)}>Activate</DropdownMenuItem>
                    ) : (
                      // REQ: DEC-78 — blocked by state: shown disabled with the reason.
                      <DropdownMenuItem disabled={!!deactivateBlocked(r)} onClick={() => onToggle(r)}>
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
  )
}

// REQ: DEC-76 — [FRS] User Management › Roles: grouped permission checkboxes; System Default roles locked.
import { useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useAccess } from '@/app/access'
import { FormField } from '@/components/common/FormField'
import { NativeSelect } from '@/components/common/NativeSelect'
import { OpenQuestionTag } from '@/components/common/OpenQuestionTag'
import { ErrorState } from '@/components/common/States'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { withImpliedPermissions } from '@/domain/roles'
import { MERCHANT_PERMISSIONS, PROJECT_PERMISSIONS, type Permission } from '@/domain/types'
import { useLoad } from '@/hooks/useLoad'
import { formatMyt } from '@/lib/format'
import { PERMISSION_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { merchantService } from '@/services/merchantService'
import { roleService, type RoleRow } from '@/services/roleService'
import { useSession } from '@/stores/sessionStore'
import { fieldErrors } from '../users/AccessFields'

const NEEDS_VIEW: Permission[] = ['CLAIM_CASES', 'DECIDE_CASES']

function PermissionGroup({ title, hint, permissions, value, onChange, disabled }: { title: string; hint: string; permissions: readonly Permission[]; value: Permission[]; onChange: (v: Permission[]) => void; disabled: boolean }) {
  const toggle = (p: Permission, on: boolean) => onChange(on ? withImpliedPermissions([...value, p]) : value.filter((x) => x !== p))
  // REQ: DEC-70 — View cases stays ticked while Claim or Approve / reject is ticked.
  const locked = (p: Permission) => p === 'VIEW_CASES' && value.some((x) => NEEDS_VIEW.includes(x))
  return (
    <fieldset className="rounded-md border p-3" disabled={disabled}>
      <legend className="px-1 text-sm font-medium">{title}</legend>
      <p className="mb-2 text-xs text-muted-foreground">{hint}</p>
      <div className="grid gap-1 sm:grid-cols-2">
        {permissions.map((p) => (
          <label key={p} className={cn('flex items-center gap-2 text-sm', locked(p) && 'text-muted-foreground')}>
            <input type="checkbox" checked={value.includes(p)} disabled={locked(p)} onChange={(e) => toggle(p, e.target.checked)} />
            {PERMISSION_LABELS[p]}
            {locked(p) && <span className="text-xs">(needed to claim or decide)</span>}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

type Editing = { mode: 'create' } | { mode: 'edit'; row: RoleRow }

function RoleDialog({ editing, merchants, defaultMerchantId, onClose, onSaved }: { editing: Editing; merchants: { merchantId: string; name: string }[]; defaultMerchantId?: string; onClose: () => void; onSaved: () => void }) {
  const actor = useSession((s) => s.actor)
  const row = editing.mode === 'edit' ? editing.row : undefined
  const locked = row?.type === 'SYSTEM_DEFAULT'
  const [merchantId, setMerchantId] = useState(row?.merchantId ?? defaultMerchantId ?? '')
  const [name, setName] = useState(row?.name ?? '')
  const [permissions, setPermissions] = useState<Permission[]>(row?.permissions ?? [])
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
    if (row) return void run(() => roleService.update(row.roleId, { name, permissions }, actor), `${name.trim()} saved`)
    if (!merchantId) return setErrors({ merchantId: 'Choose a merchant.' })
    void run(() => roleService.create(merchantId, { name, permissions }, actor), `${name.trim()} created`)
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>{row ? row.name : 'New role'}</DialogTitle>
            <DialogDescription>
              {locked
                ? 'System Default roles are the same for every merchant and can’t be changed.'
                : 'A role says what a user may do; where it applies is chosen when it is given to a user.'}
            </DialogDescription>
          </DialogHeader>
          {!row && merchants.length > 1 && (
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
            <PermissionGroup title="Merchant-level" hint="A role with any of these can only be given for All projects." permissions={MERCHANT_PERMISSIONS} value={permissions} onChange={setPermissions} disabled={locked || busy} />
            <PermissionGroup title="Project-level" hint="Apply in the projects the role is given for." permissions={PROJECT_PERMISSIONS} value={permissions} onChange={setPermissions} disabled={locked || busy} />
            {errors.permissions && (
              <p id="r-perm-error" role="alert" className="text-xs text-destructive">
                {errors.permissions}
              </p>
            )}
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              Permission list and System Default roles not confirmed yet <OpenQuestionTag id="OQ-09" />
            </p>
          </div>
          {row && !locked && row.users > 0 && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" role="status">
              Affects {row.users} user{row.users === 1 ? '' : 's'}: changes apply at once wherever they hold this role.
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
            {row && !locked && (
              <Button
                type="button"
                variant="outline"
                className="sm:mr-auto"
                disabled={busy}
                onClick={() => void run(() => roleService.setStatus(row.roleId, row.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE', actor), row.status === 'ACTIVE' ? `${row.name} deactivated` : `${row.name} activated`)}
              >
                {row.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
              </Button>
            )}
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {locked ? 'Close' : 'Cancel'}
            </Button>
            {!locked && (
              <Button type="submit" disabled={busy}>
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
  const { account } = useAccess()
  const isAdmin = account?.level === 'PLATFORM_ADMIN'
  const rows = useLoad(() => roleService.list(actor), [actor.userId])
  const merchants = useLoad(() => merchantService.list(actor), [actor.userId])
  const [editing, setEditing] = useState<Editing>()
  const headers = ['Role ID', 'Role Name', ...(isAdmin ? ['Merchant'] : []), 'Role Type', 'Status', 'Users', 'Created At']

  if (rows.error && !rows.data) return <ErrorState message={rows.error} onRetry={rows.reload} />
  return (
    <div className="mx-auto max-w-[1200px] space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Roles</h1>
          <p className="text-sm text-muted-foreground">What users may do. Give roles to users on the Users screen, for All projects or selected projects.</p>
        </div>
        <Button onClick={() => setEditing({ mode: 'create' })}>
          <Plus aria-hidden /> New role
        </Button>
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
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{r.roleId}</td>
                <th scope="row" className="px-3 py-2 text-left font-normal">
                  <button type="button" className="font-medium text-blue-700 hover:underline dark:text-blue-400" onClick={() => setEditing({ mode: 'edit', row: r })}>
                    {r.name}
                  </button>
                </th>
                {isAdmin && <td className="px-3 py-2 whitespace-nowrap">{r.merchantName ?? 'All merchants'}</td>}
                <td className="px-3 py-2 whitespace-nowrap">{r.type === 'SYSTEM_DEFAULT' ? 'System Default' : 'Custom'}</td>
                <td className="px-3 py-2">{r.status === 'ACTIVE' ? 'Active' : 'Inactive'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.users}</td>
                <td className="px-3 py-2 whitespace-nowrap">{formatMyt(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {editing && (
        <RoleDialog
          editing={editing}
          merchants={isAdmin ? (merchants.data ?? []) : []}
          defaultMerchantId={isAdmin ? undefined : account?.merchantId}
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

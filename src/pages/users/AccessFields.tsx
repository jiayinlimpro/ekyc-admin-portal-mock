// REQ: DEC-74 / DEC-104 — shared pieces of the Users and Members screens: status badge, access chips, the role picker,
// the access preview and the Change role dialog.
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/FormField'
import { NativeSelect } from '@/components/common/NativeSelect'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MERCHANT_PERMISSIONS, type Permission, type Role, type UserStatus } from '@/domain/types'
import { errorMessage, fieldErrors } from '@/hooks/useLoad'
import { PERMISSION_LABELS, USER_STATUS_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { isServiceError } from '@/services/errors'

const STATUS_TONE: Record<UserStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
  ACTIVE: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-200',
  SUSPENDED: 'bg-muted text-muted-foreground',
}
export const UserStatusBadge = ({ status }: { status: UserStatus }) => <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', STATUS_TONE[status])}>{USER_STATUS_LABELS[status]}</span>

/** REQ: DEC-74 — one access row as a chip, "Role · Scope"; grey when its project is archived. */
export function AccessChip({ label, archived = false, children }: { label: string; archived?: boolean; children?: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs whitespace-nowrap', archived && 'border-dashed text-muted-foreground')}>
      {label}
      {children}
    </span>
  )
}

export type ProjectOption = { projectId: string; name: string }
export type MerchantOption = { merchantId: string; name: string }

/** A role picker; System Default roles are marked. */
export function RoleSelect({ id, label, roles, value, onChange, error, hint }: { id: string; label: string; roles: Role[]; value: string; onChange: (roleId: string) => void; error?: string; hint?: string }) {
  return (
    <FormField id={id} label={label} error={error} hint={hint}>
      <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error}>
        <option value="">Choose a role</option>
        {roles.map((r) => (
          <option key={r.roleId} value={r.roleId}>
            {r.name}
            {r.type === 'SYSTEM_DEFAULT' ? ' (System Default)' : ''}
          </option>
        ))}
      </NativeSelect>
    </FormField>
  )
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
const MERCHANT_WIDE: readonly Permission[] = MERCHANT_PERMISSIONS

/** REQ: DEC-74 — plain-language preview of a role before it is given. */
export function AccessPreview({ who, permissions, where }: { who: string; permissions: readonly Permission[]; where: string }) {
  const project = permissions.filter((p) => !MERCHANT_WIDE.includes(p)).map((p) => lower(PERMISSION_LABELS[p]))
  const merchant = permissions.filter((p) => MERCHANT_WIDE.includes(p)).map((p) => lower(PERMISSION_LABELS[p]))
  return (
    <p role="status" className="w-full rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:bg-blue-500/10 dark:text-blue-100">
      {!permissions.length ? (
        `${who} will have no access until they are added to a project in Project › Members.`
      ) : (
        <>
          {who} will be able to {project.length ? `${project.join(', ')} in ${where}` : ''}
          {project.length && merchant.length ? '; and ' : ''}
          {merchant.length ? `${merchant.join(', ')} for the whole merchant` : ''}.
        </>
      )}
    </p>
  )
}

/** REQ: DEC-104 — change a user's role (merchant users: their merchant role; platform staff: their platform role). */
export function ChangeRoleDialog({
  who,
  roles,
  initialRoleId,
  merchant = true,
  onSave,
  onClose,
}: {
  who: string
  roles: Role[]
  initialRoleId?: string
  /** Merchant role: applies to the whole merchant (help text and preview). */
  merchant?: boolean
  onSave: (roleId: string) => Promise<void>
  onClose: () => void
}) {
  const [roleId, setRoleId] = useState(initialRoleId ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const role = roles.find((r) => r.roleId === roleId)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!roleId) return setErrors({ roleId: 'Choose a role.' })
    setBusy(true)
    setErrors({})
    try {
      await onSave(roleId)
      onClose()
    } catch (err) {
      setErrors(fieldErrors(err))
      if (!isServiceError(err) || err.code !== 'VALIDATION') toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>Change role for {who}</DialogTitle>
            <DialogDescription>{merchant ? 'The role applies to the whole merchant. Project roles are set in Project › Members.' : 'Platform staff have one role; it applies to every merchant.'}</DialogDescription>
          </DialogHeader>
          <RoleSelect id="cr-role" label={merchant ? 'Merchant role' : 'Staff role'} roles={roles} value={roleId} onChange={setRoleId} error={errors.roleId} hint={merchant ? MERCHANT_ROLE_HINT : undefined} />
          {merchant && role && <AccessPreview who={who} permissions={role.permissions} where="every project (including new ones)" />}
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
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** REQ: DEC-104 — the help text wherever a merchant role is given on Users. */
export const MERCHANT_ROLE_HINT = 'This role applies to the whole merchant and all its projects. For selected projects only, keep Member and add the user in Project › Members.'

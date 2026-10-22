// REQ: DEC-70 / DEC-74 — the role and scope pickers used to invite a user and to add or edit their access.
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/FormField'
import { NativeSelect } from '@/components/common/NativeSelect'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { accessEndsAt, hasMerchantAccess, isMerchantLevel, MERCHANT_LEVEL_SCOPE } from '@/domain/roles'
import { MERCHANT_PERMISSIONS, type Permission, type Role, type UserStatus } from '@/domain/types'
import { errorMessage, fieldErrors } from '@/hooks/useLoad'
import { PERMISSION_LABELS, USER_STATUS_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { isServiceError } from '@/services/errors'
import type { AssignmentInput } from '@/services/userAdminService'

const STATUS_TONE: Record<UserStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
  ACTIVE: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-200',
  SUSPENDED: 'bg-muted text-muted-foreground',
}
export const UserStatusBadge = ({ status }: { status: UserStatus }) => <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', STATUS_TONE[status])}>{USER_STATUS_LABELS[status]}</span>

/** REQ: DEC-74 — one access row as a chip, "Role · Scope"; grey when every project in it is archived. */
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

/** REQ: DEC-99 — "Access ends": Never (default) or the end of a chosen day (MYT). */
export function EndsField({ idPrefix, value, onChange, error }: { idPrefix: string; value?: string; onChange: (endsAt: string | undefined) => void; error?: string }) {
  const day = value?.slice(0, 10) ?? ''
  const [onDate, setOnDate] = useState(!!value)
  return (
    <fieldset aria-describedby={error ? `${idPrefix}-ends-error` : undefined}>
      <legend className="mb-1 text-xs font-medium text-muted-foreground">Access ends</legend>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name={`${idPrefix}-ends`} checked={!onDate} onChange={() => { setOnDate(false); onChange(undefined) }} />
          Never
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name={`${idPrefix}-ends`} checked={onDate} onChange={() => setOnDate(true)} />
          On
        </label>
        <input
          type="date"
          aria-label="Access ends on"
          disabled={!onDate}
          value={day}
          onChange={(e) => onChange(e.target.value ? accessEndsAt(e.target.value) : undefined)}
          className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm disabled:opacity-50"
        />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">From the end of that day (MYT) this access grants nothing.</p>
      {error && (
        <p id={`${idPrefix}-ends-error`} role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  )
}

/**
 * REQ: DEC-99 — platform staff: Staff role (platform roles only), Merchant access (All merchants, including future
 * ones, by default; or Selected merchants), Access ends. A role with no merchant access needs no merchants.
 */
export function StaffAccessFields({ idPrefix, roles, merchants, value, onChange, errors }: { idPrefix: string; roles: Role[]; merchants: MerchantOption[]; value: AssignmentInput; onChange: (v: AssignmentInput) => void; errors: Record<string, string> }) {
  const role = roles.find((r) => r.roleId === value.roleId)
  const selected = value.scope.kind === 'MERCHANTS' ? value.scope.merchantIds : []
  const toggle = (id: string, on: boolean) => onChange({ ...value, scope: { kind: 'MERCHANTS', merchantIds: on ? [...selected, id] : selected.filter((x) => x !== id) } })
  return (
    <>
      <FormField id={`${idPrefix}-role`} label="Staff role" error={errors.roleId}>
        <NativeSelect id={`${idPrefix}-role`} value={value.roleId} onChange={(e) => onChange({ ...value, roleId: e.target.value })} aria-invalid={!!errors.roleId}>
          <option value="">Choose a staff role</option>
          {roles.map((r) => (
            <option key={r.roleId} value={r.roleId}>
              {r.name}
              {r.type === 'SYSTEM_DEFAULT' ? ' (System Default)' : ''}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      {role && !hasMerchantAccess(role.permissions) ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">This role has no merchant access permissions.</p>
      ) : (
        <fieldset aria-describedby={errors.scope ? `${idPrefix}-scope-error` : undefined}>
          <legend className="mb-1 text-xs font-medium text-muted-foreground">Merchant access</legend>
          <label className="flex items-center gap-2 py-1 text-sm">
            <input type="radio" name={`${idPrefix}-mscope`} checked={value.scope.kind === 'ALL_MERCHANTS'} onChange={() => onChange({ ...value, scope: { kind: 'ALL_MERCHANTS' } })} />
            All merchants, including future merchants
          </label>
          <label className="flex items-center gap-2 py-1 text-sm">
            <input type="radio" name={`${idPrefix}-mscope`} checked={value.scope.kind === 'MERCHANTS'} onChange={() => onChange({ ...value, scope: { kind: 'MERCHANTS', merchantIds: [] } })} />
            Selected merchants
          </label>
          {value.scope.kind === 'MERCHANTS' && (
            <div className="mt-1 ml-6 grid gap-0.5 sm:grid-cols-2" role="group" aria-label="Merchants">
              {merchants.map((m) => (
                <label key={m.merchantId} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={selected.includes(m.merchantId)} onChange={(e) => toggle(m.merchantId, e.target.checked)} />
                  {m.name}
                </label>
              ))}
            </div>
          )}
          {errors.scope && (
            <p id={`${idPrefix}-scope-error`} role="alert" className="mt-1 text-xs text-destructive">
              {errors.scope}
            </p>
          )}
        </fieldset>
      )}
      <EndsField idPrefix={idPrefix} value={value.endsAt} onChange={(endsAt) => onChange({ ...value, endsAt })} error={errors.endsAt} />
    </>
  )
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
const MERCHANT_LEVEL: readonly Permission[] = MERCHANT_PERMISSIONS

/** REQ: DEC-74 — plain-language preview of an access row before it is saved. */
export function AccessPreview({ who, permissions, where }: { who: string; permissions: readonly Permission[]; where: string }) {
  const project = permissions.filter((p) => !MERCHANT_LEVEL.includes(p)).map((p) => lower(PERMISSION_LABELS[p]))
  const merchant = permissions.filter((p) => MERCHANT_LEVEL.includes(p)).map((p) => lower(PERMISSION_LABELS[p]))
  return (
    <p role="status" className="w-full rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:bg-blue-500/10 dark:text-blue-100">
      {who} will be able to {project.length ? `${project.join(', ')} in ${where}` : ''}
      {project.length && merchant.length ? '; and ' : ''}
      {merchant.length ? `${merchant.join(', ')} for the whole merchant` : ''}.
    </p>
  )
}

export function AssignmentFields({
  idPrefix,
  who,
  roles,
  projects,
  value,
  onChange,
  errors,
}: {
  idPrefix: string
  /** The user's name for the preview; no preview without it. */
  who?: string
  roles: Role[]
  projects: ProjectOption[]
  value: AssignmentInput
  onChange: (v: AssignmentInput) => void
  errors: Record<string, string>
}) {
  const role = roles.find((r) => r.roleId === value.roleId)
  const wide = !!role && isMerchantLevel(role.permissions)
  const selected = value.scope.kind === 'PROJECTS' ? value.scope.projectIds : []
  const pickRole = (roleId: string) => {
    const next = roles.find((r) => r.roleId === roleId)
    onChange({ roleId, scope: next && isMerchantLevel(next.permissions) ? { kind: 'ALL_PROJECTS' } : value.scope })
  }
  const toggle = (projectId: string, on: boolean) => onChange({ ...value, scope: { kind: 'PROJECTS', projectIds: on ? [...selected, projectId] : selected.filter((id) => id !== projectId) } })
  return (
    <>
      <FormField id={`${idPrefix}-role`} label="Role" error={errors.roleId}>
        <NativeSelect id={`${idPrefix}-role`} value={value.roleId} onChange={(e) => pickRole(e.target.value)} aria-invalid={!!errors.roleId}>
          <option value="">Choose a role</option>
          {roles.map((r) => (
            <option key={r.roleId} value={r.roleId}>
              {r.name}
              {r.type === 'SYSTEM_DEFAULT' ? ' (System Default)' : ''}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <fieldset aria-describedby={errors.scope ? `${idPrefix}-scope-error` : undefined}>
        <legend className="mb-1 text-xs font-medium text-muted-foreground">Where it applies</legend>
        <label className="flex items-start gap-2 py-1 text-sm">
          <input type="radio" name={`${idPrefix}-scope`} className="mt-1" checked={value.scope.kind === 'ALL_PROJECTS'} onChange={() => onChange({ ...value, scope: { kind: 'ALL_PROJECTS' } })} />
          <span>
            All projects
            <span className="block text-xs text-muted-foreground">Every current project and any project created later.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 py-1 text-sm">
          <input type="radio" name={`${idPrefix}-scope`} className="mt-1" disabled={wide} checked={value.scope.kind === 'PROJECTS'} onChange={() => onChange({ ...value, scope: { kind: 'PROJECTS', projectIds: [] } })} />
          <span className={cn(wide && 'text-muted-foreground')}>
            Selected projects
            {wide && <span className="block text-xs">{MERCHANT_LEVEL_SCOPE}</span>}
          </span>
        </label>
        {value.scope.kind === 'PROJECTS' && (
          <div className="mt-1 ml-6 space-y-0.5" role="group" aria-label="Projects">
            {projects.map((p) => (
              <label key={p.projectId} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={selected.includes(p.projectId)} onChange={(e) => toggle(p.projectId, e.target.checked)} />
                {p.name}
              </label>
            ))}
          </div>
        )}
        {errors.scope && (
          <p id={`${idPrefix}-scope-error`} role="alert" className="mt-1 text-xs text-destructive">
            {errors.scope}
          </p>
        )}
      </fieldset>
      <EndsField idPrefix={idPrefix} value={value.endsAt} onChange={(endsAt) => onChange({ ...value, endsAt })} error={errors.endsAt} />
      {who && role && (value.scope.kind === 'ALL_PROJECTS' || selected.length > 0) && (
        <AccessPreview who={who} permissions={role.permissions} where={value.scope.kind === 'ALL_PROJECTS' ? 'every project (including new ones)' : projects.filter((p) => selected.includes(p.projectId)).map((p) => p.name).join(', ')} />
      )}
    </>
  )
}

/** Add or edit one assignment of a user. */
export function AssignmentDialog({
  title,
  who,
  initial,
  roles,
  projects,
  merchants = [],
  staff = false,
  onSave,
  onClose,
}: {
  title: string
  who: string
  initial?: AssignmentInput
  roles: Role[]
  projects: ProjectOption[]
  /** REQ: DEC-99 — platform staff: platform roles with a merchant scope. */
  merchants?: MerchantOption[]
  staff?: boolean
  onSave: (v: AssignmentInput) => Promise<void>
  onClose: () => void
}) {
  const [value, setValue] = useState<AssignmentInput>(initial ?? { roleId: '', scope: staff ? { kind: 'ALL_MERCHANTS' } : { kind: 'PROJECTS', projectIds: [] } })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!value.roleId) return setErrors({ roleId: 'Choose a role.' })
    setBusy(true)
    setErrors({})
    try {
      await onSave(value)
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
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>Permissions from several assignments add up. You can only give access you have yourself.</DialogDescription>
          </DialogHeader>
          {staff ? (
            <StaffAccessFields idPrefix="as" roles={roles} merchants={merchants} value={value} onChange={setValue} errors={errors} />
          ) : (
            <AssignmentFields idPrefix="as" who={who} roles={roles} projects={projects} value={value} onChange={setValue} errors={errors} />
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
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// REQ: DEC-70 / DEC-74 — the role and scope pickers used to invite a user and to add or edit their access.
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/FormField'
import { NativeSelect } from '@/components/common/NativeSelect'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { isMerchantLevel, MERCHANT_LEVEL_SCOPE } from '@/domain/roles'
import type { Role, UserStatus } from '@/domain/types'
import { errorMessage, fieldErrors } from '@/hooks/useLoad'
import { USER_STATUS_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { isServiceError } from '@/services/errors'
import type { AssignmentInput } from '@/services/userAdminService'

const STATUS_TONE: Record<UserStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
  ACTIVE: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-200',
  SUSPENDED: 'bg-muted text-muted-foreground',
}
export const UserStatusBadge = ({ status }: { status: UserStatus }) => <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', STATUS_TONE[status])}>{USER_STATUS_LABELS[status]}</span>

export type ProjectOption = { projectId: string; name: string }

export function AssignmentFields({
  idPrefix,
  roles,
  projects,
  value,
  onChange,
  errors,
}: {
  idPrefix: string
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
    </>
  )
}

/** Add or edit one assignment of a user. */
export function AssignmentDialog({
  title,
  initial,
  roles,
  projects,
  onSave,
  onClose,
}: {
  title: string
  initial?: AssignmentInput
  roles: Role[]
  projects: ProjectOption[]
  onSave: (v: AssignmentInput) => Promise<void>
  onClose: () => void
}) {
  const [value, setValue] = useState<AssignmentInput>(initial ?? { roleId: '', scope: { kind: 'PROJECTS', projectIds: [] } })
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
          <AssignmentFields idPrefix="as" roles={roles} projects={projects} value={value} onChange={setValue} errors={errors} />
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

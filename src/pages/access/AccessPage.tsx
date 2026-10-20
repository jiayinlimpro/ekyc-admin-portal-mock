import { useState, type FormEvent } from 'react'
import { Check, Minus, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { useAccess } from '@/app/access'
import { FormField } from '@/components/common/FormField'
import { NativeSelect } from '@/components/common/NativeSelect'
import { OpenQuestionTag } from '@/components/common/OpenQuestionTag'
import { RequireProject } from '@/components/common/RequireProject'
import { ErrorState } from '@/components/common/States'
import { Tabs, tabPanelProps } from '@/components/common/Tabs'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { rolesAllowed, type ProjectAction } from '@/domain/access'
import { PROJECT_ROLES, type EffectiveRole, type Project, type ProjectRole, type UserStatus } from '@/domain/types'
import { errorMessage, useLoad } from '@/hooks/useLoad'
import { formatMyt } from '@/lib/format'
import { PROJECT_ROLE_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { accessAdminService, type AccessRow } from '@/services/accessAdminService'
import { isServiceError } from '@/services/errors'
import { useSession } from '@/stores/sessionStore'

type ProjectOption = Pick<Project, 'projectId' | 'name' | 'status'>
const STATUS_TEXT: Record<UserStatus, string> = { INVITED: 'Invited', ACTIVE: 'Active', DEACTIVATED: 'Deactivated' }
const STATUS_TONE: Record<UserStatus, string> = {
  INVITED: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-200',
  ACTIVE: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-200',
  DEACTIVATED: 'bg-muted text-muted-foreground',
}

function RoleSelect({ id, value, onChange }: { id: string; value: ProjectRole | ''; onChange: (v: ProjectRole | '') => void }) {
  return (
    <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value as ProjectRole | '')}>
      <option value="">No access</option>
      {PROJECT_ROLES.map((r) => (
        <option key={r} value={r}>
          {PROJECT_ROLE_LABELS[r]}
        </option>
      ))}
    </NativeSelect>
  )
}

function InviteDialog({ merchantId, projects, onClose, onDone }: { merchantId: string; projects: ProjectOption[]; onClose: () => void; onDone: () => void }) {
  const actor = useSession((s) => s.actor)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [roles, setRoles] = useState<Record<string, ProjectRole | ''>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    try {
      const chosen = Object.entries(roles).filter((x): x is [string, ProjectRole] => !!x[1]).map(([projectId, role]) => ({ projectId, role }))
      const a = await accessAdminService.invite(merchantId, { fullName, email, roles: chosen }, actor)
      toast.success(`${a.fullName} invited`, { description: 'They appear as Invited until they sign in (mock).' })
      onDone()
    } catch (err) {
      if (isServiceError(err) && Array.isArray(err.details)) setErrors(Object.fromEntries((err.details as { field: string; message: string }[]).map((x) => [x.field, x.message])))
      else setErrors({ form: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>Invite user</DialogTitle>
            <DialogDescription>They join this merchant with one role per project you choose.</DialogDescription>
          </DialogHeader>
          <FormField id="i-name" label="Full name" error={errors.fullName}>
            <Input id="i-name" value={fullName} onChange={(e) => setFullName(e.target.value)} aria-invalid={!!errors.fullName} autoFocus />
          </FormField>
          <FormField id="i-email" label="Email" error={errors.email}>
            <Input id="i-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors.email} />
          </FormField>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-medium text-muted-foreground">Projects and roles</legend>
            {projects.map((p) => (
              <FormField key={p.projectId} id={`i-${p.projectId}`} label={p.name}>
                <RoleSelect id={`i-${p.projectId}`} value={roles[p.projectId] ?? ''} onChange={(v) => setRoles({ ...roles, [p.projectId]: v })} />
              </FormField>
            ))}
            {errors.roles && (
              <p role="alert" className="text-xs text-destructive">
                {errors.roles}
              </p>
            )}
          </fieldset>
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
              Send invite
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// REQ: DEC-74 — one role per project; removing access or making someone Viewer releases their open claims there.
function EditDialog({ row, projects, onClose, onDone }: { row: AccessRow; projects: ProjectOption[]; onClose: () => void; onDone: () => void }) {
  const actor = useSession((s) => s.actor)
  const editable = projects.filter((p) => row.editableProjectIds.includes(p.projectId))
  const current = Object.fromEntries(row.account.memberships.map((m) => [m.projectId, m.role])) as Record<string, ProjectRole>
  const [roles, setRoles] = useState<Record<string, ProjectRole | ''>>(() => Object.fromEntries(editable.map((p) => [p.projectId, current[p.projectId] ?? ''])))
  const [busy, setBusy] = useState(false)
  const changed = editable.filter((p) => (roles[p.projectId] ?? '') !== (current[p.projectId] ?? ''))
  const save = async () => {
    setBusy(true)
    try {
      for (const p of changed) {
        const r = roles[p.projectId]
        if (r) await accessAdminService.setRole(row.account.userId, p.projectId, r, actor)
        else await accessAdminService.removeAccess(row.account.userId, p.projectId, actor)
      }
      toast.success(`Access updated for ${row.account.fullName}`)
      onDone()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Access for {row.account.fullName}</DialogTitle>
          <DialogDescription>Removing access, or changing to Viewer, releases their open claims in that project.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {editable.map((p) => (
            <FormField key={p.projectId} id={`e-${p.projectId}`} label={p.name}>
              <RoleSelect id={`e-${p.projectId}`} value={roles[p.projectId] ?? ''} onChange={(v) => setRoles({ ...roles, [p.projectId]: v })} />
            </FormField>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !changed.length} onClick={() => void save()}>
            Save access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function UsersTab({ merchantId }: { merchantId: string }) {
  const actor = useSession((s) => s.actor)
  const rows = useLoad(() => accessAdminService.list(merchantId, actor), [merchantId, actor.userId])
  const projects = useLoad(() => accessAdminService.manageableProjects(merchantId, actor), [merchantId, actor.userId])
  const [inviting, setInviting] = useState(false)
  const [editing, setEditing] = useState<AccessRow>()
  const done = () => {
    setInviting(false)
    setEditing(undefined)
    rows.reload()
  }
  const deactivate = async (r: AccessRow) => {
    if (!window.confirm(`Deactivate ${r.account.fullName}? They lose access to every project and their open claims are released.`)) return
    try {
      await accessAdminService.deactivate(r.account.userId, actor)
      toast.success(`${r.account.fullName} deactivated`)
      rows.reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  if (rows.error && !rows.data) return <ErrorState message={rows.error} onRetry={rows.reload} />
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setInviting(true)} disabled={!projects.data?.length}>
          <UserPlus aria-hidden /> Invite user
        </Button>
      </div>
      <section aria-label="User list" className="overflow-x-auto rounded-lg border bg-card">
        <table className={cn('w-full text-sm', rows.loading && rows.data && 'opacity-60')} aria-busy={rows.loading}>
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              {['User', 'Projects and roles', 'Status', 'Last active'].map((h) => (
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
            {(rows.data ?? []).map((r) => (
              <tr key={r.account.userId} className="border-t">
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  {r.account.fullName}
                  <div className="text-xs font-normal text-muted-foreground">{r.account.email}</div>
                </th>
                <td className="px-3 py-2">
                  {r.account.level === 'MERCHANT_OWNER' ? (
                    <span>Merchant Owner · all projects</span>
                  ) : (
                    <ul className="flex flex-wrap gap-1">
                      {r.roles.map((x) => (
                        <li key={x.projectId} className="rounded border px-1.5 text-xs">
                          {x.projectName} · {PROJECT_ROLE_LABELS[x.role as EffectiveRole]}
                        </li>
                      ))}
                      {!r.roles.length && <li className="text-xs text-muted-foreground">No projects</li>}
                    </ul>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', STATUS_TONE[r.account.status])}>{STATUS_TEXT[r.account.status]}</span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{r.account.lastActiveAt ? `${formatMyt(r.account.lastActiveAt)} MYT` : '—'}</td>
                <td className="px-2 py-2 text-right whitespace-nowrap">
                  {r.editableProjectIds.length > 0 && (
                    <Button variant="ghost" size="sm" onClick={() => setEditing(r)} aria-label={`Edit access for ${r.account.fullName}`}>
                      Edit access
                    </Button>
                  )}
                  {r.canDeactivate && (
                    <Button variant="ghost" size="sm" onClick={() => void deactivate(r)} aria-label={`Deactivate ${r.account.fullName}`}>
                      Deactivate
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {inviting && <InviteDialog merchantId={merchantId} projects={projects.data ?? []} onClose={() => setInviting(false)} onDone={done} />}
      {editing && <EditDialog row={editing} projects={projects.data ?? []} onClose={() => setEditing(undefined)} onDone={done} />}
    </div>
  )
}

const MATRIX: { label: string; action?: ProjectAction; platform?: boolean; note?: string }[] = [
  { label: 'Workflow Registry, Merchants', platform: true },
  { label: 'Overview, System Intelligence, Billing (data scoped)', action: 'viewDashboards' },
  { label: 'Create, rename, archive projects', action: 'manageProjects' },
  { label: 'Invite users, assign project roles', action: 'manageMembers' },
  { label: 'API keys, webhook, redirect URLs, IP allowlist', action: 'manageIntegration' },
  { label: 'Create, edit, activate, retire flows', action: 'manageFlows' },
  { label: 'Advanced (custom) thresholds', action: 'setAdvancedThresholds' },
  { label: 'View routing configuration', action: 'viewRouting' },
  { label: 'View cases', action: 'viewCases', note: 'OQ-20' },
  { label: 'Claim a case', action: 'claimCase' },
  { label: 'Approve or reject a claimed case (own claim)', action: 'decideCase' },
  { label: 'Audit Log', action: 'viewAudit' },
]
const MATRIX_ROLES: EffectiveRole[] = ['PLATFORM_ADMIN', 'MERCHANT_OWNER', 'PROJECT_ADMIN', 'REVIEWER', 'VIEWER']

// REQ: DEC-70 — the fixed role table (replaces the old custom Roles screen). Read from the same rules the services use.
function RolesTab() {
  return (
    <section aria-label="Role permissions" className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full text-sm">
        <caption className="px-4 py-2 text-left text-xs text-muted-foreground">
          Merchant Owner and Platform Admin apply to every project they reach; Project Admin, Reviewer and Viewer to their own projects. Role names are OQ-09.
        </caption>
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">Action</th>
            {MATRIX_ROLES.map((r) => (
              <th key={r} scope="col" className="px-3 py-2 text-center font-medium">
                {PROJECT_ROLE_LABELS[r]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MATRIX.map((m) => {
            const allowed = m.platform ? ['PLATFORM_ADMIN'] : rolesAllowed(m.action!)
            return (
              <tr key={m.label} className="border-t">
                <th scope="row" className="px-4 py-2 text-left font-normal">
                  <span className="flex items-center gap-2">
                    {m.label} {m.note && <OpenQuestionTag id={m.note} />}
                  </span>
                </th>
                {MATRIX_ROLES.map((r) => (
                  <td key={r} className="px-3 py-2 text-center">
                    {allowed.includes(r) ? <Check role="img" className="mx-auto size-4 text-green-700 dark:text-green-400" aria-label="Allowed" /> : <Minus role="img" className="mx-auto size-4 text-muted-foreground" aria-label="Not allowed" />}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}

function Access({ merchantId }: { merchantId: string }) {
  const [tab, setTab] = useState<'users' | 'roles'>('users')
  return (
    <div className="mx-auto max-w-[1300px] space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Users and Access</h1>
        <p className="text-sm text-muted-foreground">Users belong to the merchant and have one role per project. Changes are audited.</p>
      </header>
      <Tabs label="Users and Access" tabs={[{ value: 'users', label: 'Users' }, { value: 'roles', label: 'Roles' }] as const} value={tab} onChange={setTab} />
      <div {...tabPanelProps(tab)}>{tab === 'users' ? <UsersTab merchantId={merchantId} /> : <RolesTab />}</div>
    </div>
  )
}

// REQ: DEC-74 — the merchant of the header's project; Platform Admin under "All my projects" picks one first.
export function AccessPage() {
  const { selected, account } = useAccess()
  const merchantId = selected?.merchantId ?? (account?.level === 'PLATFORM_ADMIN' ? undefined : account?.merchantId)
  if (!merchantId) return <RequireProject action="manageMembers" title="Users and Access">{(p) => <Access key={p.merchantId} merchantId={p.merchantId} />}</RequireProject>
  return <Access key={merchantId} merchantId={merchantId} />
}

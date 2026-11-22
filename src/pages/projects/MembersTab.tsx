// REQ: DEC-77 — a project's Members (sidebar › User Management): everyone with access to the project, All projects users marked inherited.
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAccess } from '@/app/access'
import { FormField } from '@/components/common/FormField'
import { NativeSelect } from '@/components/common/NativeSelect'
import { ErrorState } from '@/components/common/States'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { canInMerchant, canInProject } from '@/domain/access'
import type { Project } from '@/domain/types'
import { errorMessage, fieldErrors, useLoad } from '@/hooks/useLoad'
import { cn } from '@/lib/utils'
import { roleService } from '@/services/roleService'
import { userAdminService } from '@/services/userAdminService'
import { useSession } from '@/stores/sessionStore'
import { AccessChip, AccessPreview, UserStatusBadge } from '../users/AccessFields'
import { Card } from './settingsUi'

type AddMode = 'EXISTING' | 'NEW'

// REQ: DEC-77 / OQ-27 — Existing user (Members › Add / remove) or New person (that, or Users › Invite at merchant level):
// a new person joins the merchant as Member (no permissions) with the project role here.
function AddMember({ project, canExisting, onAdded }: { project: Project; canExisting: boolean; onAdded: () => void }) {
  const actor = useSession((s) => s.actor)
  const [mode, setMode] = useState<AddMode>(canExisting ? 'EXISTING' : 'NEW')
  const candidates = useLoad(() => (canExisting ? userAdminService.memberCandidates(project.projectId, actor) : Promise.resolve([])), [project.projectId, actor.userId, canExisting])
  // REQ: DEC-77 / DEC-104 — this project's roles (Project Settings › Roles) that the actor may give here.
  const roles = useLoad(() => roleService.assignable(project.merchantId, actor, project.projectId), [project.merchantId, project.projectId, actor.userId])
  const [userId, setUserId] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [roleId, setRoleId] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (mode === 'EXISTING' && !userId) return setErrors({ userId: 'Choose a user.' })
    if (mode === 'NEW' && (!fullName.trim() || !email.trim())) return setErrors(fullName.trim() ? { email: 'Enter an email address.' } : { fullName: 'Enter a full name.' })
    if (!roleId) return setErrors({ roleId: 'Choose a role.' })
    setBusy(true)
    setErrors({})
    try {
      if (mode === 'EXISTING') {
        await userAdminService.addMember(project.projectId, userId, roleId, actor)
        toast.success('Member added')
      } else {
        const r = await userAdminService.inviteMember(project.projectId, { fullName, email, roleId }, actor)
        const roleName = roles.data?.find((x) => x.roleId === roleId)?.name ?? 'the role'
        toast.success(r.existing ? `Already a user of this merchant: added as ${roleName}` : `Invitation sent to ${email.trim().toLowerCase()} · Member of the merchant, ${roleName} here`)
      }
      setUserId('')
      setFullName('')
      setEmail('')
      setRoleId('')
      onAdded()
    } catch (err) {
      setErrors(fieldErrors(err))
    } finally {
      setBusy(false)
    }
  }
  const error = errors.form ?? errors.scope ?? errors.roleId ?? errors.userId ?? errors.user ?? errors.fullName ?? errors.email
  const role = roles.data?.find((r) => r.roleId === roleId)
  const user = candidates.data?.find((u) => u.userId === userId)
  const who = mode === 'EXISTING' ? user?.fullName : fullName.trim() || undefined
  const noRoles = roles.data?.length === 0
  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      {canExisting && (
        <div role="radiogroup" aria-label="Add" className="inline-flex rounded-md border p-0.5 text-sm">
          {(['EXISTING', 'NEW'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => {
                setMode(m)
                setErrors({})
              }}
              className={cn('rounded px-3 py-1', mode === m ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {m === 'EXISTING' ? 'Existing user' : 'New person'}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <FormField id="mb-project" label="Project" className="w-44">
          <Input id="mb-project" value={project.name} readOnly disabled />
        </FormField>
        {mode === 'EXISTING' ? (
          <FormField id="mb-user" label="User" className="w-64">
            <NativeSelect id="mb-user" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Choose a user</option>
              {(candidates.data ?? []).map((u) => (
                <option key={u.userId} value={u.userId}>
                  {u.fullName} · {u.email}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        ) : (
          <>
            <FormField id="mb-name" label="Full name" className="w-56">
              <Input id="mb-name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="off" aria-invalid={!!errors.fullName} />
            </FormField>
            <FormField id="mb-email" label="Email" className="w-64">
              <Input id="mb-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" aria-invalid={!!errors.email} />
            </FormField>
          </>
        )}
        <FormField id="mb-role" label="Project role" className="w-48">
          <NativeSelect id="mb-role" value={roleId} onChange={(e) => setRoleId(e.target.value)} disabled={noRoles}>
            <option value="">{noRoles ? 'No role you can give' : 'Choose a role'}</option>
            {(roles.data ?? []).map((r) => (
              <option key={r.roleId} value={r.roleId}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <Button type="submit" disabled={busy || noRoles}>
          <Plus aria-hidden /> {mode === 'EXISTING' ? 'Add member' : 'Invite'}
        </Button>
      </div>
      {role && who && <AccessPreview who={who} permissions={role.permissions} where={project.name} />}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {mode === 'EXISTING'
          ? 'Users of this merchant. Someone new? Choose New person.'
          : 'They join the merchant as Member (no access elsewhere) with this project role here, and get an invitation by email. An email of an existing user of this merchant adds the role to them.'}
        {noRoles && ' You hold no project permissions, so there is no project role you can give (only what you hold).'}
      </p>
    </form>
  )
}

export function MembersTab({ project }: { project: Project }) {
  const actor = useSession((s) => s.actor)
  const rows = useLoad(() => userAdminService.listMembers(project.projectId, actor), [project.projectId, actor.userId])
  const open = project.status === 'ACTIVE'
  const { account } = useAccess()
  // REQ: DEC-77 — inherited (All projects) access is changed on the user's details, for those who may open them.
  const canOpenUsers = !!account && canInMerchant(account, 'viewUsers', project.merchantId)
  // REQ: DEC-102 — View members is read-only; adding and removing needs Add / remove.
  const canManage = !!account && canInProject(account, 'manageMembers', project)
  // REQ: DEC-77 / OQ-27 — Users › Invite (merchant level) may invite a new person here too.
  const canInvite = canManage || (!!account && canInMerchant(account, 'inviteUsers', project.merchantId))

  const remove = async (userId: string, assignmentId: string, label: string) => {
    if (!window.confirm(`Remove ${label} from ${project.name}? Their open claims here are released.`)) return
    try {
      await userAdminService.removeMember(project.projectId, userId, assignmentId, actor)
      toast.success('Access removed')
      rows.reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  if (rows.error && !rows.data) return <ErrorState message={rows.error} onRetry={rows.reload} />
  return (
    <Card title="Members">
      <div className="space-y-4">
        {!canInvite ? null : open ? <AddMember project={project} canExisting={canManage} onAdded={rows.reload} /> : <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">Archived projects keep their members, read-only.</p>}
        <div className="overflow-x-auto rounded-md border">
          <table className={cn('w-full text-sm', rows.loading && rows.data && 'opacity-60')} aria-busy={rows.loading}>
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                {['Name', 'Email', 'Role in this project', 'Status'].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(rows.data ?? []).map((m) => (
                <tr key={m.userId} className="border-t">
                  <th scope="row" className="px-3 py-2 text-left font-medium">
                    {canOpenUsers ? (
                      <Link to={`/merchants/${project.merchantId}?tab=users&user=${m.userId}`} className="text-blue-700 hover:underline dark:text-blue-400">
                        {m.fullName}
                      </Link>
                    ) : (
                      m.fullName
                    )}
                  </th>
                  <td className="px-3 py-2">{m.email}</td>
                  <td className="px-3 py-2">
                    <ul className="flex flex-wrap gap-1.5">
                      {m.roles.map((r) => (
                        <li key={r.assignmentId}>
                          <AccessChip label={r.label}>
                            {r.inherited && (
                              <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground uppercase" title="From the user’s merchant role (read-only here; changed on the Users screen)">
                                inherited · read-only
                              </span>
                            )}
                            {r.removable && (
                              <button type="button" className="rounded p-0.5 hover:bg-muted" aria-label={`Remove ${r.roleName} for ${m.fullName}`} onClick={() => void remove(m.userId, r.assignmentId, `${m.fullName} (${r.label})`)}>
                                <X className="size-3" aria-hidden />
                              </button>
                            )}
                          </AccessChip>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="px-3 py-2">
                    <UserStatusBadge status={m.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  )
}

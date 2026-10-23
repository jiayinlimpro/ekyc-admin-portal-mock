// REQ: DEC-77 — Project Settings › Members: everyone with access to the project, All projects users marked inherited.
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAccess } from '@/app/access'
import { FormField } from '@/components/common/FormField'
import { NativeSelect } from '@/components/common/NativeSelect'
import { OpenQuestionTag } from '@/components/common/OpenQuestionTag'
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

function AddMember({ project, onAdded }: { project: Project; onAdded: () => void }) {
  const actor = useSession((s) => s.actor)
  const candidates = useLoad(() => userAdminService.memberCandidates(project.projectId, actor), [project.projectId, actor.userId])
  // REQ: DEC-77 / DEC-104 — only roles without merchant-wide permissions that the actor may give in this project.
  const roles = useLoad(() => roleService.assignable(project.merchantId, actor, project.projectId), [project.merchantId, project.projectId, actor.userId])
  const [userId, setUserId] = useState('')
  const [roleId, setRoleId] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!userId || !roleId) return setErrors(userId ? { roleId: 'Choose a role.' } : { userId: 'Choose a user.' })
    setBusy(true)
    setErrors({})
    try {
      await userAdminService.addMember(project.projectId, userId, roleId, actor)
      toast.success('Member added')
      setUserId('')
      setRoleId('')
      onAdded()
    } catch (err) {
      setErrors(fieldErrors(err))
    } finally {
      setBusy(false)
    }
  }
  const error = errors.form ?? errors.scope ?? errors.roleId ?? errors.userId ?? errors.user
  const role = roles.data?.find((r) => r.roleId === roleId)
  const user = candidates.data?.find((u) => u.userId === userId)
  return (
    <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-3">
      <FormField id="mb-project" label="Project" className="w-44">
        <Input id="mb-project" value={project.name} readOnly disabled />
      </FormField>
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
      <FormField id="mb-role" label="Role" className="w-48">
        <NativeSelect id="mb-role" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          <option value="">Choose a role</option>
          {(roles.data ?? []).map((r) => (
            <option key={r.roleId} value={r.roleId}>
              {r.name}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <Button type="submit" disabled={busy}>
        <Plus aria-hidden /> Add member
      </Button>
      {role && user && <AccessPreview who={user.fullName} permissions={role.permissions} where={project.name} />}
      {error && (
        <p role="alert" className="w-full text-sm text-destructive">
          {error}
        </p>
      )}
      <p className="flex w-full items-center gap-2 text-xs text-muted-foreground">
        Users of the merchant only; new people are invited on the Users screen. <OpenQuestionTag id="OQ-27" />
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
        {!canManage ? null : open ? <AddMember project={project} onAdded={rows.reload} /> : <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">Archived projects keep their members, read-only.</p>}
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
                      <Link to={`/users?user=${m.userId}`} className="text-blue-700 hover:underline dark:text-blue-400">
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

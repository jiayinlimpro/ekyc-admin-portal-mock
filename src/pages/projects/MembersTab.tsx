// REQ: DEC-77 — Project Settings › Members: everyone with access to the project, All projects users marked inherited.
import { useState, type FormEvent } from 'react'
import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/FormField'
import { NativeSelect } from '@/components/common/NativeSelect'
import { OpenQuestionTag } from '@/components/common/OpenQuestionTag'
import { ErrorState } from '@/components/common/States'
import { Button } from '@/components/ui/button'
import { isMerchantLevel } from '@/domain/roles'
import type { Project } from '@/domain/types'
import { errorMessage, fieldErrors, useLoad } from '@/hooks/useLoad'
import { cn } from '@/lib/utils'
import { roleService } from '@/services/roleService'
import { userAdminService } from '@/services/userAdminService'
import { useSession } from '@/stores/sessionStore'
import { UserStatusBadge } from '../users/AccessFields'
import { Card } from './settingsUi'

function AddMember({ project, onAdded }: { project: Project; onAdded: () => void }) {
  const actor = useSession((s) => s.actor)
  const candidates = useLoad(() => userAdminService.memberCandidates(project.projectId, actor), [project.projectId, actor.userId])
  // Merchant-level roles only work for All projects, so they are not offered for one project.
  const roles = useLoad(() => roleService.assignable(project.merchantId, actor).then((rs) => rs.filter((r) => !isMerchantLevel(r.permissions))), [project.merchantId, actor.userId])
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
  return (
    <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-3">
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
        {open ? <AddMember project={project} onAdded={rows.reload} /> : <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">Archived projects keep their members, read-only.</p>}
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
                  <th scope="row" className="px-3 py-2 text-left font-medium">{m.fullName}</th>
                  <td className="px-3 py-2">{m.email}</td>
                  <td className="px-3 py-2">
                    <ul className="flex flex-wrap gap-1.5">
                      {m.roles.map((r) => (
                        <li key={r.assignmentId} className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs">
                          {r.roleName}
                          {r.inherited && <span className="text-muted-foreground" title="From an All projects assignment, managed on the Users screen">· inherited</span>}
                          {r.removable && (
                            <button type="button" className="rounded p-0.5 hover:bg-muted" aria-label={`Remove ${r.roleName} for ${m.fullName}`} onClick={() => void remove(m.userId, r.assignmentId, `${m.fullName} (${r.roleName})`)}>
                              <X className="size-3" aria-hidden />
                            </button>
                          )}
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

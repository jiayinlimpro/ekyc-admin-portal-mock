// REQ: DEC-77 — a project's Members (sidebar › User Management): everyone with access to the project, All projects users marked inherited.
import { useRef, useState, type FormEvent, type RefObject } from 'react'
import { Link } from 'react-router'
import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAccess } from '@/app/access'
import { FormField } from '@/components/common/FormField'
import { NativeSelect } from '@/components/common/NativeSelect'
import { ErrorState } from '@/components/common/States'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { canInMerchant, canInProject } from '@/domain/access'
import type { Project, Role } from '@/domain/types'
import { errorMessage, fieldErrors, useLoad } from '@/hooks/useLoad'
import { cn } from '@/lib/utils'
import { roleService } from '@/services/roleService'
import { userAdminService } from '@/services/userAdminService'
import { useSession } from '@/stores/sessionStore'
import { AccessChip, AccessPreview, UserStatusBadge } from '../users/AccessFields'
import { Card } from './settingsUi'

// REQ: DEC-77 / OQ-27 — Email + Project role + Add. Add checks the email first (checkMemberEmail): a user of this merchant
// is added at once; anything that can't be added is refused under the field; only a new email opens the invitation
// dialog (Full name, what will happen, Back / Send invitation). A new person always joins the merchant as Member (no
// permissions), never as a merchant-less account. NN/g: a dialog only for the rarer action with wider effects, and it
// catches a mistyped email of an existing user.
function AddMember({ project, canExisting, onAdded }: { project: Project; canExisting: boolean; onAdded: () => void }) {
  const actor = useSession((s) => s.actor)
  // Suggestions only for those who may add existing users (they may already see who the users are).
  const candidates = useLoad(() => (canExisting ? userAdminService.memberCandidates(project.projectId, actor) : Promise.resolve([])), [project.projectId, actor.userId, canExisting])
  // REQ: DEC-77 / DEC-104 — this project's roles (Project Settings › Roles) that the actor may give here.
  const roles = useLoad(() => roleService.assignable(project.merchantId, actor, project.projectId), [project.merchantId, project.projectId, actor.userId])
  const [email, setEmail] = useState('')
  const [roleId, setRoleId] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [invite, setInvite] = useState<{ email: string; merchantName: string } | null>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const typed = email.trim().toLowerCase()
  const match = typed ? candidates.data?.find((u) => u.email.toLowerCase() === typed) : undefined
  const role = roles.data?.find((r) => r.roleId === roleId)
  const reset = () => {
    setEmail('')
    setRoleId('')
    setErrors({})
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!typed) return setErrors({ email: 'Enter an email address.' })
    if (!roleId) return setErrors({ roleId: 'Choose a role.' })
    setBusy(true)
    setErrors({})
    try {
      const check = await userAdminService.checkMemberEmail(project.projectId, { email, roleId }, actor)
      if (check.kind === 'NEW') {
        setInvite({ email: check.email, merchantName: check.merchantName })
        return
      }
      await userAdminService.addMember(project.projectId, check.userId, roleId, actor)
      toast.success(`${check.fullName} added as ${role?.name ?? 'the role'}`)
      reset()
      onAdded()
    } catch (err) {
      setErrors(fieldErrors(err))
    } finally {
      setBusy(false)
    }
  }
  const error = errors.form ?? errors.scope ?? errors.roleId ?? errors.user ?? errors.email
  const noRoles = roles.data?.length === 0
  return (
    <>
    <form onSubmit={submit} noValidate className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <FormField id="mb-project" label="Project" className="w-44">
          <Input id="mb-project" value={project.name} readOnly disabled />
        </FormField>
        <FormField id="mb-email" label="Email" className="w-72">
          <Input
            ref={emailRef}
            id="mb-email"
            type="email"
            list={canExisting ? 'mb-users' : undefined}
            placeholder={canExisting ? 'Type a name or email' : 'name@company.com'}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setErrors({})
            }}
            autoComplete="off"
            aria-invalid={!!errors.email}
          />
        </FormField>
        {canExisting && (
          <datalist id="mb-users">
            {(candidates.data ?? []).map((u) => (
              <option key={u.userId} value={u.email} label={u.fullName} />
            ))}
          </datalist>
        )}
        <FormField id="mb-role" label="Project role" className="w-48">
          <NativeSelect id="mb-role" value={roleId} onChange={(e) => setRoleId(e.target.value)} disabled={noRoles} aria-invalid={!!errors.roleId}>
            <option value="">{noRoles ? 'No role you can give' : 'Choose a role'}</option>
            {(roles.data ?? []).map((r) => (
              <option key={r.roleId} value={r.roleId}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <Button type="submit" disabled={busy || noRoles}>
          <Plus aria-hidden /> Add
        </Button>
      </div>
      {match && (
        <p className="text-sm" aria-live="polite">
          <span className="font-medium">{match.fullName}</span> <span className="text-muted-foreground">· already a user of this merchant</span>
        </p>
      )}
      {role && match && <AccessPreview who={match.fullName} permissions={role.permissions} where={project.name} />}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {canExisting
          ? 'A user of this merchant is added at once. A new email asks for their name and sends an invitation.'
          : 'Invite someone new to this merchant. Adding an existing user to a project needs Members › Add / remove.'}
        {noRoles && ' You hold no project permissions, so there is no project role you can give (only what you hold).'}
      </p>
    </form>
      {invite && role && (
        <InviteDialog
          project={project}
          role={role}
          email={invite.email}
          merchantName={invite.merchantName}
          finalFocus={emailRef}
          onBack={() => {
            setInvite(null)
            setTimeout(() => emailRef.current?.select(), 0) // the likely reason to go back: a mistyped email
          }}
          onSent={() => {
            setInvite(null)
            reset()
            onAdded()
          }}
        />
      )}
    </>
  )
}

/** REQ: DEC-77 — the invitation dialog for a new email: their name, and exactly what will happen. */
function InviteDialog({
  project,
  role,
  email,
  merchantName,
  finalFocus,
  onBack,
  onSent,
}: {
  project: Project
  role: Role
  email: string
  merchantName: string
  finalFocus: RefObject<HTMLInputElement | null>
  onBack: () => void
  onSent: () => void
}) {
  const actor = useSession((s) => s.actor)
  const [fullName, setFullName] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const send = async (e: FormEvent) => {
    e.preventDefault()
    if (!fullName.trim()) return setErrors({ fullName: 'Enter a full name.' })
    setBusy(true)
    setErrors({})
    try {
      await userAdminService.inviteMember(project.projectId, { fullName, email, roleId: role.roleId }, actor)
      toast.success(`Invitation sent to ${email} · Member of ${merchantName}, ${role.name} in ${project.name}`)
      onSent()
    } catch (err) {
      setErrors(fieldErrors(err))
    } finally {
      setBusy(false)
    }
  }
  const error = errors.form ?? errors.email ?? errors.roleId ?? errors.scope
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onBack()}>
      <DialogContent className="sm:max-w-md" finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle>Invite a new person to {merchantName}?</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{email}</span> isn’t a user of {merchantName} yet.
          </DialogDescription>
        </DialogHeader>
        <form id="mb-invite" onSubmit={send} noValidate className="space-y-3">
          <FormField id="inv-name" label="Full name" error={errors.fullName}>
            <Input id="inv-name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="off" autoFocus aria-invalid={!!errors.fullName} />
          </FormField>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              Joins {merchantName} as <span className="font-medium text-foreground">Member</span>: no access in other projects.
            </li>
            <li>
              <span className="font-medium text-foreground">{role.name}</span> in {project.name}.
            </li>
            <li>Gets an invitation email, and stays Pending until they accept.</li>
          </ul>
          <AccessPreview who={fullName.trim() || 'They'} permissions={role.permissions} where={project.name} />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onBack} disabled={busy}>
            Back
          </Button>
          <Button type="submit" form="mb-invite" disabled={busy}>
            Send invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

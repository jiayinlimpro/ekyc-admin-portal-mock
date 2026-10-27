// REQ: DEC-104 — a project's Roles (sidebar › User Management): this project's role table. The System Default project roles (in every
// project) and the project's own Custom roles; given in Members, they apply in this project only. Duplicate from
// another project copies a role from there.
import { useState, type FormEvent } from 'react'
import { Copy, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useAccess } from '@/app/access'
import { FormField } from '@/components/common/FormField'
import { NativeSelect } from '@/components/common/NativeSelect'
import { ErrorState } from '@/components/common/States'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { canInProject } from '@/domain/access'
import type { Project } from '@/domain/types'
import { errorMessage, useLoad } from '@/hooks/useLoad'
import { roleService, type RoleRow } from '@/services/roleService'
import { useSession } from '@/stores/sessionStore'
import { RoleDialog, RoleTable, type Editing } from '../roles/RoleTable'
import { Card } from './settingsUi'

/** REQ: DEC-104 — pick a project of the merchant (where the user may view its roles), then one of its Custom roles. */
function DuplicateFrom({ project, onPick, onClose }: { project: Project; onPick: (row: RoleRow) => void; onClose: () => void }) {
  const actor = useSession((s) => s.actor)
  const { account, projects } = useAccess()
  const others = projects.filter((p) => p.projectId !== project.projectId && p.merchantId === project.merchantId && !!account && canInProject(account, 'viewProjectRoles', p))
  const [projectId, setProjectId] = useState(others[0]?.projectId ?? '')
  const roles = useLoad(() => (projectId ? roleService.listProjectRoles(projectId, actor) : Promise.resolve([])), [projectId, actor.userId])
  const custom = (roles.data ?? []).filter((r) => r.type === 'CUSTOM')
  const [roleId, setRoleId] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const row = custom.find((r) => r.roleId === roleId)
    if (row) onPick(row)
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>Duplicate from another project</DialogTitle>
            <DialogDescription>Copies a Custom role of another project into {project.name}. The System Default roles are already here.</DialogDescription>
          </DialogHeader>
          <FormField id="dup-project" label="Project">
            <NativeSelect id="dup-project" value={projectId} onChange={(e) => { setProjectId(e.target.value); setRoleId('') }}>
              {!others.length && <option value="">No other project</option>}
              {others.map((p) => (
                <option key={p.projectId} value={p.projectId}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField id="dup-role" label="Role" hint={projectId && !roles.loading && !custom.length ? 'That project has no Custom roles.' : undefined}>
            <NativeSelect id="dup-role" value={roleId} onChange={(e) => setRoleId(e.target.value)} disabled={!custom.length}>
              <option value="">Choose a role</option>
              {custom.map((r) => (
                <option key={r.roleId} value={r.roleId}>
                  {r.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!roleId}>
              Continue
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ProjectRolesTab({ project }: { project: Project }) {
  const actor = useSession((s) => s.actor)
  const { account } = useAccess()
  const may = (a: 'createProjectRoles' | 'editProjectRoles' | 'changeProjectRoleStatus') => !!account && canInProject(account, a, project)
  const open = project.status === 'ACTIVE'
  // REQ: DEC-102 / DEC-78 — hide what the user's permissions never allow; an archived project is read-only.
  const can = { create: open && may('createProjectRoles'), edit: open && may('editProjectRoles'), changeStatus: open && may('changeProjectRoleStatus') }
  const rows = useLoad(() => roleService.listProjectRoles(project.projectId, actor), [project.projectId, actor.userId])
  const [editing, setEditing] = useState<Editing>()
  const [picking, setPicking] = useState(false)
  const toggle = async (r: RoleRow) => {
    const to = r.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
    if (to === 'INACTIVE' && !window.confirm(`Deactivate ${r.name}? It can no longer be given in ${project.name}.`)) return
    try {
      await roleService.setStatus(r.roleId, to, actor)
      toast.success(`${r.name} ${to === 'ACTIVE' ? 'activated' : 'deactivated'}`)
      rows.reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  if (rows.error && !rows.data) return <ErrorState message={rows.error} onRetry={rows.reload} />
  return (
    <Card title="Roles">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">Project roles are given in Members and apply in {project.name} only. Merchant roles are on the Roles screen.</p>
          {can.create && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setPicking(true)}>
                <Copy aria-hidden /> Duplicate from another project
              </Button>
              <Button onClick={() => setEditing({ mode: 'create' })}>
                <Plus aria-hidden /> New role
              </Button>
            </div>
          )}
        </div>
        <RoleTable
          label="Project roles"
          rows={rows.data ?? []}
          loading={rows.loading}
          can={can}
          onOpen={(row) => setEditing({ mode: 'edit', row })}
          onDuplicate={(from) => setEditing({ mode: 'create', from })}
          onToggle={(r) => void toggle(r)}
        />
      </div>
      {picking && (
        <DuplicateFrom
          project={project}
          onClose={() => setPicking(false)}
          onPick={(from) => {
            setPicking(false)
            setEditing({ mode: 'create', from })
          }}
        />
      )}
      {editing && (
        <RoleDialog
          key={editing.mode === 'edit' ? editing.row.roleId : `new-${editing.from?.roleId ?? ''}`}
          editing={editing}
          project={{ projectId: project.projectId, name: project.name, merchantId: project.merchantId }}
          can={can}
          onDuplicate={(from) => setEditing({ mode: 'create', from })}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined)
            rows.reload()
          }}
        />
      )}
    </Card>
  )
}

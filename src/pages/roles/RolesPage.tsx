// REQ: DEC-76 / DEC-102 / DEC-104 — [FRS] User Management › Roles: the merchant role table (given on Users; the whole
// merchant). Project roles are on each project's Settings › Roles. Super admins also see the platform roles.
import { useState } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useAccess } from '@/app/access'
import { ErrorState } from '@/components/common/States'
import { Button } from '@/components/ui/button'
import { errorMessage, useLoad } from '@/hooks/useLoad'
import { merchantService } from '@/services/merchantService'
import { roleService, type RoleRow } from '@/services/roleService'
import { useSession } from '@/stores/sessionStore'
import { RoleDialog, RoleTable, type Editing } from './RoleTable'

export function RolesPage() {
  const actor = useSession((s) => s.actor)
  const { account, allows } = useAccess()
  const isAdmin = account?.level === 'SUPER_ADMIN'
  // REQ: DEC-102 / DEC-78 — hide what the user's permissions never allow.
  const can = { create: allows({ project: 'createRoles' }), edit: allows({ project: 'editRoles' }), changeStatus: allows({ project: 'changeRoleStatus' }) }
  const rows = useLoad(() => roleService.list(actor), [actor.userId])
  const merchants = useLoad(() => merchantService.list(actor), [actor.userId])
  const [editing, setEditing] = useState<Editing>()
  const toggle = async (r: RoleRow) => {
    const to = r.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
    if (to === 'INACTIVE' && !window.confirm(`Deactivate ${r.name}? It can no longer be given to users.`)) return
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
    <div className="mx-auto max-w-[1200px] space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Roles</h1>
          <p className="text-sm text-muted-foreground">
            Merchant roles: given on Users, they apply to the whole merchant and all its projects. Project roles are on each project’s Settings › Roles.
          </p>
        </div>
        {can.create && (
          <Button onClick={() => setEditing({ mode: 'create' })}>
            <Plus aria-hidden /> New role
          </Button>
        )}
      </header>
      <RoleTable
        label="Role list"
        rows={rows.data ?? []}
        loading={rows.loading}
        can={can}
        showTypeAndMerchant={isAdmin}
        onOpen={(row) => setEditing({ mode: 'edit', row })}
        onDuplicate={(from) => setEditing({ mode: 'create', from })}
        onToggle={(r) => void toggle(r)}
      />
      {editing && (
        <RoleDialog
          key={editing.mode === 'edit' ? editing.row.roleId : `new-${editing.from?.roleId ?? ''}`}
          editing={editing}
          onDuplicate={(from) => setEditing({ mode: 'create', from })}
          can={can}
          merchants={isAdmin ? (merchants.data ?? []) : []}
          defaultMerchantId={isAdmin ? undefined : account?.merchantId}
          isSuper={isAdmin}
          ownMerchantName={(merchants.data ?? []).find((m) => m.merchantId === account?.merchantId)?.name}
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

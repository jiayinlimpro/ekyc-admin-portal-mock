// REQ: DEC-102 — the role's permissions as a matrix: one row per module, a View column and an Actions column. The checkbox
// at the module name ticks every permission of the module (partly ticked shows as "mixed"); an action keeps its View ticked.
import { groupsFor, modulePermissions, type PermissionModule } from '@/domain/permissionMatrix'
import { impliedBy, withImpliedPermissions } from '@/domain/roles'
import type { Permission, RoleAudience } from '@/domain/types'
import { PERMISSION_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'

const NEEDED = 'Ticked because an action in this row needs it'

function Box({ permission, label, value, implied, onToggle }: { permission: Permission; label: string; value: readonly Permission[]; implied: Set<Permission>; onToggle: (p: Permission, on: boolean) => void }) {
  const locked = implied.has(permission)
  return (
    <label className={cn('inline-flex items-center gap-1.5 text-sm whitespace-nowrap', locked && 'text-muted-foreground')} title={locked ? NEEDED : undefined}>
      <input type="checkbox" className="size-4 accent-primary" checked={value.includes(permission)} disabled={locked} onChange={(e) => onToggle(permission, e.target.checked)} aria-label={PERMISSION_LABELS[permission]} />
      {label}
    </label>
  )
}

function ModuleRow({ m, value, implied, onChange }: { m: PermissionModule; value: Permission[]; implied: Set<Permission>; onChange: (v: Permission[]) => void }) {
  const all = modulePermissions(m)
  const ticked = all.filter((p) => value.includes(p)).length
  const toggle = (p: Permission, on: boolean) => onChange(on ? withImpliedPermissions([...value, p]) : value.filter((x) => x !== p))
  // Unticking the module clears its row; whatever another row still needs comes back ticked.
  const toggleModule = (on: boolean) => onChange(withImpliedPermissions(on ? [...value, ...all] : value.filter((p) => !all.includes(p))))
  return (
    <tr className="border-t align-top">
      <th scope="row" className="py-2 pr-3 text-left font-medium">
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={ticked === all.length}
            ref={(el) => {
              if (el) el.indeterminate = ticked > 0 && ticked < all.length
            }}
            onChange={(e) => toggleModule(e.target.checked)}
            aria-label={`All ${m.module} permissions`}
          />
          {m.module}
        </label>
      </th>
      <td className="py-2 pr-3">{m.view ? <Box permission={m.view} label={m.viewLabel ?? 'View'} value={value} implied={implied} onToggle={toggle} /> : <span className="text-muted-foreground" aria-label="No separate View">—</span>}</td>
      <td className="py-2">
        <div className="flex flex-wrap gap-x-4 gap-y-1.5" role="group" aria-label={`${m.module} actions`}>
          {m.actions.length ? m.actions.map((x) => <Box key={x.permission} permission={x.permission} label={x.label} value={value} implied={implied} onToggle={toggle} />) : <span className="text-muted-foreground">—</span>}
        </div>
      </td>
    </tr>
  )
}

export function PermissionMatrix({ audience, value, onChange, disabled }: { audience: RoleAudience; value: Permission[]; onChange: (v: Permission[]) => void; disabled: boolean }) {
  const implied = impliedBy(value)
  return (
    <>
      {groupsFor(audience).map((g) => (
        <fieldset key={g.key} className="rounded-md border p-3" disabled={disabled}>
          <legend className="px-1 text-sm font-medium">{g.title}</legend>
          <p className="mb-2 text-xs text-muted-foreground">{g.hint}</p>
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-36 sm:w-48" />
              <col className="w-20 sm:w-36" />
              <col />
            </colgroup>
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="pb-1 font-medium">Module</th>
                <th scope="col" className="pb-1 font-medium">View</th>
                <th scope="col" className="pb-1 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {g.modules.map((m) => (
                <ModuleRow key={m.module} m={m} value={value} implied={implied} onChange={onChange} />
              ))}
            </tbody>
          </table>
        </fieldset>
      ))}
      {audience === 'PLATFORM' && <p className="text-xs text-muted-foreground">Managing staff, platform roles and super admins is for super admins only, not a permission.</p>}
    </>
  )
}

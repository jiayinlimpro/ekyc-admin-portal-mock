// REQ: DEC-102 / DEC-104 — the role's permissions as a matrix: one row per module, a View column and an Actions column. The
// checkbox at the module name ticks every permission of the module (partly ticked shows as "mixed"). Ticking a permission
// ticks what it needs; unticking one (View included) clears what depends on it.
import { dependentsOf, modulePermissions, modulesFor, type PermissionModule } from '@/domain/permissionMatrix'
import { withImpliedPermissions } from '@/domain/roles'
import type { Permission, RoleAudience } from '@/domain/types'
import { PERMISSION_LABELS } from '@/lib/labels'

/** Unticking clears the permission and everything that needs it (DEC-104). */
const without = (value: readonly Permission[], drop: readonly Permission[]) => {
  const gone = new Set(drop.flatMap((p) => [p, ...dependentsOf(p)]))
  return value.filter((p) => !gone.has(p))
}

function Box({ permission, label, value, onToggle }: { permission: Permission; label: string; value: readonly Permission[]; onToggle: (p: Permission, on: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-1.5 text-sm whitespace-nowrap">
      <input type="checkbox" className="size-4 accent-primary" checked={value.includes(permission)} onChange={(e) => onToggle(permission, e.target.checked)} aria-label={PERMISSION_LABELS[permission]} />
      {label}
    </label>
  )
}

function ModuleRow({ m, value, onChange }: { m: PermissionModule; value: Permission[]; onChange: (v: Permission[]) => void }) {
  const all = modulePermissions(m)
  const ticked = all.filter((p) => value.includes(p)).length
  const toggle = (p: Permission, on: boolean) => onChange(on ? withImpliedPermissions([...value, p]) : without(value, [p]))
  const toggleModule = (on: boolean) => onChange(on ? withImpliedPermissions([...value, ...all]) : without(value, all))
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
      <td className="py-2 pr-3">{m.view ? <Box permission={m.view} label={m.viewLabel ?? 'View'} value={value} onToggle={toggle} /> : <span className="text-muted-foreground" aria-label="No separate View">—</span>}</td>
      <td className="py-2">
        <div className="flex flex-wrap gap-x-4 gap-y-1.5" role="group" aria-label={`${m.module} actions`}>
          {m.actions.length ? m.actions.map((x) => <Box key={x.permission} permission={x.permission} label={x.label} value={value} onToggle={toggle} />) : <span className="text-muted-foreground">—</span>}
        </div>
      </td>
    </tr>
  )
}

export function PermissionMatrix({ audience, value, onChange, disabled }: { audience: RoleAudience; value: Permission[]; onChange: (v: Permission[]) => void; disabled: boolean }) {
  return (
    <fieldset className="rounded-md border p-3" disabled={disabled}>
      <legend className="px-1 text-sm font-medium">Permissions</legend>
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
          {modulesFor(audience).map((m) => (
            <ModuleRow key={m.module} m={m} value={value} onChange={onChange} />
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted-foreground">
        {audience === 'PLATFORM'
          ? 'A platform role applies to every merchant. Managing staff, platform roles and super admins is for super admins only, not a permission.'
          : 'A role with Projects, Users, Roles, Billing and contract or Merchant reports permissions can only be given on Users, not in Project › Members.'}
      </p>
    </fieldset>
  )
}

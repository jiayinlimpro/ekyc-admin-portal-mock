import { Suspense, type ComponentType } from 'react'
import { can } from '@/domain/permissions'
import { PlaceholderPage } from '@/pages/PlaceholderPage'
import { ForbiddenPage } from '@/pages/StatusPages'
import { useSession } from '@/stores/sessionStore'
import type { NavItem } from './nav'

/** Permission check (UI only, DEC-71), then the built page or its placeholder. */
export function Guarded({ item, page: Page }: { item: NavItem; page?: ComponentType }) {
  const actor = useSession((s) => s.actor)
  if (item.permission && !can(actor, item.permission)) return <ForbiddenPage page={item.label} />
  if (!Page) return <PlaceholderPage item={item} />
  return (
    <Suspense fallback={<div className="mx-auto h-40 max-w-[1400px] animate-pulse rounded-lg bg-muted" aria-busy aria-label={`Loading ${item.label}`} />}>
      <Page />
    </Suspense>
  )
}

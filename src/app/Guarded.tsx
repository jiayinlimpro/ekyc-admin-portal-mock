import { Suspense, type ComponentType } from 'react'
import { ErrorState } from '@/components/common/States'
import { PlaceholderPage } from '@/pages/PlaceholderPage'
import { ForbiddenPage } from '@/pages/StatusPages'
import { useAccess } from './access'
import type { NavItem } from './nav'

const Loading = ({ label }: { label: string }) => <div className="mx-auto h-40 max-w-[1400px] animate-pulse rounded-lg bg-muted" aria-busy aria-label={`Loading ${label}`} />

// REQ: DEC-71 / DEC-72 — access check (UI only; services check again), then the built page or its placeholder.
export function Guarded({ item, page: Page }: { item: NavItem; page?: ComponentType }) {
  const access = useAccess()
  const rule = item.access
  const waits = !!rule && !access.ready // rules need the account
  if (waits) return <Loading label={item.label} />
  if (rule && access.error) return <ErrorState message={access.error} onRetry={access.retry} />
  if (!access.allows(rule)) return <ForbiddenPage page={item.label} />
  if (!Page) return <PlaceholderPage item={item} />
  return (
    <Suspense fallback={<Loading label={item.label} />}>
      <Page />
    </Suspense>
  )
}

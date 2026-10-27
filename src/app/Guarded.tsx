import { Suspense, type ComponentType } from 'react'
import { Navigate, useSearchParams } from 'react-router'
import { EmptyState, ErrorState } from '@/components/common/States'
import { PlaceholderPage } from '@/pages/PlaceholderPage'
import { ForbiddenPage } from '@/pages/StatusPages'
import { useAccess } from './access'
import type { NavItem } from './nav'

const Loading = ({ label }: { label: string }) => <div className="mx-auto h-40 max-w-[1400px] animate-pulse rounded-lg bg-muted" aria-busy aria-label={`Loading ${label}`} />

/** REQ: DEC-109 — a link to a case opens it whatever project is chosen; the page then selects the case's project. */
const OPENS_OWN_PROJECT = '/verifications/:caseId'

// REQ: DEC-71 / DEC-72 / DEC-109 — access check (UI only; services check again), then the built page or its placeholder.
export function Guarded({ item, page: Page }: { item: NavItem; page?: ComponentType }) {
  const access = useAccess()
  const [params] = useSearchParams()
  const rule = item.access
  const inner = item.layer === 'inner'
  // ?project= on a link is applied by the shell right after this render (after ?as=): wait for it rather than leave.
  const waits = ((!!rule || inner) && !access.ready) || (inner && params.has('project'))
  if (waits) return <Loading label={item.label} />
  if ((rule || inner) && access.error) return <ErrorState message={access.error} onRetry={access.retry} />
  // REQ: DEC-73 — signed in, but no assignment covers any project yet.
  if (inner && access.account?.level === 'MERCHANT_USER' && !access.projects.length) {
    return <EmptyState title="You don’t have access to any project yet">Ask an admin of your merchant to add you to a project (Project › Members) or give you a role on the Users screen.</EmptyState>
  }
  // REQ: DEC-109 — inside a project only: without one, back to the Merchants page to choose it.
  if (inner && !access.selected && item.path !== OPENS_OWN_PROJECT) return <Navigate to="/" replace />
  // The case page checks access to the case's own project itself (the service answers not found or forbidden).
  if (item.path !== OPENS_OWN_PROJECT && !access.allows(rule)) return <ForbiddenPage page={item.label} />
  if (!Page) return <PlaceholderPage item={item} />
  return (
    <Suspense fallback={<Loading label={item.label} />}>
      <Page />
    </Suspense>
  )
}

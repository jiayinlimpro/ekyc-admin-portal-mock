import { Link, useNavigate } from 'react-router'
import { MoreVertical } from 'lucide-react'
import { RiskBadge } from '@/components/common/RiskBadge'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ClaimedByCell, ClaimExpiresCell } from '@/components/verification/ClaimedByCell'
import type { VerificationSummary } from '@/domain/types'
import { useNow } from '@/hooks/useNow'
import { formatMyt } from '@/lib/format'
import { DOCUMENT_TYPE_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'

type Column = 'Reference ID' | 'Full Name' | 'Project' | 'Flow' | 'Version' | 'Document' | 'Status' | 'Risk Level' | 'Claimed By' | 'Claim expires' | 'Created' | 'Last Updated By' | 'Last updated'

// Sticky first column: the table scrolls sideways on narrow screens, the Reference ID stays visible.
const STICKY = 'sticky left-0 z-10 bg-card group-hover:bg-muted'

function UpdatedBy({ row }: { row: VerificationSummary }) {
  if (row.lastUpdatedBy.kind === 'SYSTEM') return <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] tracking-wide">SYSTEM</span>
  return (
    <div className="leading-tight">
      <div className="whitespace-nowrap">{row.lastUpdatedBy.fullName}</div>
      <div className="text-xs text-muted-foreground">{row.lastUpdatedBy.userId}</div>
    </div>
  )
}

function When({ iso }: { iso: string }) {
  const [day, time] = formatMyt(iso).split(', ')
  return (
    <div className="leading-tight whitespace-nowrap">
      <div>{day}</div>
      <div className="text-xs text-muted-foreground">{time} MYT</div>
    </div>
  )
}

function RowActions({ referenceNo }: { referenceNo: string }) {
  const navigate = useNavigate()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${referenceNo}`}>
            <MoreVertical aria-hidden />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-32">
        <DropdownMenuItem onClick={() => navigate(`/verifications/${referenceNo}`)}>View</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * REQ: DEC-40 — Project only when more than one project is in view; Risk Level only when a flow in view runs risk.
 * No PII beyond Full Name, no client metadata, no duplicate-user information.
 */
export function VerificationTable({
  rows,
  currentUserId,
  loading,
  skeletonRows,
  showProject,
  showRisk,
}: {
  rows: VerificationSummary[]
  currentUserId: string
  loading: boolean
  skeletonRows?: number
  showProject: boolean
  showRisk: boolean
}) {
  const now = useNow(1000) // drives the claim countdowns
  type Cell = [Column, (r: VerificationSummary) => React.ReactNode, boolean?]
  const all: Cell[] = [
    ['Full Name', (r) => <span className="block min-w-36">{r.fullName}</span>],
    ['Project', (r) => <span className="whitespace-nowrap">{r.projectName}</span>, showProject],
    ['Flow', (r) => <span className="whitespace-nowrap">{r.flowName}</span>],
    ['Version', (r) => r.workflowVersion],
    ['Document', (r) => <span className="whitespace-nowrap">{DOCUMENT_TYPE_LABELS[r.documentType]}</span>],
    ['Status', (r) => <StatusBadge status={r.status} />],
    ['Risk Level', (r) => <RiskBadge level={r.riskLevel} />, showRisk],
    ['Claimed By', (r) => <ClaimedByCell row={r} now={now} currentUserId={currentUserId} />],
    ['Claim expires', (r) => <ClaimExpiresCell row={r} now={now} />],
    ['Created', (r) => <When iso={r.createdAt} />],
    ['Last Updated By', (r) => <UpdatedBy row={r} />],
    ['Last updated', (r) => <When iso={r.lastUpdatedAt} />],
  ]
  const cells = all.filter(([, , show]) => show !== false)
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full text-sm transition-opacity', loading && rows.length > 0 && 'opacity-60')} aria-busy={loading}>
        <caption className="sr-only">Verifications. Personal data other than Full Name is shown on the detail page only.</caption>
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="sticky left-0 z-10 bg-muted px-2.5 py-2 font-medium whitespace-nowrap">
              Reference ID
            </th>
            {cells.map(([c]) => (
              <th key={c} scope="col" className="px-2.5 py-2 font-medium whitespace-nowrap">
                {c}
              </th>
            ))}
            <th scope="col" className="px-2.5 py-2">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 &&
            loading &&
            Array.from({ length: skeletonRows ?? 8 }, (_, i) => (
              <tr key={i} className="border-t" aria-hidden>
                {Array.from({ length: cells.length + 2 }, (_, c) => (
                  <td key={c} className="px-2.5 py-3">
                    <div className="h-3.5 w-full max-w-28 animate-pulse rounded bg-muted" />
                  </td>
                ))}
              </tr>
            ))}
          {rows.map((r) => (
            <tr key={r.referenceNo} className="group border-t hover:bg-muted">
              <th scope="row" className={cn('px-2.5 py-2 text-left font-normal', STICKY)}>
                <Link to={`/verifications/${r.referenceNo}`} className="font-mono text-xs whitespace-nowrap text-blue-700 underline-offset-2 hover:underline dark:text-blue-400">
                  {r.referenceNo}
                </Link>
              </th>
              {cells.map(([c, render]) => (
                <td key={c} className="px-2.5 py-2">
                  {render(r)}
                </td>
              ))}
              <td className="px-1 py-2 text-right">
                <RowActions referenceNo={r.referenceNo} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

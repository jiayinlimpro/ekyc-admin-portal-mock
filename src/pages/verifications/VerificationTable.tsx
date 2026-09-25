import { Link, useNavigate } from 'react-router'
import { MoreVertical } from 'lucide-react'
import { RiskBadge } from '@/components/common/RiskBadge'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ClaimedByCell } from '@/components/verification/ClaimedByCell'
import type { VerificationSummary } from '@/domain/types'
import { useNow } from '@/hooks/useNow'
import { formatMyt } from '@/lib/format'
import { DOCUMENT_TYPE_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'

const COLUMNS = ['Reference No', 'Merchant', 'Full Name', 'Document', 'Status', 'Risk Level', 'Claimed By', 'Last Updated By', 'Last Updated At'] as const

// Sticky first column: the table scrolls sideways on narrow screens, the Reference No stays visible.
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

export function VerificationTable({ rows, currentUserId, loading, skeletonRows }: { rows: VerificationSummary[]; currentUserId: string; loading: boolean; skeletonRows?: number }) {
  const now = useNow(1000) // drives the Claimed By countdowns
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full text-sm transition-opacity', loading && rows.length > 0 && 'opacity-60')} aria-busy={loading}>
        <caption className="sr-only">Verifications. Personal data other than Full Name is shown on the detail page only.</caption>
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            {COLUMNS.map((c, i) => (
              <th key={c} scope="col" className={cn('px-2.5 py-2 font-medium whitespace-nowrap', i === 0 && 'sticky left-0 z-10 bg-muted')}>
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
                {[...COLUMNS, ''].map((c) => (
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
              <td className="px-2.5 py-2">
                <div className="whitespace-nowrap">{r.merchantName}</div>
                <div className="text-xs text-muted-foreground">{r.workflowVersion}</div>
              </td>
              <td className="min-w-36 px-2.5 py-2">{r.fullName}</td>
              <td className="px-2.5 py-2 whitespace-nowrap">{DOCUMENT_TYPE_LABELS[r.documentType]}</td>
              <td className="px-2.5 py-2">
                <StatusBadge status={r.status} />
              </td>
              <td className="px-2.5 py-2">
                <RiskBadge level={r.riskLevel} />
              </td>
              <td className="px-2.5 py-2">
                <ClaimedByCell row={r} now={now} currentUserId={currentUserId} />
              </td>
              <td className="px-2.5 py-2">
                <UpdatedBy row={r} />
              </td>
              <td className="px-2.5 py-2 leading-tight whitespace-nowrap">
                <div>{formatMyt(r.lastUpdatedAt).split(', ')[0]}</div>
                <div className="text-xs text-muted-foreground">{formatMyt(r.lastUpdatedAt).split(', ')[1]} MYT</div>
              </td>
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

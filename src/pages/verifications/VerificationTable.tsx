import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { Link } from 'react-router'
import { RiskBadge } from '@/components/common/RiskBadge'
import { StatusBadge } from '@/components/common/StatusBadge'
import { ClaimedByCell } from '@/components/verification/ClaimedByCell'
import type { VerificationSummary } from '@/domain/types'
import { useNow } from '@/hooks/useNow'
import { formatMyt } from '@/lib/format'
import { DOCUMENT_TYPE_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import type { VerificationSort, VerificationSortKey } from '@/services/verificationService'

type Column = 'Full Name' | 'Project' | 'Flow' | 'Document' | 'Status' | 'Risk Level' | 'Claimed By' | 'Created (MYT)' | 'Last updated (MYT)'

// Sticky first column: on narrow screens the table still scrolls sideways, with the Reference ID visible.
// REQ: DEC-40 — related values share a column (second line) so the list fits a desktop screen without scrolling.
const STICKY = 'sticky left-0 z-10 bg-card group-hover:bg-muted'

// REQ: DEC-100 — the FRS sortable columns; Full Name, Merchant and the rest are not sortable.
const SORT_KEY: Partial<Record<Column | 'Reference ID', VerificationSortKey>> = {
  'Reference ID': 'referenceNo',
  Status: 'status',
  'Risk Level': 'riskLevel',
  'Last updated (MYT)': 'lastUpdatedAt',
}

/** REQ: DEC-100 — a column name that sorts on click (ascending → descending → default), with its state as an icon. */
function HeaderCell({ name, sort, onSort, className }: { name: Column | 'Reference ID'; sort?: VerificationSort; onSort?: (by: VerificationSortKey) => void; className?: string }) {
  const key = SORT_KEY[name]
  const th = cn('px-2 py-2 font-medium whitespace-nowrap', className)
  if (!key || !onSort) {
    return (
      <th scope="col" className={th}>
        {name}
      </th>
    )
  }
  const dir = sort?.by === key ? sort.dir : undefined
  const Icon = dir === 'asc' ? ArrowUp : dir === 'desc' ? ArrowDown : ChevronsUpDown
  const next = dir === 'asc' ? 'sort descending' : dir === 'desc' ? 'back to the default order' : 'sort ascending'
  return (
    <th scope="col" className={th} aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}>
      <button type="button" onClick={() => onSort(key)} title={`Click to ${next}`} className={cn('-mx-1 inline-flex items-center gap-1 rounded px-1 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none', dir && 'text-foreground')}>
        {name}
        <Icon aria-hidden className={cn('size-3.5', !dir && 'opacity-50')} />
      </button>
    </th>
  )
}

function When({ iso }: { iso: string }) {
  const [day, time] = formatMyt(iso).split(', ')
  return (
    <div className="leading-tight whitespace-nowrap">
      <div>{day}</div>
      <div className="text-xs text-muted-foreground">{time}</div>
    </div>
  )
}

/** "Last updated": when, then by whom (SYSTEM or the user; manual vs automated, DEC-03). */
function LastUpdated({ row }: { row: VerificationSummary }) {
  const by = row.lastUpdatedBy
  const [day, time] = formatMyt(row.lastUpdatedAt).split(', ')
  return (
    <div className="leading-tight">
      <div className="whitespace-nowrap">{day}</div>
      <div className="max-w-36 text-xs text-muted-foreground">
        {time} ·{' '}
        {by.kind === 'SYSTEM' ? (
          <span className="rounded bg-muted px-1 font-mono text-[10px] tracking-wide text-foreground">SYSTEM</span>
        ) : (
          <span title={by.userId}>{by.fullName}</span>
        )}
      </div>
    </div>
  )
}

const TwoLines = ({ top, sub }: { top: React.ReactNode; sub?: React.ReactNode }) => (
  <div className="leading-tight">
    <div className="whitespace-nowrap">{top}</div>
    {sub && <div className="text-xs whitespace-nowrap text-muted-foreground">{sub}</div>}
  </div>
)

/**
 * REQ: DEC-40 — Project only when more than one project is in view (with the merchant when rows span merchants); Risk
 * Level only when a flow in view runs risk. No PII beyond Full Name, no client metadata, no duplicate-user information.
 */
export function VerificationTable({
  rows,
  currentUserId,
  loading,
  skeletonRows,
  showProject,
  showRisk,
  showMerchant = false,
  sort,
  onSort,
}: {
  rows: VerificationSummary[]
  currentUserId: string
  loading: boolean
  skeletonRows?: number
  showProject: boolean
  showRisk: boolean
  /** Super admin across merchants: the merchant under the project ("Default" exists in every merchant). */
  showMerchant?: boolean
  /** REQ: DEC-100 — the column sort; undefined = the default order. Without `onSort` the headers don't sort. */
  sort?: VerificationSort
  onSort?: (by: VerificationSortKey) => void
}) {
  const now = useNow(1000) // drives the claim countdowns
  type Cell = [Column, (r: VerificationSummary) => React.ReactNode, boolean?]
  const all: Cell[] = [
    ['Full Name', (r) => <span className="block min-w-28">{r.fullName}</span>],
    ['Project', (r) => <TwoLines top={r.projectName} sub={showMerchant ? r.merchantName : undefined} />, showProject || showMerchant],
    ['Flow', (r) => <TwoLines top={r.flowName} sub={r.workflowVersion} />],
    ['Document', (r) => <span className="whitespace-nowrap">{DOCUMENT_TYPE_LABELS[r.documentType]}</span>],
    ['Status', (r) => <StatusBadge status={r.status} />],
    ['Risk Level', (r) => <RiskBadge level={r.riskLevel} />, showRisk],
    ['Claimed By', (r) => <ClaimedByCell row={r} now={now} currentUserId={currentUserId} />],
    ['Created (MYT)', (r) => <When iso={r.createdAt} />],
    ['Last updated (MYT)', (r) => <LastUpdated row={r} />],
  ]
  const cells = all.filter(([, , show]) => show !== false)
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full text-sm transition-opacity', loading && rows.length > 0 && 'opacity-60')} aria-busy={loading}>
        <caption className="sr-only">Verifications. Personal data other than Full Name is shown on the detail page only.</caption>
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <HeaderCell name="Reference ID" sort={sort} onSort={onSort} className="sticky left-0 z-10 bg-muted" />
            {cells.map(([c]) => (
              <HeaderCell key={c} name={c} sort={sort} onSort={onSort} />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 &&
            loading &&
            Array.from({ length: skeletonRows ?? 8 }, (_, i) => (
              <tr key={i} className="border-t" aria-hidden>
                {Array.from({ length: cells.length + 1 }, (_, c) => (
                  <td key={c} className="px-2 py-3">
                    <div className="h-3.5 w-full max-w-28 animate-pulse rounded bg-muted" />
                  </td>
                ))}
              </tr>
            ))}
          {rows.map((r) => (
            <tr key={r.referenceNo} className="group border-t hover:bg-muted">
              <th scope="row" className={cn('px-2 py-2 text-left font-normal', STICKY)}>
                <Link to={`/verifications/${r.caseId}`} className="font-mono text-xs whitespace-nowrap text-blue-700 underline-offset-2 hover:underline dark:text-blue-400">
                  {r.referenceNo}
                </Link>
              </th>
              {cells.map(([c, render]) => (
                <td key={c} className="px-2 py-2">
                  {render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

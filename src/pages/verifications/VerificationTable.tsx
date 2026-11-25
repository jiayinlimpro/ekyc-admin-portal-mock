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

type Column = 'Reference ID' | 'Full Name' | 'Project' | 'Flow' | 'Status' | 'Risk' | 'Claimed By' | 'Created (MYT)' | 'Last updated (MYT)'

// Sticky first column: on narrow screens the table still scrolls sideways, with the Verification ID visible.
// REQ: DEC-40 — related values share a column (second line) so the list fits a desktop screen without scrolling.
const STICKY = 'sticky left-0 z-10 bg-card group-hover:bg-muted'

// REQ: DEC-100 — sortable: Status, Risk, Last updated. Never the IDs (DEC-114), Full Name or Merchant.
const SORT_KEY: Partial<Record<Column, VerificationSortKey>> = {
  Status: 'status',
  Risk: 'riskResult',
  'Last updated (MYT)': 'lastUpdatedAt',
}

/** REQ: DEC-100 — a column name that sorts on click (ascending → descending → default), with its state as an icon. */
function HeaderCell({ name, sort, onSort, className }: { name: Column; sort?: VerificationSort; onSort?: (by: VerificationSortKey) => void; className?: string }) {
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
 * (Low risk / High risk, DEC-107) only when a flow in view runs risk. No PII beyond Full Name, no client metadata, no duplicate-user information.
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
  canOpen = () => true,
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
  /** REQ: DEC-104 — whether the Verification ID links to the case page (View details); otherwise plain text. */
  canOpen?: (row: VerificationSummary) => boolean
}) {
  const now = useNow(1000) // drives the claim countdowns
  type Cell = [Column, (r: VerificationSummary) => React.ReactNode, boolean?]
  const all: Cell[] = [
    // REQ: DEC-114 — the merchant's Reference ID in its own column, after our Verification ID; not sortable (DEC-100).
    ['Reference ID', (r) => <span className="font-mono text-xs whitespace-nowrap">{r.referenceId}</span>],
    ['Full Name', (r) => <span className="block max-w-28 text-xs">{r.fullName}</span>],
    ['Project', (r) => <TwoLines top={r.projectName} sub={showMerchant ? r.merchantName : undefined} />, showProject || showMerchant],
    // REQ: DEC-40 — the workflow and the document type share the Flow cell's second line ("W4 · MyKad").
    // The flow name gets room for one line; Full Name is smaller and wraps instead, so the list fits 1440 px (DEC-40).
    ['Flow', (r) => <TwoLines top={<span className="block min-w-36 max-w-44 whitespace-normal">{r.flowName}</span>} sub={`${r.workflowVersion} · ${DOCUMENT_TYPE_LABELS[r.documentType]}`} />],
    ['Status', (r) => <StatusBadge status={r.status} />],
    ['Risk', (r) => <RiskBadge result={r.riskResult} />, showRisk],
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
            {/* REQ: DEC-114 — our Verification ID first (pinned, opens the case), then the merchant's Reference ID. */}
            <th scope="col" className="sticky left-0 z-10 bg-muted px-2 py-2 font-medium whitespace-nowrap">
              Verification ID
            </th>
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
            <tr key={r.verificationId} className="group border-t hover:bg-muted">
              <th scope="row" className={cn('px-2 py-2 text-left font-normal', STICKY)}>
                {canOpen(r) ? (
                  <Link to={`/verifications/${r.verificationId}`} className="font-mono text-xs whitespace-nowrap text-blue-700 underline-offset-2 hover:underline dark:text-blue-400">
                    {r.verificationId}
                  </Link>
                ) : (
                  <span className="font-mono text-xs whitespace-nowrap" title="Needs View details to open">
                    {r.verificationId}
                  </span>
                )}
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

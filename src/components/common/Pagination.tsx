import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NativeSelect } from './NativeSelect'

export function Pagination({
  page,
  pageSize,
  total,
  pageSizes,
  onPage,
  onPageSize,
}: {
  page: number
  pageSize: number
  total: number
  pageSizes: readonly number[]
  onPage: (page: number) => void
  onPageSize: (size: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1
  const last = Math.min(total, page * pageSize)
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
      <p className="text-muted-foreground" aria-live="polite">
        {total === 0 ? 'No results' : `Showing ${first}–${last} of ${total}`}
      </p>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-muted-foreground">
          Rows per page
          <NativeSelect value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} className="w-20">
            {pageSizes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </NativeSelect>
        </label>
        <span className="text-muted-foreground">
          Page {Math.min(page, pages)} of {pages}
        </span>
        <div className="flex gap-1">
          <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            <ChevronLeft aria-hidden />
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}>
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>
    </nav>
  )
}

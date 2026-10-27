import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Download } from 'lucide-react'
import { DataTable, StatTile } from '@/components/charts/ChartKit'
import { fmtInt } from '@/components/charts/numbers'
import { NativeSelect } from '@/components/common/NativeSelect'
import { OpenQuestionTag } from '@/components/common/OpenQuestionTag'
import { Pagination } from '@/components/common/Pagination'
import { StatusBadge } from '@/components/common/StatusBadge'
import { EmptyState, ErrorState } from '@/components/common/States'
import { Button } from '@/components/ui/button'
import type { BillingTotals } from '@/domain/dashboards'
import { useLoad } from '@/hooks/useLoad'
import { formatMyt } from '@/lib/format'
import { STATUS_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { analyticsService, type BillingReport } from '@/services/analyticsService'
import { useDashboardScope } from '../dashboard/dashboardScope'
import { useAccess } from '@/app/access'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const periodLabel = (p: string) => `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`
const money = (n: number) => `RM ${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const PAGE_SIZES = [25, 50, 100] as const

function csvFor(r: BillingReport, names: { projectName: (id: string) => string; flowName: (id: string) => string }) {
  const cell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v))
  const head = ['Reference ID', 'Case ID', 'Project', 'Flow', 'Created (MYT)', 'Verification Status', 'Workflow', 'Tokens', 'Retry tokens', 'Cost (RM)']
  const rows = r.lines.map((l) => [l.referenceNo, l.caseId, names.projectName(l.projectId), names.flowName(l.flowId), formatMyt(l.chargedAt), STATUS_LABELS[l.status], l.workflowVersion, l.tokens, l.retryTokens, l.cost.toFixed(2)])
  return [head, ...rows].map((row) => row.map(cell).join(',')).join('\n')
}

function ByTable({ title, rows, name }: { title: string; rows: (BillingTotals & { key: string })[]; name: (k: string) => string }) {
  return (
    <section aria-label={title} className="rounded-lg border bg-card">
      <h2 className="border-b px-4 py-2.5 text-sm font-semibold">{title}</h2>
      <div className="p-4">
        <DataTable caption={title} columns={['Name', 'Verifications', 'Tokens', 'Retry tokens', 'Cost', 'Cost of retries']} rows={rows.map((r) => [name(r.key), fmtInt(r.verifications), fmtInt(r.tokens), fmtInt(r.retryTokens), money(r.cost), money(r.retryCost)])} />
      </div>
    </section>
  )
}

// REQ: DEC-60 / DEC-86 — tokens per document (OCR) and liveness submission, whatever the final status; by project and flow; every role, scoped.
export function BillingPage() {
  const d = useDashboardScope()
  const [sp, setSp] = useSearchParams()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(50)
  const periods = useLoad(() => analyticsService.billingPeriods(d.actor), [d.actor.userId])
  const period = periods.data?.includes(sp.get('period') ?? '') ? sp.get('period')! : periods.data?.[0]
  const report = useLoad(() => (period ? analyticsService.billing({ period, ...d.scope }, d.actor) : Promise.resolve(undefined)), [period, d.key, d.actor.userId])

  // REQ: DEC-99 — exports need Export (staff: Usage reports · Export). Hooks before the early return.
  const canExport = useAccess().allows({ project: 'exportReports' })

  const error = periods.error ?? report.error
  if (error && !report.data) return <ErrorState message={error} onRetry={() => (periods.error ? periods.reload() : report.reload())} />
  const r = report.data
  const t = r?.totals
  const loading = report.loading

  const exportCsv = () => {
    if (!r) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([`﻿${csvFor(r, d.names)}`], { type: 'text/csv;charset=utf-8' }))
    a.download = `billing-${r.period}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Billing</h1>
          <p className="text-sm text-muted-foreground">{d.label} · one token per document (OCR) submission and per liveness submission, whatever the case’s status. Retakes before submitting are free.</p>
        </div>
        {canExport && (
          <Button variant="outline" disabled={!r?.lines.length} onClick={exportCsv}>
            <Download aria-hidden /> Export CSV
          </Button>
        )}
      </header>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        {d.bar}
        <label className="text-xs font-medium text-muted-foreground">
          Billing month
          <NativeSelect value={period ?? ''} className="mt-1 w-48" onChange={(e) => { setPage(1); setSp((p) => { p.set('period', e.target.value); return p }) }}>
            {periods.data?.map((p) => (
              <option key={p} value={p}>
                {periodLabel(p)}
              </option>
            ))}
          </NativeSelect>
        </label>
        <span className="flex items-center gap-2 pb-2 text-xs text-muted-foreground">
          {r ? `${money(r.tokenPrice)} per token` : ''} <OpenQuestionTag id="OQ-14" />
        </span>
      </div>

      <div className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-4 transition-opacity', loading && r && 'opacity-60')} aria-busy={loading}>
        <StatTile label="Verifications" value={t ? fmtInt(t.verifications) : '—'} note="Including Processing and Rejected" />
        <StatTile label="Tokens" value={t ? fmtInt(t.tokens) : '—'} note="Document and liveness submissions" />
        <StatTile label="Cost of Retries" value={t ? money(t.retryCost) : '—'} note={t ? `${fmtInt(t.retryTokens)} submissions after the first in a phase` : undefined} />
        <StatTile label="Total" value={t ? money(t.cost) : '—'} note={period ? periodLabel(period) : undefined} />
      </div>

      {r && r.byMerchant.length > 1 && <ByTable title="By merchant" rows={r.byMerchant} name={d.names.merchantName} />}
      {r && r.byProject.length > 1 && <ByTable title="By project" rows={r.byProject} name={d.names.projectName} />}
      {r && r.byFlow.length > 1 && <ByTable title="By flow" rows={r.byFlow} name={d.names.flowName} />}

      <section aria-label="Line items" className="rounded-lg border bg-card">
        <h2 className="border-b px-4 py-2.5 text-sm font-semibold">Line items</h2>
        {r && !r.lines.length ? (
          <EmptyState title="Nothing charged this month" />
        ) : (
          <div className="overflow-x-auto">
            <table className={cn('w-full text-sm', loading && r && 'opacity-60')} aria-busy={loading}>
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  {['Reference ID', 'Project', 'Flow', 'Created (MYT)', 'Verification Status', 'Tokens', 'Retry tokens', 'Cost'].map((h, i) => (
                    <th key={h} scope="col" className={cn('px-3 py-2 font-medium whitespace-nowrap', i >= 5 && 'text-right')}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!r &&
                  Array.from({ length: 8 }, (_, i) => (
                    <tr key={i} className="border-t" aria-hidden>
                      <td colSpan={8} className="px-3 py-3">
                        <div className="h-3.5 animate-pulse rounded bg-muted" />
                      </td>
                    </tr>
                  ))}
                {r?.lines.slice((page - 1) * pageSize, page * pageSize).map((l) => (
                  <tr key={l.referenceNo} className="border-t">
                    <td className="px-3 py-2">
                      <Link to={`/verifications/${l.caseId}`} className="font-mono text-xs text-blue-700 hover:underline dark:text-blue-400">
                        {l.referenceNo}
                      </Link>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{d.names.projectName(l.projectId)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {d.names.flowName(l.flowId)} <span className="text-xs text-muted-foreground">{l.workflowVersion}</span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatMyt(l.chargedAt)}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={l.status} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.tokens}</td>
                    <td className={cn('px-3 py-2 text-right tabular-nums', !l.retryTokens && 'text-muted-foreground')}>{l.retryTokens}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{money(l.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {r && r.lines.length > 0 && (
          <div className="border-t">
            <Pagination page={page} pageSize={pageSize} total={r.lines.length} pageSizes={PAGE_SIZES} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1) }} />
          </div>
        )}
      </section>
    </div>
  )
}

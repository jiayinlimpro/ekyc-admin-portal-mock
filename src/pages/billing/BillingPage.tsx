import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Download } from 'lucide-react'
import { StatTile } from '@/components/charts/ChartKit'
import { fmtInt } from '@/components/charts/numbers'
import { NativeSelect } from '@/components/common/NativeSelect'
import { OpenQuestionTag } from '@/components/common/OpenQuestionTag'
import { Pagination } from '@/components/common/Pagination'
import { StatusBadge } from '@/components/common/StatusBadge'
import { EmptyState, ErrorState } from '@/components/common/States'
import { Switch } from '@/components/common/Switch'
import { Button } from '@/components/ui/button'
import { POLICY, PRICING } from '@/domain/openQuestions'
import { useScope } from '@/hooks/useScope'
import { formatMyt } from '@/lib/format'
import { STATUS_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { analyticsService, type BillingReport } from '@/services/analyticsService'
import { isServiceError } from '@/services/errors'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const periodLabel = (p: string) => `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`
const money = (n: number) => `RM ${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const PAGE_SIZES = [25, 50, 100] as const

function csvFor(r: BillingReport, merchantName: (id: string) => string) {
  const cell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v))
  const head = ['Reference No', 'Merchant', 'Charged on (MYT)', 'Verification Status', 'Workflow', 'Attempts', 'User retakes', 'Base (RM)', 'Cost of Retries (RM)', 'Total (RM)']
  const rows = r.lines.map((l) => [l.referenceNo, merchantName(l.merchantId), formatMyt(l.chargedAt), STATUS_LABELS[l.status], l.workflowVersion, l.attempts, l.userRetakes, l.base.toFixed(2), l.retries.toFixed(2), l.total.toFixed(2)])
  return [head, ...rows].map((row) => row.map(cell).join(',')).join('\n')
}

export function BillingPage() {
  const { actor, scope, label, merchantName } = useScope()
  const [sp, setSp] = useSearchParams()
  const [periods, setPeriods] = useState<string[]>()
  const [chargePerAttempt, setChargePerAttempt] = useState(POLICY.chargePerAttempt)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(50)
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<{ request: string; data?: BillingReport; error?: string }>({ request: '' })

  useEffect(() => {
    let live = true
    analyticsService.billingPeriods(actor).then(
      (p) => live && setPeriods(p),
      (e: unknown) => live && setResult({ request: 'periods', error: isServiceError(e) ? e.message : 'Unexpected error.' }),
    )
    return () => {
      live = false
    }
  }, [actor])

  const period = periods?.includes(sp.get('period') ?? '') ? sp.get('period')! : periods?.[0]
  const request = JSON.stringify([period, scope, chargePerAttempt, actor.userId, retry])

  useEffect(() => {
    if (!period) return
    let live = true
    analyticsService.billing({ period, merchantId: scope, chargePerAttempt }, actor).then(
      (data) => live && setResult({ request, data }),
      (e: unknown) => live && setResult({ request, error: isServiceError(e) ? e.message : 'Unexpected error.' }),
    )
    return () => {
      live = false
    }
  }, [request, period, scope, chargePerAttempt, actor])

  if (result.error) return <ErrorState message={result.error} onRetry={() => setRetry((n) => n + 1)} />
  const loading = result.request !== request
  const r = result.data
  const t = r?.totals

  const exportCsv = () => {
    if (!r) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([`﻿${csvFor(r, merchantName)}`], { type: 'text/csv;charset=utf-8' }))
    a.download = `billing-${r.period}${scope ? `-${scope}` : ''}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Billing</h1>
          <p className="text-sm text-muted-foreground">{label} · every verification is charged when the end user enters the flow, whatever its status.</p>
        </div>
        <Button variant="outline" disabled={!r?.lines.length} onClick={exportCsv}>
          <Download aria-hidden /> Export CSV
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-2 text-sm">
          Billing month
          <NativeSelect value={period ?? ''} className="w-48" onChange={(e) => { setPage(1); setSp({ period: e.target.value }) }}>
            {periods?.map((p) => (
              <option key={p} value={p}>
                {periodLabel(p)}
              </option>
            ))}
          </NativeSelect>
        </label>
        <div className="flex items-center gap-2 text-sm">
          <Switch checked={chargePerAttempt} onChange={setChargePerAttempt} label="Charge user retakes per attempt" />
          <span>Charge user retakes per attempt</span>
          <OpenQuestionTag id="OQ-07" />
        </div>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          Prices: {money(PRICING.perVerification.V1)} (V1) · {money(PRICING.perVerification.V4)} (V4) · {money(PRICING.perRetake)} per retake <OpenQuestionTag id="OQ-14" />
        </span>
      </div>

      <div className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-4 transition-opacity', loading && r && 'opacity-60')} aria-busy={loading}>
        <StatTile label="Verifications charged" value={t ? fmtInt(t.verifications) : '—'} note="Including Processing and Rejected" />
        <StatTile label="Verification charges" value={t ? money(t.base) : '—'} />
        <StatTile label="Cost of Retries" value={t ? money(t.retries) : '—'} note={t ? `${fmtInt(t.userRetakes)} user retakes · ${r?.chargePerAttempt ? `${money(PRICING.perRetake)} each` : 'not charged (OQ-07 = no)'}` : undefined} />
        <StatTile label="Total" value={t ? money(t.total) : '—'} note={period ? periodLabel(period) : undefined} />
      </div>

      {r && r.byMerchant.length > 1 && (
        <section aria-label="By merchant" className="rounded-lg border bg-card">
          <h2 className="border-b px-4 py-2.5 text-sm font-semibold">By merchant</h2>
          <div className="overflow-x-auto p-4">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  {['Merchant', 'Verifications', 'User retakes', 'Verification charges', 'Cost of Retries', 'Total'].map((h, i) => (
                    <th key={h} scope="col" className={cn('py-1.5 pr-4 font-medium', i > 0 && 'text-right')}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.byMerchant.map((m) => (
                  <tr key={m.merchantId} className="border-t">
                    <th scope="row" className="py-1.5 pr-4 text-left font-normal">{merchantName(m.merchantId)}</th>
                    <td className="py-1.5 pr-4 text-right tabular-nums">{fmtInt(m.verifications)}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">{fmtInt(m.userRetakes)}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">{money(m.base)}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">{money(m.retries)}</td>
                    <td className="py-1.5 pr-4 text-right font-medium tabular-nums">{money(m.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section aria-label="Line items" className="rounded-lg border bg-card">
        <h2 className="border-b px-4 py-2.5 text-sm font-semibold">Line items</h2>
        {r && !r.lines.length ? (
          <EmptyState title="Nothing charged this month" />
        ) : (
          <div className="overflow-x-auto">
            <table className={cn('w-full text-sm', loading && r && 'opacity-60')} aria-busy={loading}>
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  {['Reference No', 'Merchant', 'Charged on (MYT)', 'Verification Status', 'Attempts', 'User retakes', 'Verification', 'Cost of Retries', 'Total'].map((h, i) => (
                    <th key={h} scope="col" className={cn('px-3 py-2 font-medium whitespace-nowrap', i >= 4 && 'text-right')}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!r && Array.from({ length: 8 }, (_, i) => (
                  <tr key={i} className="border-t" aria-hidden><td colSpan={9} className="px-3 py-3"><div className="h-3.5 animate-pulse rounded bg-muted" /></td></tr>
                ))}
                {r?.lines.slice((page - 1) * pageSize, page * pageSize).map((l) => (
                  <tr key={l.referenceNo} className="border-t">
                    <td className="px-3 py-2">
                      <Link to={`/verifications/${l.referenceNo}`} className="font-mono text-xs text-blue-700 hover:underline dark:text-blue-400">{l.referenceNo}</Link>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{merchantName(l.merchantId)} <span className="text-xs text-muted-foreground">{l.workflowVersion}</span></td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatMyt(l.chargedAt)}</td>
                    <td className="px-3 py-2"><StatusBadge status={l.status} /></td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.attempts}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.userRetakes}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(l.base)}</td>
                    <td className={cn('px-3 py-2 text-right tabular-nums', !l.retries && 'text-muted-foreground')}>{money(l.retries)}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{money(l.total)}</td>
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

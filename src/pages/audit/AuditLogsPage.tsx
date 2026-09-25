import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Download, RotateCcw, Search } from 'lucide-react'
import { toast } from 'sonner'
import { NativeSelect } from '@/components/common/NativeSelect'
import { Pagination } from '@/components/common/Pagination'
import { EmptyState, ErrorState } from '@/components/common/States'
import { ToggleChips } from '@/components/common/ToggleChips'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { can } from '@/domain/permissions'
import { AUDIT_ACTIONS, type AuditAction, type AuditEntry, type Merchant, type Paged } from '@/domain/types'
import { auditCsv, summarizeAudit } from '@/lib/auditFormat'
import { formatMyt } from '@/lib/format'
import { AUDIT_ACTION_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { auditService } from '@/services/auditService'
import { isServiceError } from '@/services/errors'
import { merchantService } from '@/services/merchantService'
import { userService, type UserSummary } from '@/services/userService'
import { ALL_MERCHANTS, useSession } from '@/stores/sessionStore'
import { AUDIT_PAGE_SIZES, EMPTY_AUDIT_FILTERS, parseAuditParams, toAuditQuery, toAuditSearch, type AuditFilters, type AuditParams } from './auditQuery'

const ACTION_OPTIONS = AUDIT_ACTIONS.map((a) => ({ value: a, label: AUDIT_ACTION_LABELS[a] }))

const ACTION_TONE: Partial<Record<AuditAction, string>> = {
  PII_VIEW: 'bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-200',
  DECISION: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-200',
  OWNERSHIP_CONFLICT: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200',
  CLAIM_TIMEOUT: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
  CONFIG_DEPLOY: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-200',
  CREDENTIAL_ROTATION: 'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200',
}

type Result = { request: string; data?: Paged<AuditEntry>; error?: string }

function Filters({ initial, onSearch, onReset, merchants, users, showMerchant }: { initial: AuditFilters; onSearch: (f: AuditFilters) => void; onReset: () => void; merchants: Merchant[]; users: UserSummary[]; showMerchant: boolean }) {
  const [f, setF] = useState(initial)
  const [error, setError] = useState<string>()
  const set = <K extends keyof AuditFilters>(k: K, v: AuditFilters[K]) => setF({ ...f, [k]: v })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const err = f.from && f.to && f.from > f.to ? '“From” date must be on or before the “to” date.' : undefined
    setError(err)
    if (!err) onSearch(f)
  }
  return (
    <form role="search" aria-label="Filter audit log" noValidate onSubmit={submit} className="space-y-4 rounded-lg border bg-card p-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <label htmlFor="a-ref" className="mb-1 block text-xs font-medium text-muted-foreground">Reference No</label>
          <Input id="a-ref" value={f.referenceNo} onChange={(e) => set('referenceNo', e.target.value)} placeholder="Exact, e.g. KYC-260901-900003" autoComplete="off" />
        </div>
        <div>
          <label htmlFor="a-actor" className="mb-1 block text-xs font-medium text-muted-foreground">Actor</label>
          <NativeSelect id="a-actor" value={f.actorUserId} onChange={(e) => set('actorUserId', e.target.value)}>
            <option value="">Anyone</option>
            <option value="SYSTEM">SYSTEM</option>
            {users.map((u) => (
              <option key={u.userId} value={u.userId}>
                {u.fullName} ({u.userId})
              </option>
            ))}
          </NativeSelect>
        </div>
        {showMerchant && (
          <div>
            <label htmlFor="a-merchant" className="mb-1 block text-xs font-medium text-muted-foreground">Merchant</label>
            <NativeSelect id="a-merchant" value={f.merchantId} onChange={(e) => set('merchantId', e.target.value)}>
              <option value="">All merchants</option>
              {merchants.map((m) => (
                <option key={m.merchantId} value={m.merchantId}>
                  {m.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        <div>
          <label htmlFor="a-from" className="mb-1 block text-xs font-medium text-muted-foreground">From (MYT)</label>
          <Input id="a-from" type="date" value={f.from} onChange={(e) => set('from', e.target.value)} aria-invalid={!!error} />
        </div>
        <div>
          <label htmlFor="a-to" className="mb-1 block text-xs font-medium text-muted-foreground">To (MYT)</label>
          <Input id="a-to" type="date" value={f.to} onChange={(e) => set('to', e.target.value)} aria-invalid={!!error} />
        </div>
      </div>
      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">Event</div>
        <ToggleChips label="Event" options={ACTION_OPTIONS} value={f.actions} onChange={(v) => set('actions', v)} />
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {error && <p role="alert" className="mr-auto text-sm text-destructive">{error}</p>}
        <Button type="button" variant="outline" onClick={() => { setF(EMPTY_AUDIT_FILTERS); setError(undefined); onReset() }}>
          <RotateCcw aria-hidden /> Reset
        </Button>
        <Button type="submit">
          <Search aria-hidden /> Search
        </Button>
      </div>
    </form>
  )
}

function DetailsCell({ e }: { e: AuditEntry }) {
  const entries = Object.entries(e.details).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0))
  return (
    <div className="min-w-64">
      <p>{summarizeAudit(e)}</p>
      {entries.length > 0 && (
        <details className="mt-1 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">Raw details</summary>
          <pre className="mt-1 max-w-md overflow-x-auto rounded bg-muted p-2 whitespace-pre-wrap">{JSON.stringify(Object.fromEntries(entries), null, 2)}</pre>
        </details>
      )}
    </div>
  )
}

export function AuditLogsPage() {
  const actor = useSession((s) => s.actor)
  const selectedMerchant = useSession((s) => s.merchantId)
  const [sp, setSp] = useSearchParams()
  const key = sp.toString()
  const params = useMemo(() => parseAuditParams(new URLSearchParams(key)), [key])
  const scope = can(actor, 'canViewAllMerchants') && selectedMerchant !== ALL_MERCHANTS ? selectedMerchant : undefined
  const [retry, setRetry] = useState(0)
  const request = JSON.stringify([key, scope, actor.userId, retry])
  const [result, setResult] = useState<Result>({ request: '' })
  const [lastData, setLastData] = useState<Paged<AuditEntry>>()
  const [merchants, setMerchants] = useState<Merchant[]>([])
  const [users, setUsers] = useState<UserSummary[]>([])
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let live = true
    merchantService.list(actor).then((m) => live && setMerchants(m), () => live && setMerchants([]))
    userService.list(actor).then((u) => live && setUsers(u), () => live && setUsers([]))
    return () => {
      live = false
    }
  }, [actor])

  useEffect(() => {
    let live = true
    auditService.list(toAuditQuery(params, scope), actor).then(
      (data) => {
        if (!live) return
        setResult({ request, data })
        setLastData(data)
      },
      (e: unknown) => live && setResult({ request, error: isServiceError(e) ? e.message : 'Unexpected error.' }),
    )
    return () => {
      live = false
    }
  }, [request, params, scope, actor])

  const loading = result.request !== request
  const error = loading ? undefined : result.error
  const data = loading || error ? lastData : result.data
  const go = (p: AuditParams) => setSp(toAuditSearch(p))
  const merchantName = (id?: string) => (id ? (merchants.find((m) => m.merchantId === id)?.name ?? id) : '—')
  const filtersKey = JSON.stringify(params.filters)

  const exportCsv = async () => {
    setExporting(true)
    try {
      const all = await auditService.list({ ...toAuditQuery(params, scope), page: 1, pageSize: 100_000 }, actor)
      const blob = new Blob([`﻿${auditCsv(all.items, merchantName)}`], { type: 'text/csv;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(a.href)
      toast.success(`Exported ${all.items.length} entries`)
    } catch (e) {
      toast.error(isServiceError(e) ? e.message : 'Export failed.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Audit Logs</h1>
          <p className="text-sm text-muted-foreground">Append-only. Every PII view, claim, decision and config change is recorded here; entries can’t be edited or deleted.</p>
        </div>
        <Button variant="outline" disabled={exporting || !data?.total} onClick={() => void exportCsv()}>
          <Download aria-hidden /> {exporting ? 'Exporting…' : 'Export CSV'}
        </Button>
      </header>

      <Filters key={filtersKey} initial={params.filters} onSearch={(filters) => go({ filters, page: 1, pageSize: params.pageSize })} onReset={() => go({ filters: EMPTY_AUDIT_FILTERS, page: 1, pageSize: params.pageSize })} merchants={merchants} users={users} showMerchant={can(actor, 'canViewAllMerchants') && !scope} />

      <section aria-label="Audit entries" className="rounded-lg border bg-card">
        {error && !data ? (
          <ErrorState message={error} onRetry={() => setRetry((n) => n + 1)} />
        ) : !loading && data?.total === 0 ? (
          <EmptyState title="No audit entries match these filters" />
        ) : (
          <div className="overflow-x-auto">
            <table className={cn('w-full text-sm', loading && data && 'opacity-60')} aria-busy={loading}>
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  {['Time (MYT)', 'Event', 'Actor', 'Merchant', 'Reference No', 'IP', 'Details'].map((h) => (
                    <th key={h} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!data &&
                  Array.from({ length: 8 }, (_, i) => (
                    <tr key={i} className="border-t" aria-hidden>
                      <td colSpan={7} className="px-3 py-3">
                        <div className="h-3.5 animate-pulse rounded bg-muted" />
                      </td>
                    </tr>
                  ))}
                {data?.items.map((e) => (
                  <tr key={e.id} className="border-t align-top">
                    <td className="px-3 py-2 whitespace-nowrap">
                      {formatMyt(e.at)}
                      <div className="font-mono text-[11px] text-muted-foreground">{e.id}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn('inline-block rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap', ACTION_TONE[e.action] ?? 'bg-muted')}>{AUDIT_ACTION_LABELS[e.action]}</span>
                      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{e.action}</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {e.actor.kind === 'SYSTEM' ? (
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">SYSTEM</span>
                      ) : (
                        <>
                          {e.actor.fullName}
                          <div className="text-xs text-muted-foreground">{e.actor.userId}</div>
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{merchantName(e.merchantId)}</td>
                    <td className="px-3 py-2">
                      {e.referenceNo ? (
                        <Link to={`/verifications/${e.referenceNo}`} className="font-mono text-xs whitespace-nowrap text-blue-700 hover:underline dark:text-blue-400">
                          {e.referenceNo}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{e.ip}</td>
                    <td className="px-3 py-2">
                      <DetailsCell e={e} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > 0 && (
          <div className="border-t">
            <Pagination page={params.page} pageSize={params.pageSize} total={data.total} pageSizes={AUDIT_PAGE_SIZES} onPage={(page) => go({ ...params, page })} onPageSize={(pageSize) => go({ ...params, page: 1, pageSize })} />
          </div>
        )}
      </section>
    </div>
  )
}

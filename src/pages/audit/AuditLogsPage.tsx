import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Download, RotateCcw, Search } from 'lucide-react'
import { toast } from 'sonner'
import { useAccess } from '@/app/access'
import { NativeSelect } from '@/components/common/NativeSelect'
import { Pagination } from '@/components/common/Pagination'
import { EmptyState, ErrorState } from '@/components/common/States'
import { ToggleChips } from '@/components/common/ToggleChips'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AUDIT_ACTION_GROUPS, type AuditAction, type AuditEntry, type Merchant, type Paged } from '@/domain/types'
import { auditCsv, summarizeAudit } from '@/lib/auditFormat'
import { formatMyt } from '@/lib/format'
import { AUDIT_ACTION_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { auditService } from '@/services/auditService'
import { isServiceError } from '@/services/errors'
import { merchantService } from '@/services/merchantService'
import { userService, type UserSummary } from '@/services/userService'
import { useSession } from '@/stores/sessionStore'
import { AUDIT_PAGE_SIZES, EMPTY_AUDIT_FILTERS, parseAuditParams, toAuditQuery, toAuditSearch, type AuditFilters, type AuditParams } from './auditQuery'
import { isInternal } from '@/domain/access'

// REQ: DEC-42 — events grouped as in DECISIONS.md.
const ACTION_GROUPS = (Object.entries(AUDIT_ACTION_GROUPS) as [string, readonly AuditAction[]][]).map(([group, actions]) => ({ group, options: actions.map((a) => ({ value: a, label: AUDIT_ACTION_LABELS[a] })) }))

const ACTION_TONE: Partial<Record<AuditAction, string>> = {
  SENSITIVE_PII_VIEW: 'bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-200',
  CASE_DECISION_APPROVED: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-200',
  CASE_DECISION_REJECTED: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-200',
  CASE_DECISION_BLOCKED: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200',
  CASE_CLAIM_EXPIRED: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
  FLOW_SETTING_CHANGED: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-200',
  API_KEY_ROTATED: 'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200',
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
        {/* REQ: DEC-114 — our Verification ID first, then the merchant's Reference ID; both exact. */}
        <div>
          <label htmlFor="a-vid" className="mb-1 block text-xs font-medium text-muted-foreground">Verification ID</label>
          <Input id="a-vid" value={f.verificationId} onChange={(e) => set('verificationId', e.target.value)} placeholder="Exact, e.g. vrf_tz4a98…" autoComplete="off" spellCheck={false} />
        </div>
        <div>
          <label htmlFor="a-ref" className="mb-1 block text-xs font-medium text-muted-foreground">Reference ID</label>
          <Input id="a-ref" value={f.referenceId} onChange={(e) => set('referenceId', e.target.value)} placeholder="Exact" autoComplete="off" />
        </div>
        <div>
          <label htmlFor="a-actor" className="mb-1 block text-xs font-medium text-muted-foreground">Actor</label>
          <NativeSelect id="a-actor" value={f.actorUserId} onChange={(e) => set('actorUserId', e.target.value)}>
            <option value="">Anyone</option>
            <option value="SYSTEM">SYSTEM</option>
            {users.map((u) => (
              <option key={u.userId} value={u.userId}>
                {u.fullName}
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
      <details open={f.actions.length > 0} className="rounded-md border px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground select-none">Event {f.actions.length ? `(${f.actions.length} selected)` : '(all)'}</summary>
        <div role="group" aria-label="Event" className="mt-2 space-y-2">
          {ACTION_GROUPS.map((g) => (
            <div key={g.group} className="flex flex-wrap items-center gap-2">
              <span className="w-24 shrink-0 text-xs text-muted-foreground">{g.group}</span>
              <ToggleChips
                label={`${g.group} events`}
                options={g.options}
                value={f.actions.filter((a) => g.options.some((o) => o.value === a))}
                onChange={(v) => set('actions', [...f.actions.filter((a) => !g.options.some((o) => o.value === a)), ...v])}
              />
            </div>
          ))}
        </div>
      </details>
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

// REQ: DEC-42 / DEC-70 — Super admin: everything; Merchant Owner: the merchant; Project Admin: their projects.
export function AuditLogsPage() {
  const actor = useSession((s) => s.actor)
  const { selected, projects, account, merchantScope } = useAccess()
  const [sp, setSp] = useSearchParams()
  const key = sp.toString()
  const params = useMemo(() => parseAuditParams(new URLSearchParams(key)), [key])
  const scope = selected?.projectId
  const isAdmin = !!account && isInternal(account) // super admins and platform staff see several merchants (DEC-99)
  const [retry, setRetry] = useState(0)
  const request = JSON.stringify([key, scope, merchantScope, actor.userId, retry])
  // REQ: DEC-109 — in a project, its entries; in Merchant settings › Audit log, the whole merchant.
  const query = useCallback((p: AuditParams) => ({ ...toAuditQuery(p, scope), ...(merchantScope ? { merchantId: merchantScope } : {}) }), [scope, merchantScope])
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
    auditService.list(query(params), actor).then(
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
  }, [request, params, query, actor])

  const loading = result.request !== request
  const error = loading ? undefined : result.error
  const data = loading || error ? lastData : result.data
  const go = (p: AuditParams) => {
    const next = toAuditSearch(p)
    if (sp.get('tab')) next.set('tab', sp.get('tab')!) // REQ: DEC-109 — stay on Merchant settings › Audit log
    setSp(next)
  }
  const merchantName = (id?: string) => (id ? (merchants.find((m) => m.merchantId === id)?.name ?? id) : '—')
  const projectName = (id?: string) => (id ? (projects.find((p) => p.projectId === id)?.name ?? id) : '—')
  const filtersKey = JSON.stringify(params.filters)

  const exportCsv = async () => {
    setExporting(true)
    try {
      const all = await auditService.list({ ...query(params), page: 1, pageSize: 100_000 }, actor)
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
          <p className="text-sm text-muted-foreground">{selected ? `${selected.name} · ` : ''}Append-only. Every personal-data view, claim, decision and settings change is recorded with the actor’s role; entries can’t be edited or deleted.</p>
        </div>
        <Button variant="outline" disabled={exporting || !data?.total} onClick={() => void exportCsv()}>
          <Download aria-hidden /> {exporting ? 'Exporting…' : 'Export CSV'}
        </Button>
      </header>

      <Filters key={filtersKey} initial={params.filters} onSearch={(filters) => go({ filters, page: 1, pageSize: params.pageSize })} onReset={() => go({ filters: EMPTY_AUDIT_FILTERS, page: 1, pageSize: params.pageSize })} merchants={merchants} users={users} showMerchant={isAdmin && !scope && !merchantScope} />

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
                  {/* REQ: DEC-114 — Verification ID, then Reference ID, each in its own column. */}
                  {['Time (MYT)', 'Event', 'Actor', 'Project', ...(isAdmin ? ['Merchant'] : []), 'Verification ID', 'Reference ID', 'IP', 'Details'].map((h) => (
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
                      <td colSpan={isAdmin ? 10 : 9} className="px-3 py-3">
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
                          {e.actorRole && <div className="text-xs text-muted-foreground">{e.actorRole}</div>}
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{projectName(e.projectId)}</td>
                    {isAdmin && <td className="px-3 py-2 whitespace-nowrap">{merchantName(e.merchantId)}</td>}
                    <td className="px-3 py-2">
                      {/* REQ: DEC-114 — the Verification ID opens the case. */}
                      {e.verificationId ? (
                        <Link to={`/verifications/${e.verificationId}`} className="font-mono text-xs whitespace-nowrap text-blue-700 hover:underline dark:text-blue-400">
                          {e.verificationId}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{e.referenceId ?? <span className="font-sans text-muted-foreground">—</span>}</td>
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

// REQ: DEC-98 — [FRS] Merchant Management, Super admin only (DEC-70). DEC-92: a new merchant also gets its Default
// project, default flow and first owner.
import { useState, type FormEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { MoreVertical, Plus, RotateCcw, Search } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/FormField'
import { NativeSelect } from '@/components/common/NativeSelect'
import { Pagination } from '@/components/common/Pagination'
import { EmptyState, ErrorState } from '@/components/common/States'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { MERCHANT_STATUSES, type MerchantStatus } from '@/domain/types'
import { errorMessage, fieldErrors, useLoad } from '@/hooks/useLoad'
import { COUNTRIES } from '@/lib/countries'
import { formatMyt } from '@/lib/format'
import { MERCHANT_STATUS_LABELS, USER_STATUS_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { merchantAdminService, type MerchantInput, type MerchantRow } from '@/services/merchantAdminService'
import { useSession } from '@/stores/sessionStore'
import { useAccess } from '@/app/access'

const PAGE_SIZES = [10, 20, 50] as const

const STATUS_TONE: Record<MerchantStatus, string> = {
  ONBOARDING: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-200',
  ACTIVE: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-200',
  SUSPENDED: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
  TERMINATED: 'bg-muted text-muted-foreground',
}
const MerchantStatusBadge = ({ status }: { status: MerchantStatus }) => <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap', STATUS_TONE[status])}>{MERCHANT_STATUS_LABELS[status]}</span>

/** What each status change does, shown before it is confirmed (DEC-98). */
const STATUS_EFFECT: Record<MerchantStatus, string> = {
  ONBOARDING: '',
  ACTIVE: 'Its users work as normal and its API keys accept live requests.',
  SUSPENDED: 'All its users are signed out and can’t sign in, and its API keys stop working at once, until it is made Active again.',
  TERMINATED: 'All its users are signed out for good and its API keys stop working. This is final; its records are kept.',
}

const EMPTY: MerchantInput = { name: '', registrationNo: '', country: '', contactName: '', contactEmail: '', contactPhone: '' }

function CreateDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const actor = useSession((s) => s.actor)
  const [f, setF] = useState<MerchantInput>(EMPTY)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const set = (k: keyof MerchantInput) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    try {
      const m = await merchantAdminService.create(f, actor)
      toast.success(`${m.name} created`, { description: 'Onboarding: Default project and Draft default flow created; the primary contact is invited as Merchant Owner.' })
      onSaved()
    } catch (err) {
      setErrors(fieldErrors(err))
    } finally {
      setBusy(false)
    }
  }
  const field = (id: keyof MerchantInput, label: ReactNode, control: ReactNode, hint?: string) => (
    <FormField id={`m-${id}`} label={label} error={errors[id]} hint={hint}>
      {control}
    </FormField>
  )
  const req = (label: string) => (
    <>
      {label} <span className="text-destructive" aria-hidden>*</span>
    </>
  )
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>Create New Merchant</DialogTitle>
            <DialogDescription>Starts as Onboarding (sandbox only). Also creates its Default project with a Draft default flow, and invites the primary contact as Merchant Owner.</DialogDescription>
          </DialogHeader>
          {field('name', req('Merchant Name'), <Input id="m-name" value={f.name} onChange={set('name')} aria-invalid={!!errors.name} autoFocus />)}
          {field('country', req('Country of incorporation'), (
            <NativeSelect id="m-country" value={f.country} onChange={set('country')} aria-invalid={!!errors.country}>
              <option value="">Select a country</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          ))}
          {field('registrationNo', req('Business Registration No'), <Input id="m-registrationNo" value={f.registrationNo} onChange={set('registrationNo')} aria-invalid={!!errors.registrationNo} />, f.country === 'MY' ? 'SSM 12-digit number, e.g. 201901000005' : 'Can’t be changed after creation.')}
          {field('contactName', req('Primary Contact Name'), <Input id="m-contactName" value={f.contactName} onChange={set('contactName')} aria-invalid={!!errors.contactName} />, 'Becomes the first Merchant Owner.')}
          {field('contactEmail', req('Primary Contact Email'), <Input id="m-contactEmail" type="email" value={f.contactEmail} onChange={set('contactEmail')} aria-invalid={!!errors.contactEmail} />, 'Receives the invitation. Can’t be changed after creation.')}
          {field('contactPhone', 'Contact Phone', <Input id="m-contactPhone" type="tel" value={f.contactPhone} onChange={set('contactPhone')} aria-invalid={!!errors.contactPhone} placeholder="+60 12-345 6789" />)}
          {errors.form && (
            <p role="alert" className="text-sm text-destructive">
              {errors.form}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Create merchant'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EditDialog({ row, onClose, onSaved }: { row: MerchantRow; onClose: () => void; onSaved: () => void }) {
  const actor = useSession((s) => s.actor)
  const [name, setName] = useState(row.name)
  const [phone, setPhone] = useState(row.primaryContact.phone ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    try {
      await merchantAdminService.update(row.merchantId, { name, contactPhone: phone }, actor)
      toast.success('Merchant saved')
      onSaved()
    } catch (err) {
      setErrors(fieldErrors(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>Edit {row.name}</DialogTitle>
            <DialogDescription>Registration No, country and primary contact email are locked after creation.</DialogDescription>
          </DialogHeader>
          <FormField id="e-name" label="Merchant Name" error={errors.name}>
            <Input id="e-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} autoFocus />
          </FormField>
          <FormField id="e-phone" label="Contact Phone" error={errors.contactPhone}>
            <Input id="e-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} aria-invalid={!!errors.contactPhone} />
          </FormField>
          {errors.form && (
            <p role="alert" className="text-sm text-destructive">
              {errors.form}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// REQ: DEC-98 — only the allowed next statuses; a reason is required and audited.
function StatusDialog({ row, onClose, onSaved }: { row: MerchantRow; onClose: () => void; onSaved: () => void }) {
  const actor = useSession((s) => s.actor)
  const [to, setTo] = useState<MerchantStatus>(row.nextStatuses[0])
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    try {
      await merchantAdminService.changeStatus(row.merchantId, to, reason, actor)
      toast.success(`${row.name} is now ${MERCHANT_STATUS_LABELS[to]}`)
      onSaved()
    } catch (err) {
      setErrors(fieldErrors(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>Change status of {row.name}</DialogTitle>
            <DialogDescription>
              Now <MerchantStatusBadge status={row.status} />
            </DialogDescription>
          </DialogHeader>
          <FormField id="s-to" label="New status" error={errors.status}>
            <NativeSelect id="s-to" value={to} onChange={(e) => setTo(e.target.value as MerchantStatus)}>
              {row.nextStatuses.map((s) => (
                <option key={s} value={s}>
                  {MERCHANT_STATUS_LABELS[s]}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <p className={cn('rounded-md px-3 py-2 text-sm', to === 'ACTIVE' ? 'bg-muted' : 'bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200')} role="status">
            {STATUS_EFFECT[to]}
          </p>
          <FormField id="s-reason" label="Reason for change" error={errors.reason} hint="Recorded in the audit log.">
            <Textarea id="s-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!errors.reason} />
          </FormField>
          {errors.form && (
            <p role="alert" className="text-sm text-destructive">
              {errors.form}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant={to === 'ACTIVE' ? 'default' : 'destructive'} disabled={busy}>
              {busy ? 'Saving…' : `Set to ${MERCHANT_STATUS_LABELS[to]}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Read-only detail panel (FRS ViewDetails). */
function DetailDialog({ row, onClose }: { row: MerchantRow; onClose: () => void }) {
  const items: [string, ReactNode][] = [
    ['Merchant ID', <span key="id" className="font-mono text-xs">{row.merchantId}</span>],
    ['Status', <MerchantStatusBadge key="s" status={row.status} />],
    ['Business Registration No', row.registrationNo],
    ['Country of incorporation', row.countryName],
    ['Primary contact', `${row.primaryContact.fullName} · ${row.primaryContact.email}`],
    ['Contact phone', row.primaryContact.phone ?? '—'],
    ['Merchant Owner', row.owner ? `${row.owner.fullName} · ${USER_STATUS_LABELS[row.owner.status]}` : '—'],
    ['Projects / users / cases', `${row.projects} / ${row.users} / ${row.cases}`],
    ['Created', `${formatMyt(row.createdAt)} MYT · ${row.createdBy}`],
  ]
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{row.name}</DialogTitle>
          <DialogDescription>Merchant details</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[minmax(0,11rem)_1fr] gap-x-4 gap-y-2 text-sm">
          {items.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0 break-words">{v}</dd>
            </div>
          ))}
        </dl>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type Open = { kind: 'create' } | { kind: 'edit' | 'status' | 'detail'; row: MerchantRow }
type Filters = { q: string; status: '' | MerchantStatus }

export function MerchantsPage() {
  const actor = useSession((s) => s.actor)
  // REQ: DEC-99 — Merchants View is read-only; Create adds and edits; Suspend changes status.
  const access = useAccess()
  const canCreate = access.allows({ platform: 'createMerchants' })
  const canChangeStatus = access.allows({ platform: 'changeMerchantStatus' })
  const rows = useLoad(() => merchantAdminService.list(actor), [actor.userId])
  const [sp, setSp] = useSearchParams()
  const applied: Filters = { q: sp.get('q') ?? '', status: (sp.get('status') ?? '') as Filters['status'] }
  const [form, setForm] = useState<Filters>(applied)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0])
  const [open, setOpen] = useState<Open>()

  const apply = (f: Filters) => {
    setSp(Object.fromEntries(Object.entries(f).filter(([, v]) => v)), { replace: true })
    setPage(1)
  }
  const q = applied.q.trim().toLowerCase()
  const filtered = (rows.data ?? []).filter((r) => (!q || r.name.toLowerCase().includes(q) || r.merchantId.toLowerCase().includes(q)) && (!applied.status || r.status === applied.status))
  const shown = filtered.slice((page - 1) * pageSize, page * pageSize)
  const saved = () => {
    setOpen(undefined)
    rows.reload()
  }
  const resend = async (r: MerchantRow) => {
    try {
      await merchantAdminService.resendInvitation(r.merchantId, actor)
      toast.success(`Invitation resent to ${r.primaryContact.email}`)
      rows.reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  if (rows.error && !rows.data) return <ErrorState message={rows.error} onRetry={rows.reload} />
  return (
    <div className="mx-auto max-w-[1200px] space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Merchants</h1>
          <p className="text-sm text-muted-foreground">Business clients using the eKYC service. Merchants are never deleted: Terminated keeps their records.</p>
        </div>
        {canCreate && (
          <Button onClick={() => setOpen({ kind: 'create' })}>
            <Plus aria-hidden /> Add Merchant
          </Button>
        )}
      </header>
      <form
        noValidate
        className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3"
        onSubmit={(e) => {
          e.preventDefault()
          apply(form)
        }}
      >
        <FormField id="mf-q" label="Merchant" className="w-64">
          <Input id="mf-q" value={form.q} onChange={(e) => setForm({ ...form, q: e.target.value })} placeholder="Enter name or ID…" />
        </FormField>
        <FormField id="mf-status" label="Status" className="w-44">
          <NativeSelect id="mf-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Filters['status'] })}>
            <option value="">All</option>
            {MERCHANT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {MERCHANT_STATUS_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="outline" onClick={() => { const empty: Filters = { q: '', status: '' }; setForm(empty); apply(empty) }}>
            <RotateCcw aria-hidden /> Reset
          </Button>
          <Button type="submit">
            <Search aria-hidden /> Search
          </Button>
        </div>
      </form>
      <section aria-label="Merchant list" className="overflow-x-auto rounded-lg border bg-card">
        <table className={cn('w-full text-sm', rows.loading && rows.data && 'opacity-60')} aria-busy={rows.loading}>
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              {['Merchant ID', 'Merchant Name', 'Country', 'Status', 'Created At'].map((h) => (
                <th key={h} scope="col" className="px-4 py-2 font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
              <th scope="col" className="px-4 py-2 font-medium">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.merchantId} className="border-t">
                <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">{r.merchantId}</td>
                <th scope="row" className="max-w-80 px-4 py-2 text-left font-normal">
                  {/* REQ: DEC-98 — long names truncate with a tooltip. */}
                  <button type="button" className="block max-w-full truncate font-medium text-blue-700 hover:underline dark:text-blue-400" title={r.name} onClick={() => setOpen({ kind: 'detail', row: r })}>
                    {r.name}
                  </button>
                </th>
                <td className="px-4 py-2 whitespace-nowrap">{r.countryName}</td>
                <td className="px-4 py-2">
                  <MerchantStatusBadge status={r.status} />
                </td>
                <td className="px-4 py-2 whitespace-nowrap">{formatMyt(r.createdAt)}</td>
                <td className="px-4 py-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${r.name}`}>
                          <MoreVertical aria-hidden />
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem onClick={() => setOpen({ kind: 'detail', row: r })}>View details</DropdownMenuItem>
                      {canCreate && r.status !== 'TERMINATED' && <DropdownMenuItem onClick={() => setOpen({ kind: 'edit', row: r })}>Edit</DropdownMenuItem>}
                      {canChangeStatus && r.nextStatuses.length > 0 && <DropdownMenuItem onClick={() => setOpen({ kind: 'status', row: r })}>Change status</DropdownMenuItem>}
                      {canCreate && r.canResendInvitation && <DropdownMenuItem onClick={() => void resend(r)}>Resend invitation</DropdownMenuItem>}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.data && !filtered.length && <EmptyState title="No Records Found" />}
        <Pagination page={page} pageSize={pageSize} total={filtered.length} pageSizes={PAGE_SIZES} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1) }} />
      </section>
      {open?.kind === 'create' && <CreateDialog onClose={() => setOpen(undefined)} onSaved={saved} />}
      {open?.kind === 'edit' && <EditDialog row={open.row} onClose={() => setOpen(undefined)} onSaved={saved} />}
      {open?.kind === 'status' && <StatusDialog row={open.row} onClose={() => setOpen(undefined)} onSaved={saved} />}
      {open?.kind === 'detail' && <DetailDialog row={open.row} onClose={() => setOpen(undefined)} />}
    </div>
  )
}

// REQ: DEC-98 — [FRS] Merchant Management, Super admin only (DEC-70). DEC-92: a new merchant also gets its Default
// project, default flow and first owner.
import { useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { FormField } from '@/components/common/FormField'
import { NativeSelect } from '@/components/common/NativeSelect'
import { ErrorState } from '@/components/common/States'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { MerchantStatus } from '@/domain/types'
import { errorMessage, fieldErrors, useLoad } from '@/hooks/useLoad'
import { COUNTRIES } from '@/lib/countries'
import { formatMyt } from '@/lib/format'
import { MERCHANT_STATUS_LABELS, USER_STATUS_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { merchantAdminService, type MerchantInput, type MerchantRow } from '@/services/merchantAdminService'
import { merchantService } from '@/services/merchantService'
import { useSession } from '@/stores/sessionStore'
import { useAccess } from '@/app/access'


const STATUS_TONE: Record<MerchantStatus, string> = {
  ONBOARDING: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-200',
  ACTIVE: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-200',
  SUSPENDED: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
  TERMINATED: 'bg-muted text-muted-foreground',
}
export const MerchantStatusBadge = ({ status }: { status: MerchantStatus }) => <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap', STATUS_TONE[status])}>{MERCHANT_STATUS_LABELS[status]}</span>

/** What each status change does, shown before it is confirmed (DEC-98). */
const STATUS_EFFECT: Record<MerchantStatus, string> = {
  ONBOARDING: '',
  ACTIVE: 'Its users work as normal and its API keys accept live requests.',
  SUSPENDED: 'All its users are signed out and can’t sign in, and its API keys stop working at once, until it is made Active again.',
  TERMINATED: 'All its users are signed out for good and its API keys stop working. This is final; its records are kept.',
}

const EMPTY: MerchantInput = { name: '', registrationNo: '', country: '', contactName: '', contactEmail: '', contactPhone: '' }

export function CreateMerchantDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
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
      toast.success(`${m.name} created`, { description: 'Onboarding: Default project and Draft default flow created; the primary contact is invited as Owner.' })
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
            <DialogDescription>Starts as Onboarding (sandbox only). Also creates its Default project with a Draft default flow, and invites the primary contact as Owner.</DialogDescription>
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

/** REQ: DEC-98 / DEC-109 — Merchant settings › General: the merchant's details; platform users also edit, change status, resend. */
export function MerchantGeneral({ merchantId }: { merchantId: string }) {
  const actor = useSession((s) => s.actor)
  const access = useAccess()
  // REQ: DEC-99 — Merchants View reads the platform record; Create edits; Suspend changes status. Merchant users see their own.
  const platform = access.allows({ platform: 'viewMerchants' })
  const canCreate = access.allows({ platform: 'createMerchants' })
  const canChangeStatus = access.allows({ platform: 'changeMerchantStatus' })
  const rows = useLoad(() => (platform ? merchantAdminService.list(actor) : Promise.resolve([])), [actor.userId, platform])
  const own = useLoad(() => (platform ? Promise.resolve(undefined) : merchantService.get(merchantId, actor)), [actor.userId, platform, merchantId])
  const [open, setOpen] = useState<'edit' | 'status'>()
  const row = rows.data?.find((r) => r.merchantId === merchantId)
  const m = row ?? own.data
  const error = rows.error ?? own.error
  if (error && !m) return <ErrorState message={error} onRetry={() => (platform ? rows.reload() : own.reload())} />
  if (!m) return <div className="h-40 animate-pulse rounded-lg bg-muted" aria-busy />
  const saved = () => {
    setOpen(undefined)
    rows.reload()
  }
  const resend = async () => {
    try {
      await merchantAdminService.resendInvitation(merchantId, actor)
      toast.success(`Invitation resent to ${m.primaryContact.email}`)
      rows.reload()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const items: [string, ReactNode][] = [
    ['Merchant ID', <span key="id" className="font-mono text-xs">{m.merchantId}</span>],
    ['Status', <MerchantStatusBadge key="s" status={m.status} />],
    ['Business Registration No', m.registrationNo],
    ['Country of incorporation', row?.countryName ?? COUNTRIES.find((c) => c.code === m.country)?.name ?? m.country],
    ['Primary contact', `${m.primaryContact.fullName} · ${m.primaryContact.email}`],
    ['Contact phone', m.primaryContact.phone ?? '—'],
    ...(row
      ? ([
          ['Owner', row.owner ? `${row.owner.fullName} · ${USER_STATUS_LABELS[row.owner.status]}` : '—'],
          ['Projects / users / cases', `${row.projects} / ${row.users} / ${row.cases}`],
        ] as [string, ReactNode][])
      : []),
    ['Created', `${formatMyt(m.createdAt)} MYT · ${m.createdBy}`],
  ]
  return (
    <section aria-labelledby="mg-title" className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <h2 id="mg-title" className="text-sm font-semibold">
          General
        </h2>
        {row && (
          <div className="flex gap-2">
            {canCreate && row.status !== 'TERMINATED' && (
              <Button size="sm" variant="outline" onClick={() => setOpen('edit')}>
                Edit
              </Button>
            )}
            {canChangeStatus && row.nextStatuses.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => setOpen('status')}>
                Change status
              </Button>
            )}
            {canCreate && row.canResendInvitation && (
              <Button size="sm" variant="outline" onClick={() => void resend()}>
                Resend invitation
              </Button>
            )}
          </div>
        )}
      </div>
      <dl className="grid grid-cols-[minmax(0,13rem)_1fr] gap-x-4 gap-y-2 p-4 text-sm">
        {items.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>
      {open === 'edit' && row && <EditDialog row={row} onClose={() => setOpen(undefined)} onSaved={saved} />}
      {open === 'status' && row && <StatusDialog row={row} onClose={() => setOpen(undefined)} onSaved={saved} />}
    </section>
  )
}

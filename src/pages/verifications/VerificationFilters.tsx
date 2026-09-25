import { useState, type FormEvent, type ReactNode } from 'react'
import { RotateCcw, Search } from 'lucide-react'
import { NativeSelect } from '@/components/common/NativeSelect'
import { ToggleChips } from '@/components/common/ToggleChips'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { can } from '@/domain/permissions'
import { RISK_LEVELS, VERIFICATION_STATUSES, type Actor, type Merchant } from '@/domain/types'
import { RISK_LABELS, STATUS_LABELS } from '@/lib/labels'
import type { UserSummary } from '@/services/userService'
import { EMPTY_FILTERS, validateFilters, type ListFilters } from './listQuery'

const STATUS_OPTIONS = VERIFICATION_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))
const RISK_OPTIONS = RISK_LEVELS.map((r) => ({ value: r, label: RISK_LABELS[r] }))

function Field({ id, label, hint, children, className }: { id?: string; label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
        {hint && <span className="ml-1 font-normal">({hint})</span>}
      </label>
      {children}
    </div>
  )
}

function GroupField({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="mb-1 text-xs font-medium text-muted-foreground">
        {label}
        {hint && <span className="ml-1 font-normal">({hint})</span>}
      </div>
      {children}
    </div>
  )
}

/** Owns the unsaved draft. Re-mount it (`key`) when the applied filters change so it shows the URL state. */
export function VerificationFilters({
  initial,
  onSearch,
  onReset,
  actor,
  merchants,
  scopedMerchant,
  reviewers,
}: {
  initial: ListFilters
  onSearch: (filters: ListFilters) => void
  onReset: () => void
  actor: Actor
  merchants: Merchant[]
  /** Set when the top-bar merchant selector scopes the list; the Merchant filter then follows it. */
  scopedMerchant?: Merchant
  reviewers: UserSummary[]
}) {
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState<string>()
  const set = <K extends keyof ListFilters>(k: K, v: ListFilters[K]) => setDraft({ ...draft, [k]: v })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const err = validateFilters(draft)
    setError(err)
    if (!err) onSearch(draft)
  }
  const reset = () => {
    setDraft(EMPTY_FILTERS)
    setError(undefined)
    onReset()
  }
  const showMerchant = can(actor, 'canViewAllMerchants')
  const others = reviewers.filter((r) => r.userId !== actor.userId)
  const byMerchant = new Map<string, UserSummary[]>()
  for (const r of others) {
    const key = r.merchantId ? (merchants.find((m) => m.merchantId === r.merchantId)?.name ?? r.merchantId) : 'Platform Admins'
    byMerchant.set(key, [...(byMerchant.get(key) ?? []), r])
  }

  // noValidate: show our own validation message instead of the browser tooltip that min/max would trigger.
  return (
    <form role="search" aria-label="Filter verifications" noValidate onSubmit={submit} className="rounded-lg border bg-card p-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field id="f-ref" label="Reference No">
          <Input id="f-ref" value={draft.referenceNo} onChange={(e) => set('referenceNo', e.target.value)} placeholder="e.g. KYC-260901" autoComplete="off" />
        </Field>
        <Field id="f-name" label="Full Name">
          <Input id="f-name" value={draft.fullName} onChange={(e) => set('fullName', e.target.value)} placeholder="Contains…" autoComplete="off" />
        </Field>
        {showMerchant && (
          <Field id="f-merchant" label="Merchant" hint={scopedMerchant ? 'set in top bar' : undefined}>
            <NativeSelect id="f-merchant" value={scopedMerchant?.merchantId ?? draft.merchantId} disabled={!!scopedMerchant} onChange={(e) => set('merchantId', e.target.value)}>
              <option value="">All merchants</option>
              {merchants.map((m) => (
                <option key={m.merchantId} value={m.merchantId}>
                  {m.name} ({m.workflowVersion})
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        <Field id="f-claimed" label="Claimed By">
          <NativeSelect id="f-claimed" value={draft.claimedBy} onChange={(e) => set('claimedBy', e.target.value)}>
            <option value="">Anyone or unclaimed</option>
            <option value="UNCLAIMED">Unclaimed</option>
            {can(actor, 'canReview') && <option value={actor.userId}>Me ({actor.fullName})</option>}
            {[...byMerchant].map(([group, users]) => (
              <optgroup key={group} label={group}>
                {users.map((u) => (
                  <option key={u.userId} value={u.userId}>
                    {u.fullName} ({u.userId})
                  </option>
                ))}
              </optgroup>
            ))}
          </NativeSelect>
        </Field>
        <Field id="f-updated" label="Last Updated By">
          <NativeSelect id="f-updated" value={draft.lastUpdatedBy} onChange={(e) => set('lastUpdatedBy', e.target.value as ListFilters['lastUpdatedBy'])}>
            <option value="">System or manual</option>
            <option value="SYSTEM">SYSTEM (automated)</option>
            <option value="MANUAL">Manual (reviewer)</option>
          </NativeSelect>
        </Field>
        <Field id="f-from" label="Submitted from" hint="MYT">
          <Input id="f-from" type="date" value={draft.submittedFrom} max={draft.submittedTo || undefined} onChange={(e) => set('submittedFrom', e.target.value)} aria-invalid={!!error} />
        </Field>
        <Field id="f-to" label="Submitted to" hint="MYT">
          <Input id="f-to" type="date" value={draft.submittedTo} min={draft.submittedFrom || undefined} onChange={(e) => set('submittedTo', e.target.value)} aria-invalid={!!error} />
        </Field>
        <GroupField label="Status" className="sm:col-span-2 lg:col-span-2">
          <ToggleChips label="Status" options={STATUS_OPTIONS} value={draft.statuses} onChange={(v) => set('statuses', v)} />
        </GroupField>
        <GroupField label="Risk Level" hint="V4 only">
          <ToggleChips label="Risk Level" options={RISK_OPTIONS} value={draft.riskLevels} onChange={(v) => set('riskLevels', v)} />
        </GroupField>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {error && (
          <p role="alert" className="mr-auto text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="button" variant="outline" onClick={reset}>
          <RotateCcw aria-hidden />
          Reset
        </Button>
        <Button type="submit">
          <Search aria-hidden />
          Search
        </Button>
      </div>
    </form>
  )
}

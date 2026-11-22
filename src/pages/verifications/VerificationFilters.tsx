import { useState, type FormEvent, type ReactNode } from 'react'
import { RotateCcw, Search } from 'lucide-react'
import { DateRangeField } from '@/components/common/DateRangeField'
import { NativeSelect } from '@/components/common/NativeSelect'
import { ToggleChips } from '@/components/common/ToggleChips'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RISK_RESULTS, VERIFICATION_STATUSES } from '@/domain/types'
import { RISK_RESULT_LABELS, STATUS_LABELS } from '@/lib/labels'
import type { FilterOptions } from '@/services/verificationService'
import { DEFAULT_FILTERS, validateFilters, type ListFilters } from './listQuery'

const STATUS_OPTIONS = VERIFICATION_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))
const RISK_OPTIONS = RISK_RESULTS.map((r) => ({ value: r, label: RISK_RESULT_LABELS[r] }))

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

/**
 * REQ: DEC-43 — owns the unsaved draft. Re-mount it (`key`) when the applied filters change so it shows the URL state.
 * `options` holds only the projects in view (the header's switcher) and their flows.
 */
export function VerificationFilters({ initial, onSearch, onReset, options }: { initial: ListFilters; onSearch: (filters: ListFilters) => void; onReset: () => void; options: FilterOptions }) {
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
    setDraft(DEFAULT_FILTERS)
    setError(undefined)
    onReset()
  }

  const several = options.projects.length > 1
  const projectName = (id: string) => options.projects.find((p) => p.projectId === id)?.name ?? id
  const flows = options.flows.filter((f) => !draft.projectId || f.projectId === draft.projectId)
  const versions = [...new Set(options.flows.map((f) => f.workflowVersion))].sort()
  const showRisk = options.flows.some((f) => f.runsRisk)
  const pickProject = (projectId: string) =>
    setDraft({ ...draft, projectId, flowId: projectId && options.flows.find((f) => f.flowId === draft.flowId)?.projectId !== projectId ? '' : draft.flowId })

  // noValidate: show our own validation message instead of the browser tooltip that min/max would trigger.
  return (
    <form role="search" aria-label="Filter verifications" noValidate onSubmit={submit} className="rounded-lg border bg-card p-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field id="f-ref" label="Reference ID">
          <Input id="f-ref" value={draft.referenceId} onChange={(e) => set('referenceId', e.target.value)} placeholder="e.g. KYC-260901" autoComplete="off" />
        </Field>
        <Field id="f-name" label="Full Name">
          <Input id="f-name" value={draft.fullName} onChange={(e) => set('fullName', e.target.value)} placeholder="Contains…" autoComplete="off" />
        </Field>
        {several && (
          <Field id="f-project" label="Project">
            <NativeSelect id="f-project" value={draft.projectId} onChange={(e) => pickProject(e.target.value)}>
              <option value="">All projects in view</option>
              {options.projects.map((p) => (
                <option key={p.projectId} value={p.projectId}>
                  {p.name}
                  {p.status === 'ARCHIVED' ? ' (archived)' : ''}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        <Field id="f-flow" label="Flow">
          <NativeSelect id="f-flow" value={draft.flowId} onChange={(e) => set('flowId', e.target.value)}>
            <option value="">All flows</option>
            {flows.map((f) => (
              <option key={f.flowId} value={f.flowId}>
                {several && !draft.projectId ? `${projectName(f.projectId)} › ` : ''}
                {f.name} ({f.workflowVersion}){f.status === 'ACTIVE' ? '' : ` · ${f.status.toLowerCase()}`}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="f-version" label="Workflow version">
          <NativeSelect id="f-version" value={draft.workflowVersion} onChange={(e) => set('workflowVersion', e.target.value)}>
            <option value="">All versions</option>
            {versions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="f-claim" label="Claim">
          <NativeSelect id="f-claim" value={draft.claim} onChange={(e) => set('claim', e.target.value as ListFilters['claim'])}>
            <option value="">Any</option>
            <option value="UNCLAIMED">Unclaimed</option>
            <option value="MINE">Claimed by me</option>
            <option value="OTHERS">Claimed by others</option>
          </NativeSelect>
        </Field>
        <Field id="f-updated" label="Last Updated By">
          <NativeSelect id="f-updated" value={draft.lastUpdatedBy} onChange={(e) => set('lastUpdatedBy', e.target.value as ListFilters['lastUpdatedBy'])}>
            <option value="">All</option>
            <option value="SYSTEM">SYSTEM (automated)</option>
            <option value="MANUAL">Manual (reviewer)</option>
          </NativeSelect>
        </Field>
        {/* REQ: DEC-43 / DEC-101 — one field for the start and end date, with a range calendar. */}
        <Field id="f-created" label="Created" hint="MYT">
          <DateRangeField
            id="f-created"
            title="Created between"
            value={{ from: draft.createdFrom, to: draft.createdTo }}
            onChange={(r) => setDraft({ ...draft, createdFrom: r.from, createdTo: r.to })}
            invalid={!!error}
          />
        </Field>
        <GroupField label="Status" hint="none selected = all" className="sm:col-span-2 lg:col-span-2">
          <ToggleChips label="Status" options={STATUS_OPTIONS} value={draft.statuses} onChange={(v) => set('statuses', v)} />
        </GroupField>
        {showRisk && (
          <GroupField label="Risk" hint="flows with risk assessment">
            <ToggleChips label="Risk" options={RISK_OPTIONS} value={draft.riskResults} onChange={(v) => set('riskResults', v)} />
          </GroupField>
        )}
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

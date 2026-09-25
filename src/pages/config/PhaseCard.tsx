import type { ReactNode } from 'react'
import { Switch } from '@/components/common/Switch'
import { Input } from '@/components/ui/input'
import type { ConfigError } from '@/domain/configRules'
import { PHASE_LABELS, type PhaseConfig } from '@/domain/types'
import { cn } from '@/lib/utils'
import { ThresholdSlider } from './ThresholdSlider'

/** "was 85" next to a field whose draft value differs from the deployed baseline. */
export function DiffBadge({ from, to, format = String }: { from: unknown; to: unknown; format?: (v: never) => string }) {
  if (from === undefined || from === to) return null
  return <span className="rounded bg-blue-100 px-1.5 text-[11px] font-medium text-blue-800 dark:bg-blue-500/20 dark:text-blue-200">was {format(from as never)}</span>
}

export function FieldError({ errors, field }: { errors: ConfigError[]; field: string }) {
  const e = errors.find((x) => x.field === field)
  return e ? (
    <p id={`err-${field}`} className="mt-1 text-xs text-destructive">
      {e.message}
    </p>
  ) : null
}

export function NumberField({
  id,
  label,
  value,
  onChange,
  baseline,
  errors,
  field,
  suffix,
  disabled,
  min,
  max,
}: {
  id: string
  label: ReactNode
  value: number
  onChange: (v: number) => void
  baseline?: number
  errors: ConfigError[]
  field: string
  suffix?: string
  disabled?: boolean
  min?: number
  max?: number
}) {
  const invalid = errors.some((e) => e.field === field)
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
          {label}
        </label>
        <DiffBadge from={baseline} to={value} />
      </div>
      <div className="flex items-center gap-1.5">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          value={Number.isFinite(value) ? value : ''}
          min={min}
          max={max}
          disabled={disabled}
          aria-invalid={invalid}
          aria-describedby={invalid ? `err-${field}` : undefined}
          onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))}
          className="w-24 tabular-nums"
        />
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      </div>
      <FieldError errors={errors} field={field} />
    </div>
  )
}

// REQ: DEC-10 / DEC-50 — settings are per phase, never per metric.
export function PhaseCard({ value, baseline, errors, onChange }: { value: PhaseConfig; baseline?: PhaseConfig; errors: ConfigError[]; onChange: (next: PhaseConfig) => void }) {
  const label = PHASE_LABELS[value.phase]
  const set = (patch: Partial<PhaseConfig>) => onChange({ ...value, ...patch })
  const f = (k: keyof PhaseConfig) => `phases.${value.phase}.${k}`
  const id = (k: string) => `${value.phase}-${k}`
  return (
    <section aria-label={`${label} phase`} className={cn('rounded-lg border bg-card p-4', !value.enabled && 'bg-muted/40')}>
      <div className="mb-3 flex items-center gap-3">
        <h3 className="font-medium">{label}</h3>
        <Switch checked={value.enabled} onChange={(v) => set({ enabled: v })} label={`${label} phase enabled`} />
        <span className="text-xs text-muted-foreground">{value.enabled ? 'Enabled' : 'Disabled — not evaluated'}</span>
        <DiffBadge from={baseline?.enabled} to={value.enabled} format={(v: boolean) => (v ? 'on' : 'off')} />
      </div>
      <fieldset disabled={!value.enabled} className="space-y-3">
        <legend className="sr-only">{label} settings</legend>
        <div className="grid grid-cols-[auto_1fr_auto] items-end gap-4">
          <NumberField id={id('reject')} label="Auto-Reject below" value={value.autoReject} baseline={baseline?.autoReject} errors={errors} field={f('autoReject')} min={0} max={100} onChange={(n) => set({ autoReject: n })} />
          <div className="pb-2">
            <ThresholdSlider phaseLabel={label} reject={value.autoReject} pass={value.autoPass} disabled={!value.enabled} onChange={(r, p) => set({ autoReject: r, autoPass: p })} />
          </div>
          <NumberField id={id('pass')} label="Auto-Pass at or above" value={value.autoPass} baseline={baseline?.autoPass} errors={errors} field={f('autoPass')} min={0} max={100} onChange={(n) => set({ autoPass: n })} />
        </div>
        <p className="text-xs text-muted-foreground">
          Score &lt; {value.autoReject} → Rejected · {value.autoReject}–{Number.isFinite(value.autoPass) ? `below ${value.autoPass}` : '…'} → Pending Review · ≥ {value.autoPass} → passes
        </p>
        <div className="flex flex-wrap gap-6">
          <NumberField id={id('attempts')} label="Max attempts" value={value.maxAttempts} baseline={baseline?.maxAttempts} errors={errors} field={f('maxAttempts')} min={1} onChange={(n) => set({ maxAttempts: n })} />
          <NumberField id={id('cooldown')} label="Cooldown between retakes" value={value.cooldownSec} baseline={baseline?.cooldownSec} errors={errors} field={f('cooldownSec')} suffix="sec" min={0} onChange={(n) => set({ cooldownSec: n })} />
        </div>
      </fieldset>
    </section>
  )
}

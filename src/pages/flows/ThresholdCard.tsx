import { Minus, Plus } from 'lucide-react'
import { OpenQuestionTag } from '@/components/common/OpenQuestionTag'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RETRY_LIMITS, THRESHOLD_PRESETS } from '@/domain/openQuestions'
import { bandSegments, describeBands, PRESET_LABELS, resolveThreshold, RETRY_NOTE, type Band } from '@/domain/thresholds'
import { PHASE_LABELS, THRESHOLD_PRESETS_ORDER, type Check, type CheckSettings, type ThresholdChoice } from '@/domain/types'
import { cn } from '@/lib/utils'

const BAND_STYLE: Record<Band, { bar: string; label: string }> = {
  REJECT: { bar: 'bg-red-500/80', label: 'Reject' },
  REVIEW: { bar: 'bg-amber-400/90', label: 'Review' },
  APPROVE: { bar: 'bg-green-600/80', label: 'Approve' },
}

/** REQ: DEC-19 — 0–100 bar of the Reject / Review / Approve bands; it follows the chosen preset or custom values. */
export function BandBar({ check, choice }: { check: Check; choice: ThresholdChoice }) {
  const t = resolveThreshold(check, choice)
  const valid = Number.isFinite(t.autoReject) && Number.isFinite(t.autoPass) && t.autoReject < t.autoPass
  return (
    <figure className="space-y-1">
      <div className="flex h-6 w-full overflow-hidden rounded-md border" role="img" aria-label={valid ? describeBands(t) : 'Bands not valid yet'}>
        {valid &&
          bandSegments(t).map((s) => (
            <div key={s.band} className={cn('flex items-center justify-center text-[11px] font-medium text-white', BAND_STYLE[s.band].bar)} style={{ width: `${s.to - s.from}%` }}>
              {s.to - s.from >= 8 ? BAND_STYLE[s.band].label : ''}
            </div>
          ))}
      </div>
      <div className="relative h-4 text-[11px] text-muted-foreground tabular-nums" aria-hidden>
        <span className="absolute left-0">0</span>
        {valid && (
          <>
            <span className="absolute -translate-x-1/2" style={{ left: `${t.autoReject}%` }}>
              {t.autoReject}
            </span>
            <span className="absolute -translate-x-1/2" style={{ left: `${t.autoPass}%` }}>
              {t.autoPass}
            </span>
          </>
        )}
        <span className="absolute right-0">100</span>
      </div>
      <figcaption className="text-xs text-muted-foreground">{valid ? describeBands(t) : 'Auto-Reject must be lower than Auto-Pass.'}</figcaption>
    </figure>
  )
}

/**
 * REQ: DEC-18 / DEC-19 — face match or liveness: Low / Standard / High, or Advanced (custom numbers, Super admin only).
 * Others see an Advanced choice as a read-only chip and may move back to a preset.
 */
export function ThresholdCard({
  check,
  value,
  onChange,
  canSetAdvanced,
  disabled,
  errors,
}: {
  check: Check
  value: CheckSettings
  onChange: (v: CheckSettings) => void
  canSetAdvanced: boolean
  disabled: boolean
  errors: Record<string, string>
}) {
  const choice = value.threshold
  const f = (k: string) => `checks.${check}.${k}`
  const pick = (c: ThresholdChoice) => onChange({ ...value, threshold: c })
  const toAdvanced = () => pick({ preset: 'ADVANCED', ...resolveThreshold(check, choice) })
  const options = [...THRESHOLD_PRESETS_ORDER, ...(canSetAdvanced || choice.preset === 'ADVANCED' ? (['ADVANCED'] as const) : [])]
  const id = check.toLowerCase()

  return (
    <section aria-labelledby={`th-${id}`} className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <h3 id={`th-${id}`} className="text-sm font-semibold">
          {PHASE_LABELS[check]}
        </h3>
        <OpenQuestionTag id="OQ-02" />
      </div>
      <fieldset disabled={disabled} className="space-y-4 p-4">
        <legend className="sr-only">{PHASE_LABELS[check]} threshold</legend>
        <div role="radiogroup" aria-label={`${PHASE_LABELS[check]} threshold`} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {options.map((p) => {
            const on = choice.preset === p
            const nums = p === 'ADVANCED' ? (choice.preset === 'ADVANCED' ? choice : undefined) : THRESHOLD_PRESETS[check][p]
            const locked = p === 'ADVANCED' && !canSetAdvanced
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={locked && !on}
                onClick={() => (p === 'ADVANCED' ? !on && toAdvanced() : pick({ preset: p }))}
                className={cn(
                  'rounded-md border px-3 py-2 text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed',
                  on ? 'border-foreground bg-foreground/5 font-medium' : 'hover:bg-muted',
                )}
              >
                <span className="block">{p === 'ADVANCED' && locked ? 'Advanced (set by platform)' : PRESET_LABELS[p]}</span>
                <span className="block text-xs text-muted-foreground tabular-nums">{nums ? `reject < ${nums.autoReject} · approve ≥ ${nums.autoPass}` : 'custom values'}</span>
              </button>
            )
          })}
        </div>

        {choice.preset === 'ADVANCED' && canSetAdvanced && (
          <div className="grid max-w-md grid-cols-2 gap-3">
            {(['autoReject', 'autoPass'] as const).map((k) => (
              <div key={k}>
                <label htmlFor={`${id}-${k}`} className="mb-1 block text-xs font-medium text-muted-foreground">
                  {k === 'autoReject' ? 'Auto-Reject below' : 'Auto-Pass at or above'}
                </label>
                <Input
                  id={`${id}-${k}`}
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={Number.isFinite(choice[k]) ? choice[k] : ''}
                  onChange={(e) => pick({ ...choice, [k]: e.target.value === '' ? Number.NaN : Number(e.target.value) })}
                  aria-invalid={!!errors[f(k)]}
                />
                {errors[f(k)] && (
                  <p role="alert" className="mt-1 text-xs text-destructive">
                    {errors[f(k)]}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
        {choice.preset === 'ADVANCED' && !canSetAdvanced && <p className="text-xs text-muted-foreground">Custom values set by the platform. You can switch back to a preset; only Super admin can change the numbers.</p>}

        <BandBar check={check} choice={choice} />

        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            Retries allowed <OpenQuestionTag id="OQ-03" />
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="icon-sm" aria-label={`Fewer ${PHASE_LABELS[check]} retries`} disabled={value.retriesAllowed <= RETRY_LIMITS.min} onClick={() => onChange({ ...value, retriesAllowed: value.retriesAllowed - 1 })}>
              <Minus aria-hidden />
            </Button>
            <output aria-label={`${PHASE_LABELS[check]} retries allowed`} className="w-8 text-center text-sm font-medium tabular-nums">
              {value.retriesAllowed}
            </output>
            <Button type="button" variant="outline" size="icon-sm" aria-label={`More ${PHASE_LABELS[check]} retries`} disabled={value.retriesAllowed >= RETRY_LIMITS.max} onClick={() => onChange({ ...value, retriesAllowed: value.retriesAllowed + 1 })}>
              <Plus aria-hidden />
            </Button>
            <span className="text-xs text-muted-foreground">
              retries after the first submission · up to {value.retriesAllowed + 1} submissions
            </span>
          </div>
          {errors[f('retriesAllowed')] && <p className="mt-1 text-xs text-destructive">{errors[f('retriesAllowed')]}</p>}
          <p className="mt-1 text-xs text-muted-foreground">{RETRY_NOTE}</p>
        </div>
      </fieldset>
    </section>
  )
}

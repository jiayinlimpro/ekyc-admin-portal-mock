import { OpenQuestionTag } from '@/components/common/OpenQuestionTag'
import { Input } from '@/components/ui/input'
import { THRESHOLD_PRESETS } from '@/domain/openQuestions'
import { bandSegments, describeBands, PRESET_LABELS, resolveThreshold, RETRY_NOTE, type Band } from '@/domain/thresholds'
import { PHASE_LABELS, THRESHOLD_PRESETS_ORDER, type Check, type CheckSettings, type ThresholdChoice } from '@/domain/types'
import { cn } from '@/lib/utils'
import { labelPositions } from './bandLabels'

const BAND_STYLE: Record<Band, { bar: string; label: string }> = {
  REJECT: { bar: 'bg-red-500', label: 'Reject' },
  REVIEW: { bar: 'bg-amber-400', label: 'Review' },
  APPROVE: { bar: 'bg-green-600', label: 'Approve' },
}

const bandText = (band: Band, t: { autoReject: number; autoPass: number }) =>
  band === 'REJECT' ? `below ${t.autoReject}` : band === 'REVIEW' ? `${t.autoReject} to ${t.autoPass}` : `${t.autoPass} and above`

/**
 * REQ: DEC-19 — 0–100 bar of the Reject / Review / Approve bands; it follows the chosen preset or custom values.
 * No text inside the bar (a band can be a sliver); the two thresholds are marked under it, and a legend states each band's
 * range in ink, so identity never relies on colour alone.
 */
export function BandBar({ check, choice }: { check: Check; choice: ThresholdChoice }) {
  const t = resolveThreshold(check, choice)
  const valid = Number.isFinite(t.autoReject) && Number.isFinite(t.autoPass) && t.autoReject < t.autoPass
  const [rejectAt, passAt] = valid ? labelPositions(t.autoReject, t.autoPass) : [0, 0]
  return (
    <figure className="space-y-1.5">
      <div className="flex h-3 w-full gap-0.5" role="img" aria-label={valid ? describeBands(t) : 'Bands not valid yet'}>
        {valid ? (
          bandSegments(t).map((s) => <div key={s.band} className={cn('h-full first:rounded-l-full last:rounded-r-full', BAND_STYLE[s.band].bar)} style={{ width: `${s.to - s.from}%` }} />)
        ) : (
          <div className="h-full w-full rounded-full bg-muted" />
        )}
      </div>
      <div className="relative h-4 text-xs tabular-nums" aria-hidden>
        {(!valid || rejectAt > 7) && <span className="absolute left-0 text-muted-foreground">0</span>}
        {valid && (
          <>
            <span className="absolute -translate-x-1/2 font-medium" style={{ left: `${rejectAt}%` }}>
              {t.autoReject}
            </span>
            <span className="absolute -translate-x-1/2 font-medium" style={{ left: `${passAt}%` }}>
              {t.autoPass}
            </span>
          </>
        )}
        {(!valid || passAt < 93) && <span className="absolute right-0 text-muted-foreground">100</span>}
      </div>
      {valid ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-hidden>
          {(['REJECT', 'REVIEW', 'APPROVE'] as const).map((b) => (
            <li key={b} className="flex items-center gap-1.5">
              <span className={cn('size-2.5 rounded-sm', BAND_STYLE[b].bar)} />
              <span className="font-medium">{BAND_STYLE[b].label}</span>
              <span className="text-muted-foreground tabular-nums">{bandText(b, t)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">Auto-Reject must be lower than Auto-Pass.</p>
      )}
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

        <p className="text-xs text-muted-foreground">{RETRY_NOTE}</p>
      </fieldset>
    </section>
  )
}

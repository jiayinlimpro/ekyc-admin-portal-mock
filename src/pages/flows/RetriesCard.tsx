// REQ: DEC-108 — "Retries allowed" per phase, apart from the thresholds: every submitted attempt that fails in that phase
// uses one; retakes before submitting are free.
import { Minus, Plus } from 'lucide-react'
import { OpenQuestionTag } from '@/components/common/OpenQuestionTag'
import { Button } from '@/components/ui/button'
import { RETRY_LIMITS } from '@/domain/openQuestions'
import { RETRY_PHASE_LABELS, RETRY_PHASES, type FlowSettings, type RegistryEntry, type RetryPhase } from '@/domain/types'
import { Card } from '../projects/settingsUi'

const LAST_DECIDES = 'Used up: the last result decides (Pending Review or Rejected).'

/**
 * What uses a retry in each phase, and what happens when they are used up (DEC-16, DEC-112). The face match belongs to
 * the selfie phase on V1, to liveness otherwise.
 */
function usedBy(phase: RetryPhase, v1: boolean): string {
  if (phase === 'DOCUMENT') return 'A submitted ID image that fails any check (face, size, OCR fields). Used up: Failed (no usable ID image).'
  if (phase === 'SELFIE') return 'A submitted selfie that fails its quality check, or a face match below Auto-Pass. Used up: Failed when no selfie was usable; otherwise the last face match decides (Pending Review or Rejected).'
  return v1 ? `A liveness result below Auto-Pass. ${LAST_DECIDES}` : `A liveness or face match result below Auto-Pass (the face match uses the liveness face). ${LAST_DECIDES}`
}

export function RetriesCard({ entry, value, onChange, disabled, errors }: { entry: Pick<RegistryEntry, 'phases' | 'faceMatchMethod'>; value: FlowSettings['retries']; onChange: (v: FlowSettings['retries']) => void; disabled: boolean; errors: Record<string, string> }) {
  const v1 = entry.faceMatchMethod === 'ID_VS_SELFIE'
  const phases = RETRY_PHASES.filter((p) => p !== 'SELFIE' || entry.phases.includes('SELFIE_CAPTURE'))
  return (
    <Card title="Retries allowed" aside={<OpenQuestionTag id="OQ-03" />}>
      <p className="mb-3 text-sm text-muted-foreground">
        Per phase: retries after the first submission. Every submitted attempt that fails in that phase uses one; retaking a photo before submitting is free.
      </p>
      <fieldset disabled={disabled} className="divide-y">
        <legend className="sr-only">Retries allowed per phase</legend>
        {phases.map((p) => {
          const label = RETRY_PHASE_LABELS[p]
          return (
            <div key={p} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1 basis-64">
                <div className="text-sm font-medium">{label}</div>
                <div className="text-xs text-muted-foreground">{usedBy(p, v1)}</div>
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="icon-sm" aria-label={`Fewer ${label} retries`} disabled={value[p] <= RETRY_LIMITS.min} onClick={() => onChange({ ...value, [p]: value[p] - 1 })}>
                  <Minus aria-hidden />
                </Button>
                <output aria-label={`${label} retries allowed`} className="w-8 text-center text-sm font-medium tabular-nums">
                  {value[p]}
                </output>
                <Button type="button" variant="outline" size="icon-sm" aria-label={`More ${label} retries`} disabled={value[p] >= RETRY_LIMITS.max} onClick={() => onChange({ ...value, [p]: value[p] + 1 })}>
                  <Plus aria-hidden />
                </Button>
                <span className="w-32 text-xs text-muted-foreground">up to {value[p] + 1} submissions</span>
              </div>
              {errors[`retries.${p}`] && <p className="w-full text-xs text-destructive">{errors[`retries.${p}`]}</p>}
            </div>
          )
        })}
      </fieldset>
    </Card>
  )
}

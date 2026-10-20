// Face match and liveness thresholds: Low / Standard / High presets or Advanced custom values (DEC-10, DEC-11, DEC-19).
import { THRESHOLD_PRESETS } from './openQuestions'
import { THRESHOLD_PRESETS_ORDER, type Check, type ThresholdChoice, type ThresholdPreset } from './types'

export interface Thresholds {
  autoReject: number
  autoPass: number
}

export const PRESET_LABELS: Record<ThresholdPreset | 'ADVANCED', string> = { LOW: 'Low', STANDARD: 'Standard', HIGH: 'High', ADVANCED: 'Advanced' }

/** The numbers a choice stands for. Presets come from OQ-02. */
export function resolveThreshold(check: Check, choice: ThresholdChoice, presets = THRESHOLD_PRESETS): Thresholds {
  return choice.preset === 'ADVANCED' ? { autoReject: choice.autoReject, autoPass: choice.autoPass } : presets[check][choice.preset]
}

/** The preset whose numbers equal these values, if any (e.g. to show which button an Advanced pair happens to match). */
export function matchingPreset(check: Check, t: Thresholds, presets = THRESHOLD_PRESETS): ThresholdPreset | undefined {
  return THRESHOLD_PRESETS_ORDER.find((p) => presets[check][p].autoReject === t.autoReject && presets[check][p].autoPass === t.autoPass)
}

export type Band = 'REJECT' | 'REVIEW' | 'APPROVE'

/** Segments of the 0–100 band bar, in order; empty segments are left out. */
export function bandSegments(t: Thresholds): { band: Band; from: number; to: number }[] {
  const segs: { band: Band; from: number; to: number }[] = [
    { band: 'REJECT', from: 0, to: t.autoReject },
    { band: 'REVIEW', from: t.autoReject, to: t.autoPass },
    { band: 'APPROVE', from: t.autoPass, to: 100 },
  ]
  return segs.filter((s) => s.to > s.from)
}

/** "Reject below 85 · Review 85 to 95 · Approve at 95 and above" */
export function describeBands(t: Thresholds): string {
  return `Reject below ${t.autoReject} · Review ${t.autoReject} to ${t.autoPass} · Approve at ${t.autoPass} and above`
}

/** Shown under the band text: a result below Auto-Pass is not final while retries remain (DEC-15, DEC-16). */
export const RETRY_NOTE = 'Below approve, the user can retry while retries remain. When retries run out, the last attempt decides.'

// REQ: DEC-105 — every engine metric is shown on Verification Detail with its threshold, its result and who sets the
// threshold. Only face match and liveness thresholds come from the flow (DEC-10); the rest are fixed by the engine.
import type { Thresholds } from './thresholds'
import type { DocumentType, DuplicateUserCheck, IdCaptureTelemetry, SelfieTelemetry } from './types'

/** Fixed by the engine (DEC-105). Not configurable by anyone. */
export const ENGINE_THRESHOLDS = {
  facesFound: 1, // exactly one face on the ID
  faceConfidenceMin: 90, // ≥
  imageMinPx: 320, // ≥ on both sides
  sharpnessMin: 25, // >
  brightnessMin: 25, // >
  maxYawDeg: 30, // within ±
  maxPitchDeg: 30, // within ±
  faceSizeMinPx: 50, // ≥
  matchedFaceConfidenceMin: 90, // >
  duplicateSimilarityMin: 90, // ≥ = existing user
} as const

/** REQ: DEC-35 — the OCR fields each document type needs. */
export const OCR_FIELDS: Record<DocumentType, readonly string[]> = {
  MYKAD: ['IC', 'Gender', 'Name', 'Address'],
  DRIVING_LICENSE: ['IC', 'Validity date', 'Name', 'Nationality', 'Class', 'Address'],
  PASSPORT: ['MRZ (2 lines)'],
}

export type MetricSource = 'FLOW' | 'ENGINE'
export type MetricResult = 'PASS' | 'REVIEW' | 'FAIL'

export interface MetricRow {
  id: string
  label: string
  value: string
  threshold: string
  source: MetricSource
  result: MetricResult
}

const T = ENGINE_THRESHOLDS
const n1 = (x: number) => x.toFixed(1)
const deg = (x: number) => `${x > 0 ? '+' : ''}${n1(x)}°`
const ok = (pass: boolean): MetricResult => (pass ? 'PASS' : 'FAIL')
const engine = (id: string, label: string, value: string, threshold: string, pass: boolean): MetricRow => ({ id, label, value, threshold, source: 'ENGINE', result: ok(pass) })

export function idCaptureMetrics(t: IdCaptureTelemetry, documentType: DocumentType): MetricRow[] {
  const fields = OCR_FIELDS[documentType]
  const found = fields.filter((f) => !t.ocrFieldsMissing.includes(f))
  return [
    engine('id.faces', 'Faces found', String(t.facesFound), `exactly ${T.facesFound}`, t.facesFound === T.facesFound),
    engine('id.faceConfidence', 'Face confidence', n1(t.faceConfidence), `≥ ${T.faceConfidenceMin}`, t.faceConfidence >= T.faceConfidenceMin),
    engine('id.eyes', 'Eyes open', t.eyesOpen ? 'Yes' : 'No', 'Yes', t.eyesOpen),
    engine('id.occluded', 'Face covered', t.occluded ? 'Yes' : 'No', 'No', !t.occluded),
    engine('id.size', 'Image size', `${t.imageWidth} × ${t.imageHeight} px`, `≥ ${T.imageMinPx} × ${T.imageMinPx} px`, t.imageWidth >= T.imageMinPx && t.imageHeight >= T.imageMinPx),
    engine(
      'id.ocr',
      'OCR fields detected',
      `${found.length} / ${fields.length}${t.ocrFieldsMissing.length ? ` (missing: ${t.ocrFieldsMissing.join(', ')})` : ''}`,
      `all: ${fields.join(', ')}`,
      t.ocrFieldsMissing.length === 0,
    ),
  ]
}

export function selfieMetrics(t: SelfieTelemetry): MetricRow[] {
  return [
    engine('selfie.faceConfidence', 'Face confidence', n1(t.faceConfidence), `≥ ${T.faceConfidenceMin}`, t.faceConfidence >= T.faceConfidenceMin),
    engine('selfie.eyes', 'Eyes open', t.eyesOpen ? 'Yes' : 'No', 'Yes', t.eyesOpen),
    engine('selfie.occluded', 'Face covered', t.occluded ? 'Yes' : 'No', 'No', !t.occluded),
    engine('selfie.sharpness', 'Sharpness', n1(t.sharpness), `> ${T.sharpnessMin}`, t.sharpness > T.sharpnessMin),
    engine('selfie.brightness', 'Brightness', n1(t.brightness), `> ${T.brightnessMin}`, t.brightness > T.brightnessMin),
    engine('selfie.yaw', 'Yaw', deg(t.yaw), `within ±${T.maxYawDeg}°`, Math.abs(t.yaw) <= T.maxYawDeg),
    engine('selfie.pitch', 'Pitch', deg(t.pitch), `within ±${T.maxPitchDeg}°`, Math.abs(t.pitch) <= T.maxPitchDeg),
    engine('selfie.faceSize', 'Face size', `${t.faceSizePx} px`, `≥ ${T.faceSizeMinPx} px`, t.faceSizePx >= T.faceSizeMinPx),
  ]
}

/** REQ: DEC-10 / DEC-11 — a flow-set band: ≥ Auto-Pass passes, < Auto-Reject fails, between is review. */
export function bandResult(score: number, t: Thresholds): MetricResult {
  if (score >= t.autoPass) return 'PASS'
  return score < t.autoReject ? 'FAIL' : 'REVIEW'
}

export const bandText = (t: Thresholds) => `Auto-Reject < ${t.autoReject} · Auto-Pass ≥ ${t.autoPass}`

export function flowMetric(id: string, label: string, score: number, t: Thresholds): MetricRow {
  return { id, label, value: n1(score), threshold: bandText(t), source: 'FLOW', result: bandResult(score, t) }
}

export function matchedFaceConfidenceMetric(confidence: number): MetricRow {
  return engine('faceMatch.matchedFaceConfidence', 'Matched face confidence', n1(confidence), `> ${T.matchedFaceConfidenceMin}`, confidence > T.matchedFaceConfidenceMin)
}

/** REQ: DEC-105 — information only: the result never feeds a check or the status. */
export function duplicateUserText(d: DuplicateUserCheck | undefined): string {
  if (!d) return 'Not checked yet'
  if (d.existingUser) return `Existing user found (similarity ${n1(d.similarity ?? 0)}, ≥ ${T.duplicateSimilarityMin})`
  return d.similarity === undefined ? 'New user' : `New user (best match ${n1(d.similarity)}, below ${T.duplicateSimilarityMin})`
}

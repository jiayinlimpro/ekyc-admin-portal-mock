// REQ: DEC-105 — every engine metric is shown on Verification Detail with its threshold, its result and who sets the
// threshold. Only the similarity and liveness bands come from the flow (DEC-10); the rest are fixed by the engine.
// Terms follow the engine workflow: "Similarity" = the face compared with the ID face (compareFaces Similarity);
// "Face match" = confidence that a face is a real face (FaceMatchThreshold on Face.Confidence). Never mix the two.
import type { Thresholds } from './thresholds'
import type { Attempt, DocumentType, DuplicateUserCheck, IdCaptureTelemetry, SelfieTelemetry } from './types'

/** Fixed by the engine (DEC-105). Not configurable by anyone. */
export const ENGINE_THRESHOLDS = {
  facesFound: 1, // exactly one face on the ID
  faceMatchMin: 90, // FaceMatchThreshold: ID face ≥, compared face >
  imageMinPx: 320, // ≥ on both sides
  sharpnessMin: 25, // >
  brightnessMin: 25, // >
  maxYawDeg: 30, // within ±
  maxPitchDeg: 30, // within ±
  faceSizeMinPx: 50, // FacePixelSizeThreshold: configured, but not applied by the selfie check (OQ-32)
  duplicateSimilarityMin: 90, // UserMatchThreshold: ≥ = existing user
} as const

/** REQ: DEC-35 — the OCR fields each document type needs. */
export const OCR_FIELDS: Record<DocumentType, readonly string[]> = {
  MYKAD: ['IC', 'Gender', 'Name', 'Address'],
  DRIVING_LICENSE: ['IC', 'Validity date', 'Name', 'Nationality', 'Class', 'Address'],
  PASSPORT: ['MRZ (2 lines)'],
}

export type MetricSource = 'FLOW' | 'ENGINE'
export type MetricResult = 'PASS' | 'REVIEW' | 'FAIL' | 'INFO'

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
    engine('id.faceMatch', 'Face match', n1(t.faceConfidence), `≥ ${T.faceMatchMin}`, t.faceConfidence >= T.faceMatchMin),
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

/** The engine's Selfie Quality Check, in its order; face size is shown for information (OQ-32). */
export function selfieMetrics(t: SelfieTelemetry): MetricRow[] {
  return [
    engine('selfie.eyes', 'Eyes open', t.eyesOpen ? 'Yes' : 'No', 'Yes', t.eyesOpen),
    engine('selfie.occluded', 'Face covered', t.occluded ? 'Yes' : 'No', 'No', !t.occluded),
    engine('selfie.sharpness', 'Sharpness', n1(t.sharpness), `> ${T.sharpnessMin}`, t.sharpness > T.sharpnessMin),
    engine('selfie.brightness', 'Brightness', n1(t.brightness), `> ${T.brightnessMin}`, t.brightness > T.brightnessMin),
    engine('selfie.yaw', 'Yaw', deg(t.yaw), `within ±${T.maxYawDeg}°`, Math.abs(t.yaw) <= T.maxYawDeg),
    engine('selfie.pitch', 'Pitch', deg(t.pitch), `within ±${T.maxPitchDeg}°`, Math.abs(t.pitch) <= T.maxPitchDeg),
    { id: 'selfie.faceSize', label: 'Face size', value: `${t.faceSizePx} px`, threshold: `${T.faceSizeMinPx} px configured, not checked`, source: 'ENGINE', result: 'INFO' },
  ]
}

/** REQ: DEC-105 — the selfie passed the engine's check (face size is not part of it). Only then is it compared with the ID. */
export const selfiePasses = (t: SelfieTelemetry) => selfieMetrics(t).every((m) => m.result !== 'FAIL')

/** REQ: DEC-10 / DEC-11 — a flow-set band: ≥ Auto-Pass passes, < Auto-Reject fails, between is review. */
export function bandResult(score: number, t: Thresholds): MetricResult {
  if (score >= t.autoPass) return 'PASS'
  return score < t.autoReject ? 'FAIL' : 'REVIEW'
}

export const bandText = (t: Thresholds) => `Auto-Reject < ${t.autoReject} · Auto-Pass ≥ ${t.autoPass}`

export function flowMetric(id: string, label: string, score: number, t: Thresholds): MetricRow {
  return { id, label, value: n1(score), threshold: bandText(t), source: 'FLOW', result: bandResult(score, t) }
}

/** "Face match": confidence that a face is clearly detected in the compared image (> 90; not liveness). Not the similarity. */
export function faceMatchMetric(confidence: number): MetricRow {
  return engine('compare.faceMatch', 'Face match', n1(confidence), `> ${T.faceMatchMin}`, confidence > T.faceMatchMin)
}

/** REQ: DEC-105 — information only: the result never feeds a check or the status. */
export function duplicateUserText(d: DuplicateUserCheck | undefined): string {
  if (!d) return 'Not checked yet'
  if (d.existingUser) return `Existing user found (similarity ${n1(d.similarity ?? 0)}, ≥ ${T.duplicateSimilarityMin})`
  return d.similarity === undefined ? 'New user' : `New user (best match ${n1(d.similarity)}, below ${T.duplicateSimilarityMin})`
}

/** The last attempt with a face image: the evidence shown next to the document. */
export const lastFaceAttempt = (c: { attempts: readonly Attempt[] }): Attempt | undefined => c.attempts.findLast((a) => a.faceImage)

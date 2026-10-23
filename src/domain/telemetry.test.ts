import { describe, expect, it } from 'vitest'
import { bandResult, duplicateUserText, flowMetric, idCaptureMetrics, matchedFaceConfidenceMetric, selfieMetrics } from './telemetry'
import type { IdCaptureTelemetry, SelfieTelemetry } from './types'

const ID_OK: IdCaptureTelemetry = { facesFound: 1, faceConfidence: 98.2, eyesOpen: true, occluded: false, imageWidth: 1280, imageHeight: 800, ocrFieldsMissing: [] }
const SELFIE_OK: SelfieTelemetry = { faceConfidence: 99.1, eyesOpen: true, occluded: false, sharpness: 60, brightness: 70, yaw: -4.2, pitch: 3, faceSizePx: 180 }
const failing = (rows: { label: string; result: string }[]) => rows.filter((r) => r.result === 'FAIL').map((r) => r.label)

describe('engine metrics (DEC-105)', () => {
  it('Given a good ID image, then every ID capture metric passes and the threshold is fixed by the engine', () => {
    const rows = idCaptureMetrics(ID_OK, 'MYKAD')
    expect(rows.map((r) => r.label)).toEqual(['Faces found', 'Face confidence', 'Eyes open', 'Face covered', 'Image size', 'OCR fields detected'])
    expect(rows.every((r) => r.result === 'PASS' && r.source === 'ENGINE')).toBe(true)
    expect(rows.find((r) => r.label === 'OCR fields detected')!.value).toBe('4 / 4')
  })

  it('Given a small image, two faces and a missing field, then exactly those fail, at the documented limits', () => {
    const rows = idCaptureMetrics({ ...ID_OK, facesFound: 2, imageWidth: 320, imageHeight: 319, ocrFieldsMissing: ['Class'] }, 'DRIVING_LICENSE')
    expect(failing(rows)).toEqual(['Faces found', 'Image size', 'OCR fields detected'])
    expect(rows.find((r) => r.label === 'OCR fields detected')!.value).toBe('5 / 6 (missing: Class)')
    expect(failing(idCaptureMetrics({ ...ID_OK, faceConfidence: 89.9 }, 'MYKAD'))).toEqual(['Face confidence'])
    expect(failing(idCaptureMetrics({ ...ID_OK, faceConfidence: 90 }, 'MYKAD'))).toEqual([])
  })

  it('Given selfie values on and past the limits, then > 25 and ±30° are applied as written', () => {
    expect(failing(selfieMetrics(SELFIE_OK))).toEqual([])
    expect(failing(selfieMetrics({ ...SELFIE_OK, sharpness: 25, brightness: 25.1, yaw: 30, pitch: -30.5, faceSizePx: 49 }))).toEqual(['Sharpness', 'Pitch', 'Face size'])
    expect(selfieMetrics(SELFIE_OK).find((r) => r.label === 'Yaw')!.value).toBe('-4.2°')
  })

  it('Given face confidence and similarity, then they are separate rows with different labels and sources', () => {
    const conf = matchedFaceConfidenceMetric(99.2)
    const sim = flowMetric('faceMatch.similarity', 'Similarity', 83.5, { autoReject: 75, autoPass: 85 })
    expect(conf).toMatchObject({ label: 'Matched face confidence', source: 'ENGINE', result: 'PASS' })
    expect(sim).toMatchObject({ label: 'Similarity', source: 'FLOW', result: 'REVIEW', threshold: 'Auto-Reject < 75 · Auto-Pass ≥ 85' })
    expect(matchedFaceConfidenceMetric(90).result).toBe('FAIL') // > 90
  })
})

describe('flow bands (DEC-11)', () => {
  it('Given a score, then ≥ Auto-Pass passes, < Auto-Reject fails, otherwise review', () => {
    const t = { autoReject: 70, autoPass: 85 }
    expect([bandResult(85, t), bandResult(84.9, t), bandResult(70, t), bandResult(69.9, t)]).toEqual(['PASS', 'REVIEW', 'REVIEW', 'FAIL'])
  })
})

describe('duplicate user (DEC-105, information only)', () => {
  it('Given the face search result, then the text says new or existing with the similarity', () => {
    expect(duplicateUserText(undefined)).toBe('Not checked yet')
    expect(duplicateUserText({ existingUser: false, similarity: 41.2 })).toBe('New user (best match 41.2, below 90)')
    expect(duplicateUserText({ existingUser: true, similarity: 97.6 })).toBe('Existing user found (similarity 97.6, ≥ 90)')
  })
})

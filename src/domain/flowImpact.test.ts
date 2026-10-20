import { describe, expect, it } from 'vitest'
import { flowImpact } from './flowImpact'
import { newFlowSettings } from './flowSettings'
import type { FlowSettings } from './types'

const flow = { checks: ['FACE_MATCH', 'LIVENESS'] as const, faceMatchMethod: 'ID_VS_LIVENESS' as const, hasRisk: false }
const standard: FlowSettings = { ...newFlowSettings({ phases: ['ID_CAPTURE', 'LIVENESS_CHECK'] }), sessionExpiryMin: 30, acceptedDocuments: ['MYKAD'] }
const high: FlowSettings = { ...standard, checks: { ...standard.checks, LIVENESS: { ...standard.checks.LIVENESS, threshold: { preset: 'HIGH' } } } }

describe('flowImpact (MOCK-10)', () => {
  it('Given High liveness, then sessions approved at 88 under Standard would retry or go to review; 95 stays approved', () => {
    const cases = [
      { submissions: { FACE_MATCH: [96], LIVENESS: [88] } }, // Standard: approve (≥ 85). High: below 92 with retries left → would retry
      { submissions: { FACE_MATCH: [96, 96, 96, 96], LIVENESS: [60, 61, 62, 88] } }, // retries used up: High puts 88 in review
      { submissions: { FACE_MATCH: [96], LIVENESS: [95] } },
    ]
    const r = flowImpact(cases, flow, standard, high)
    expect(r.total).toBe(3)
    expect(r.before.APPROVED).toBe(3)
    expect(r.after).toMatchObject({ APPROVED: 1, PROCESSING: 1, PENDING_REVIEW: 1 })
    expect(r.changed).toBe(2)
  })

  it('Given identical settings, then nothing changes', () => {
    expect(flowImpact([{ submissions: { FACE_MATCH: [96], LIVENESS: [88] } }], flow, standard, standard).changed).toBe(0)
  })
})

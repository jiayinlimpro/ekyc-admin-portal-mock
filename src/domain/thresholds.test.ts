import { describe, expect, it } from 'vitest'
import { CONDITIONS, VISIBLE_CONDITIONS, checkCondition } from './conditions'
import { THRESHOLD_PRESETS } from './openQuestions'
import { bandSegments, describeBands, matchingPreset, resolveThreshold } from './thresholds'

describe('threshold presets (DEC-19, OQ-02)', () => {
  it('Given a preset, then its numbers come from OQ-02; Low is lenient and High is strict', () => {
    for (const check of ['FACE_MATCH', 'LIVENESS'] as const) {
      const [low, std, high] = (['LOW', 'STANDARD', 'HIGH'] as const).map((p) => resolveThreshold(check, { preset: p }))
      expect(std).toEqual(THRESHOLD_PRESETS[check].STANDARD)
      expect(low.autoPass).toBeLessThan(std.autoPass)
      expect(high.autoPass).toBeGreaterThan(std.autoPass)
      for (const t of [low, std, high]) expect(t.autoReject).toBeLessThan(t.autoPass)
    }
  })

  it('Given Advanced, then the custom numbers are used, and a pair equal to a preset is recognised', () => {
    expect(resolveThreshold('FACE_MATCH', { preset: 'ADVANCED', autoReject: 72, autoPass: 88 })).toEqual({ autoReject: 72, autoPass: 88 })
    expect(matchingPreset('LIVENESS', { autoReject: 70, autoPass: 85 })).toBe('STANDARD')
    expect(matchingPreset('LIVENESS', { autoReject: 71, autoPass: 85 })).toBeUndefined()
  })

  it('Given thresholds, then the 0–100 band bar has Reject, Review, Approve segments and the screenshot wording', () => {
    expect(bandSegments({ autoReject: 90, autoPass: 97 })).toEqual([
      { band: 'REJECT', from: 0, to: 90 },
      { band: 'REVIEW', from: 90, to: 97 },
      { band: 'APPROVE', from: 97, to: 100 },
    ])
    expect(describeBands({ autoReject: 90, autoPass: 97 })).toBe('Reject below 90 · Review 90 to 97 · Approve at 97 and above')
  })

  it('Given Auto-Pass at 100 or Auto-Reject at 0, then the empty segment is left out', () => {
    expect(bandSegments({ autoReject: 0, autoPass: 100 }).map((s) => s.band)).toEqual(['REVIEW'])
  })
})

describe('condition catalogue (DEC-35)', () => {
  it('Given the sheet, then 23 conditions, one success and one record-only', () => {
    expect(CONDITIONS).toHaveLength(23)
    expect(CONDITIONS.filter((c) => c.kind === 'SUCCESS').map((c) => c.label)).toEqual(['All stages passed'])
    expect(CONDITIONS.filter((c) => c.recordOnly).map((c) => c.id)).toEqual(['EXISTING_USER'])
  })

  it('Given the existing-user condition, then it is not among the reasons a case shows (record-only; DEC-105 shows the result itself)', () => {
    expect(VISIBLE_CONDITIONS.some((c) => c.id === 'EXISTING_USER')).toBe(false)
  })

  it('Given a check below Auto-Pass, then the condition follows the face match method and whether a retry is allowed', () => {
    expect(checkCondition('FACE_MATCH', 'ID_VS_SELFIE', true).label).toBe('ID face and Selfie face do not match (Retry Allowed)')
    expect(checkCondition('FACE_MATCH', 'ID_VS_LIVENESS', false).label).toBe('Liveness face does not match ID face (Retry Not Allowed)')
    expect(checkCondition('LIVENESS', 'ID_VS_SELFIE', false).label).toBe('Face not live (Retry Not Allowed)')
  })
})

import { describe, expect, it } from 'vitest'
import { labelPositions } from './bandLabels'

describe('band bar labels (DEC-19)', () => {
  it('Given thresholds far apart, then each number sits on its mark', () => {
    expect(labelPositions(70, 85)).toEqual([70, 85])
  })

  it('Given thresholds close together near 100 (High: 90 and 97), then they are pushed apart and kept inside the bar', () => {
    const [a, b] = labelPositions(90, 97)
    expect(b - a).toBeGreaterThanOrEqual(8)
    expect(b).toBeLessThanOrEqual(97)
    expect(a).toBeLessThanOrEqual(90)
  })

  it('Given thresholds close together near 0, then they stay inside the bar', () => {
    const [a, b] = labelPositions(1, 3)
    expect(a).toBeGreaterThanOrEqual(3)
    expect(b - a).toBeGreaterThanOrEqual(8)
  })
})

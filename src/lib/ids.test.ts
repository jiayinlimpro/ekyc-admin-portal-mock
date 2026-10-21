import { describe, expect, it } from 'vitest'
import { caseIdOf, fx, isId, newId, stableId } from './ids'

describe('ids (DEC-97)', () => {
  it('Given a new record, then a prefixed cuid2-shaped ID, different each time', () => {
    const a = newId('prj')
    expect(isId('prj', a)).toBe(true)
    expect(a).toHaveLength(4 + 24)
    expect(newId('prj')).not.toBe(a)
  })

  it('Given a seeded record, then the same handle always gives the same ID, and different handles differ', () => {
    expect(fx('PRJ-0001')).toBe(fx('PRJ-0001'))
    expect(fx('PRJ-0001')).not.toBe(fx('PRJ-0002'))
    expect(isId('usr', fx('USR-2026-0012'))).toBe(true)
    expect(isId('ver', caseIdOf('KYC-260901-900013'))).toBe(true)
    expect(stableId('evt', '1')).not.toBe(stableId('att', '1'))
  })

  it('Given an unknown handle, then it fails loudly', () => {
    expect(() => fx('XYZ-1')).toThrow('Unknown fixture handle')
  })
})

describe('ids used outside the app', () => {
  it('Given S10, then its case ID is the one hard-coded in the e2e test', () => {
    expect(caseIdOf('KYC-260901-900010')).toBe('ver_ngbokaq0u76jcmczfoi2vr52')
  })
})

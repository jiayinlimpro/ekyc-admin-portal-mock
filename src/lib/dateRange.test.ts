import { describe, expect, it } from 'vitest'
import { addDays, addMonths, dayState, formatRange, monthGrid, mytToday, pickDay, presets } from './dateRange'

describe('date-range calendar (DEC-101)', () => {
  it('Given a month, then weeks start on Monday and other months’ days are blank', () => {
    const weeks = monthGrid({ year: 2026, month: 9 }) // October 2026 starts on a Thursday
    expect(weeks[0]).toEqual([null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'])
    expect(weeks.flat().filter(Boolean)).toHaveLength(31)
    expect(weeks.at(-1)!.at(-1)).toBeNull() // 31 Oct is a Saturday
  })

  it('Given the first click, then it starts the range; the second ends it; a day before the start swaps them', () => {
    const started = pickDay({ from: '', to: '' }, '2026-10-10')
    expect(started).toEqual({ from: '2026-10-10', to: '', done: false })
    expect(pickDay(started, '2026-10-15')).toEqual({ from: '2026-10-10', to: '2026-10-15', done: true })
    expect(pickDay(started, '2026-10-03')).toEqual({ from: '2026-10-03', to: '2026-10-10', done: true })
    expect(pickDay({ from: '2026-10-03', to: '2026-10-10' }, '2026-10-20')).toEqual({ from: '2026-10-20', to: '', done: false }) // a new range
  })

  it('Given a range, then start, end and the days between are marked; while choosing, up to the day under the pointer', () => {
    const range = { from: '2026-10-10', to: '2026-10-15' }
    expect(dayState('2026-10-10', range)).toMatchObject({ start: true, end: false })
    expect(dayState('2026-10-12', range)).toMatchObject({ inside: true, preview: false })
    expect(dayState('2026-10-15', range)).toMatchObject({ end: true })
    expect(dayState('2026-10-16', range)).toMatchObject({ start: false, end: false, inside: false })
    const choosing = { from: '2026-10-10', to: '' }
    expect(dayState('2026-10-08', choosing, '2026-10-06')).toMatchObject({ inside: true, preview: true }) // hovering before the start
    expect(dayState('2026-10-06', choosing, '2026-10-06')).toMatchObject({ start: true, preview: true })
    expect(dayState('2026-10-10', choosing)).toMatchObject({ start: true, end: true }) // just the start, no pointer
  })

  it('Given today in Malaysia, then the presets end today and the dates move across months and years', () => {
    expect(mytToday(new Date('2026-10-21T16:30:00.000Z'))).toBe('2026-10-22') // already the 22nd in MYT
    expect(presets('2026-10-22').map((p) => [p.label, p.range.from])).toEqual([
      ['Today', '2026-10-22'],
      ['Last 7 days', '2026-10-16'],
      ['Last 30 days', '2026-09-23'],
      ['This month', '2026-10-01'],
    ])
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addMonths({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 })
  })

  it('Given a range, then the field reads as one value', () => {
    expect(formatRange({ from: '2026-10-01', to: '2026-10-15' })).toBe('01 Oct 2026 – 15 Oct 2026')
    expect(formatRange({ from: '2026-10-01', to: '2026-10-01' })).toBe('01 Oct 2026')
    expect(formatRange({ from: '2026-10-01', to: '' })).toBe('From 01 Oct 2026')
    expect(formatRange({ from: '', to: '' })).toBe('')
  })
})

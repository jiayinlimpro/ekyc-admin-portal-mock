import { describe, expect, it } from 'vitest'
import { formatRemaining, formatSeconds, mytDateToUtcIso } from '@/lib/format'
import { DEFAULT_FILTERS, DEFAULT_PAGE_SIZE, isDefaultView, nextSort, parseListParams, toQuery, toSearchParams, validateFilters, type ListParams } from './listQuery'
import { fx } from '@/lib/ids'

const parse = (qs: string) => parseListParams(new URLSearchParams(qs))

describe('parseListParams / toSearchParams', () => {
  it('Given no params, then the DEC-43 default view: Pending Review, oldest first, page 1', () => {
    expect(parse('')).toEqual({ filters: DEFAULT_FILTERS, page: 1, pageSize: DEFAULT_PAGE_SIZE })
    expect(DEFAULT_FILTERS).toMatchObject({ statuses: ['PENDING_REVIEW'] })
    expect(parse('').sort).toBeUndefined() // the default order: Last updated, oldest first
  })

  it('round-trips every filter through the URL', () => {
    const p: ListParams = {
      filters: {
        referenceNo: 'KYC-2609',
        fullName: 'tan',
        statuses: ['PENDING_REVIEW', 'REJECTED'],
        projectId: fx('PRJ-0002'),
        flowId: fx('FLW-0004'),
        workflowVersion: 'V3',
        claim: 'OTHERS',
        createdFrom: '2026-09-01',
        createdTo: '2026-09-25',
        riskResults: ['HIGH'],
        lastUpdatedBy: 'MANUAL',
      },
      sort: { by: 'riskResult', dir: 'desc' },
      page: 3,
      pageSize: 50,
    }
    expect(parseListParams(toSearchParams(p))).toEqual(p)
  })

  it('Given the default view, then the URL is empty; "every status" is written as status=ALL', () => {
    expect(toSearchParams({ filters: DEFAULT_FILTERS, page: 1, pageSize: DEFAULT_PAGE_SIZE }).toString()).toBe('')
    const all = toSearchParams({ filters: { ...DEFAULT_FILTERS, statuses: [] }, page: 1, pageSize: DEFAULT_PAGE_SIZE })
    expect(all.toString()).toBe('status=ALL')
    expect(parseListParams(all).filters.statuses).toEqual([])
  })

  it('Given unknown statuses (e.g. a stale CLAIMED link), then they are dropped (DEC-01, DEC-20)', () => {
    expect(parse('status=CLAIMED,APPROVED,MANUAL_APPROVED,APPROVED').filters.statuses).toEqual(['APPROVED'])
  })

  it('Given junk page, size, dates, claim and updatedBy, then defaults are used', () => {
    expect(parse('page=-2&size=7&from=25/09/2026&updatedBy=ROBOT&claim=SOMEONE')).toEqual({ filters: DEFAULT_FILTERS, page: 1, pageSize: DEFAULT_PAGE_SIZE })
  })

  it('Given a column sort, then it is written as column.direction; an old "newest" link means Last updated descending (DEC-100)', () => {
    expect(toSearchParams({ filters: DEFAULT_FILTERS, sort: { by: 'status', dir: 'asc' }, page: 1, pageSize: DEFAULT_PAGE_SIZE }).toString()).toBe('sort=status.asc')
    expect(parse('sort=newest').sort).toEqual({ by: 'lastUpdatedAt', dir: 'desc' })
    expect(parse('sort=fullName.asc').sort).toBeUndefined() // not sortable (FRS)
    expect(parse('sort=status.sideways').sort).toBeUndefined()
  })

  it('Given clicks on one column, then ascending, descending, then the default order; another column starts at ascending (DEC-100)', () => {
    const asc = nextSort(undefined, 'referenceNo')
    expect(asc).toEqual({ by: 'referenceNo', dir: 'asc' })
    const desc = nextSort(asc, 'referenceNo')
    expect(desc).toEqual({ by: 'referenceNo', dir: 'desc' })
    expect(nextSort(desc, 'referenceNo')).toBeUndefined()
    expect(nextSort(desc, 'status')).toEqual({ by: 'status', dir: 'asc' })
  })

  it('knows the default view whatever the status order', () => {
    expect(isDefaultView(DEFAULT_FILTERS)).toBe(true)
    expect(isDefaultView({ ...DEFAULT_FILTERS, claim: 'MINE' })).toBe(false)
  })
})

describe('toQuery', () => {
  it('converts MYT dates to a full UTC day range', () => {
    const q = toQuery(parse('from=2026-09-25&to=2026-09-25'))
    expect(q.createdFrom).toBe('2026-09-24T16:00:00.000Z')
    expect(q.createdTo).toBe('2026-09-25T15:59:59.999Z')
  })

  it('Given the header shows several projects, then the Project filter narrows within them; one outside is ignored', () => {
    expect(toQuery(parse(''), [fx('PRJ-0001'), fx('PRJ-0002')]).projectIds).toEqual([fx('PRJ-0001'), fx('PRJ-0002')])
    expect(toQuery(parse(`project=${fx('PRJ-0002')}`), [fx('PRJ-0001'), fx('PRJ-0002')]).projectIds).toEqual([fx('PRJ-0002')])
    expect(toQuery(parse(`project=${fx('PRJ-0003')}`), [fx('PRJ-0001')]).projectIds).toEqual([fx('PRJ-0001')])
  })

  it('leaves empty filters out of the service query', () => {
    expect(toQuery(parse('status=ALL'))).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE })
    expect(toQuery(parse('status=ALL&sort=status.desc')).sort).toEqual({ by: 'status', dir: 'desc' })
  })
})

describe('validateFilters', () => {
  it('Given from after to, then an error', () => {
    expect(validateFilters({ ...DEFAULT_FILTERS, createdFrom: '2026-09-26', createdTo: '2026-09-25' })).toBeDefined()
    expect(validateFilters({ ...DEFAULT_FILTERS, createdFrom: '2026-09-25', createdTo: '2026-09-25' })).toBeUndefined()
  })
})

describe('formatting helpers', () => {
  it('formats the claim countdown', () => {
    expect(formatRemaining(12 * 60_000 + 30_000)).toBe('12 min left')
    expect(formatRemaining(45_000)).toBe('45 s left')
    expect(formatRemaining(0)).toBe('expired')
  })

  it('Given a duration in seconds, then it reads as minutes and seconds (DEC-53)', () => {
    expect(formatSeconds(1800)).toBe('30 min')
    expect(formatSeconds(150)).toBe('2 min 30 s')
    expect(formatSeconds(45)).toBe('45 s')
  })

  it('maps a MYT date to its UTC start', () => {
    expect(mytDateToUtcIso('2026-01-01')).toBe('2025-12-31T16:00:00.000Z')
  })
})

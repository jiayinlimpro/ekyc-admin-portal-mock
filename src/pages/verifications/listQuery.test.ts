import { describe, expect, it } from 'vitest'
import { formatRemaining, mytDateToUtcIso } from '@/lib/format'
import { DEFAULT_PAGE_SIZE, EMPTY_FILTERS, parseListParams, toQuery, toSearchParams, validateFilters, type ListParams } from './listQuery'

const parse = (qs: string) => parseListParams(new URLSearchParams(qs))

describe('parseListParams / toSearchParams', () => {
  it('Given no params, then empty filters, page 1, default size', () => {
    expect(parse('')).toEqual({ filters: EMPTY_FILTERS, page: 1, pageSize: DEFAULT_PAGE_SIZE })
  })

  it('round-trips every filter through the URL', () => {
    const p: ListParams = {
      filters: {
        referenceNo: 'KYC-2609',
        fullName: 'tan',
        statuses: ['PENDING_REVIEW', 'REJECTED'],
        merchantId: 'MER-0003',
        submittedFrom: '2026-09-01',
        submittedTo: '2026-09-25',
        riskLevels: ['HIGH'],
        claimedBy: 'UNCLAIMED',
        lastUpdatedBy: 'MANUAL',
      },
      page: 3,
      pageSize: 50,
    }
    expect(parseListParams(toSearchParams(p))).toEqual(p)
  })

  it('Given the defaults, then the URL is empty', () => {
    expect(toSearchParams({ filters: EMPTY_FILTERS, page: 1, pageSize: DEFAULT_PAGE_SIZE }).toString()).toBe('')
  })

  it('Given unknown statuses (e.g. a stale CLAIMED link), then they are dropped (DEC-01, DEC-20)', () => {
    expect(parse('status=CLAIMED,APPROVED,MANUAL_APPROVED,APPROVED').filters.statuses).toEqual(['APPROVED'])
  })

  it('Given junk page, size, dates and updatedBy, then defaults are used', () => {
    expect(parse('page=-2&size=7&from=25/09/2026&updatedBy=ROBOT')).toEqual({ filters: EMPTY_FILTERS, page: 1, pageSize: DEFAULT_PAGE_SIZE })
  })
})

describe('toQuery', () => {
  it('converts MYT dates to a full UTC day range', () => {
    const q = toQuery(parse('from=2026-09-25&to=2026-09-25'))
    expect(q.submittedFrom).toBe('2026-09-24T16:00:00.000Z')
    expect(q.submittedTo).toBe('2026-09-25T15:59:59.999Z')
  })

  it('Given a top-bar merchant scope, then it wins over the Merchant filter', () => {
    expect(toQuery(parse('merchant=MER-0002'), 'MER-0005').merchantId).toBe('MER-0005')
    expect(toQuery(parse('merchant=MER-0002')).merchantId).toBe('MER-0002')
  })

  it('leaves empty filters out of the service query', () => {
    expect(toQuery(parse(''))).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE })
  })
})

describe('validateFilters', () => {
  it('Given from after to, then an error', () => {
    expect(validateFilters({ ...EMPTY_FILTERS, submittedFrom: '2026-09-26', submittedTo: '2026-09-25' })).toBeDefined()
    expect(validateFilters({ ...EMPTY_FILTERS, submittedFrom: '2026-09-25', submittedTo: '2026-09-25' })).toBeUndefined()
  })
})

describe('formatting helpers', () => {
  it('formats the claim countdown', () => {
    expect(formatRemaining(12 * 60_000 + 30_000)).toBe('12 min left')
    expect(formatRemaining(45_000)).toBe('45 s left')
    expect(formatRemaining(0)).toBe('expired')
  })

  it('maps a MYT date to its UTC start', () => {
    expect(mytDateToUtcIso('2026-01-01')).toBe('2025-12-31T16:00:00.000Z')
  })
})

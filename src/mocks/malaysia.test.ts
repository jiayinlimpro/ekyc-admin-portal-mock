import { Faker, en } from '@faker-js/faker'
import { describe, expect, it } from 'vitest'
import { NOW } from '@/test/factories'
import { STATES, nric, person } from './malaysia'

const f = new Faker({ locale: [en] })
f.seed(1)
const people = Array.from({ length: 300 }, () => person(f, NOW))

describe('NRIC generator (MOCK-06)', () => {
  it('Given any MyKad person, then NRIC matches YYMMDD-PB-999G', () => {
    for (const p of people) expect(p.pii.nric).toMatch(/^\d{6}-\d{2}-999\d$/)
  })

  it('Given a person, then NRIC YYMMDD equals the date of birth', () => {
    for (const p of people) {
      const [y, m, d] = p.pii.dob.split('-')
      expect(p.pii.nric!.slice(0, 6)).toBe(`${y.slice(2)}${m}${d}`)
    }
  })

  it('Given gender, then the last digit is odd for LELAKI and even for PEREMPUAN', () => {
    for (const p of people) {
      const last = Number(p.pii.nric!.at(-1))
      expect(last % 2 === 1).toBe(p.pii.gender === 'LELAKI')
    }
  })

  it('Given a place-of-birth code, then it is a known state code', () => {
    const codes = STATES.map((s) => s.code)
    for (const p of people) expect(codes).toContain(p.pii.nric!.slice(7, 9))
  })

  it('builds the NRIC deterministically from its inputs', () => {
    const g = new Faker({ locale: [en] })
    g.seed(5)
    expect(nric('1990-04-15', '10', 'LELAKI', g)).toMatch(/^900415-10-999[13579]$/)
  })
})

describe('addresses', () => {
  it('Given an address, then its postcode falls inside the range of its city and state', () => {
    for (const p of people) {
      const state = STATES.find((s) => p.pii.address.endsWith(s.name.toUpperCase()))!
      expect(state).toBeDefined()
      const city = state.cities.find((c) => p.pii.address.includes(` ${c.city.toUpperCase()},`))!
      const postcode = Number(/(\d{5}) /.exec(p.pii.address)![1])
      expect(postcode).toBeGreaterThanOrEqual(city.postcode[0])
      expect(postcode).toBeLessThanOrEqual(city.postcode[1])
    }
  })
})

describe('passport holders', () => {
  it('Given a PASSPORT person, then no NRIC and a fake passport number', () => {
    const p = person(f, NOW, 'PASSPORT')
    expect(p.pii.nric).toBeUndefined()
    expect(p.pii.passportNo).toMatch(/^X99\d{6}$/)
    expect(p.pii.nationality).not.toBe('WARGANEGARA')
  })
})

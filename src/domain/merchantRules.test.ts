import { describe, expect, it } from 'vitest'
import { apiAccess, merchantAllowsSignIn, normalizeRegistrationNo, statusChangeErrors, validateMerchantProfile, type MerchantProfileInput } from './merchantRules'

const ok: MerchantProfileInput = { name: 'Nusantara Pay Sdn Bhd', registrationNo: '2021-01-012345', country: 'MY', contactName: 'Aminah Binti Salleh', contactEmail: 'aminah@nusantara.example', contactPhone: '+60 12-345 6789' }
const countries = (c: string) => ['MY', 'SG', 'AU'].includes(c)
const errors = (input: Partial<MerchantProfileInput>, others: { registrationNo: string; country: string }[] = [], emailInUse = false) =>
  validateMerchantProfile({ ...ok, ...input }, others, emailInUse, countries)
const fields = (e: { field: string }[]) => e.map((x) => x.field)

describe('merchant profile (DEC-98)', () => {
  it('Given complete FRS fields, then valid; Malaysian registration numbers are compared without dashes', () => {
    expect(errors({})).toEqual([])
    expect(normalizeRegistrationNo('MY', '2021-01-012345')).toBe('202101012345')
  })

  it('Given empty required fields, then the FRS messages', () => {
    expect(errors({ name: ' ', registrationNo: '', country: '', contactEmail: 'nope' }).map((e) => e.message)).toEqual([
      'Company name cannot be empty',
      'Please select a valid base jurisdiction',
      'Business registration number is required',
      'Email format is incorrect',
    ])
  })

  it('Given odd characters in the name, then "Invalid characters detected"', () => {
    expect(errors({ name: 'Acme <script>' })[0].message).toBe('Invalid characters detected')
    expect(errors({ name: "O'Brien & Sons (M) Sdn. Bhd." })).toEqual([])
  })

  it('Given Malaysia, then the SSM 12-digit format; other countries are free text', () => {
    expect(fields(errors({ registrationNo: '1312525-A' }))).toEqual(['registrationNo'])
    expect(errors({ registrationNo: '201907000001' })[0].field).toBe('registrationNo') // entity type 07 does not exist
    expect(errors({ country: 'SG', registrationNo: '201912345K' })).toEqual([])
  })

  it('Given a registration number already used in the same country, then refused; in another country, allowed', () => {
    expect(errors({}, [{ country: 'MY', registrationNo: '202101012345' }])[0].message).toBe('Registration number already exists')
    expect(errors({ country: 'SG', registrationNo: '202101012345' }, [{ country: 'MY', registrationNo: '202101012345' }])).toEqual([])
  })

  it('Given a contact email that is already a user, or a bad phone, then refused', () => {
    expect(errors({}, [], true)[0].message).toBe('Email address already active in system user directories')
    expect(errors({ contactPhone: '12ab' })[0].message).toBe('Phone number format is invalid')
    expect(errors({ contactPhone: '' })).toEqual([])
  })
})

describe('merchant status (DEC-98)', () => {
  it('Given each status, then only the allowed changes, each with a reason', () => {
    expect(statusChangeErrors('ONBOARDING', 'ACTIVE', 'Contract signed, go live')).toEqual([])
    expect(statusChangeErrors('ONBOARDING', 'SUSPENDED', 'Missed the first payment')[0].field).toBe('status')
    expect(statusChangeErrors('SUSPENDED', 'ACTIVE', 'Payment received')).toEqual([])
    expect(statusChangeErrors('TERMINATED', 'ACTIVE', 'Customer came back')[0].field).toBe('status')
    expect(statusChangeErrors('ACTIVE', 'SUSPENDED', 'late')[0].field).toBe('reason')
  })

  it('Given a status, then sign-in and API access follow it', () => {
    expect([merchantAllowsSignIn('ONBOARDING'), merchantAllowsSignIn('ACTIVE'), merchantAllowsSignIn('SUSPENDED'), merchantAllowsSignIn('TERMINATED')]).toEqual([true, true, false, false])
    expect([apiAccess('ONBOARDING'), apiAccess('ACTIVE'), apiAccess('SUSPENDED')]).toEqual(['SANDBOX_ONLY', 'LIVE', 'STOPPED'])
  })
})

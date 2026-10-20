import { describe, expect, it } from 'vitest'
import { claimTimeoutError, diffSettings, validateAccessLists, validateGeneral, webhookUrlError } from './projectSettings'

describe('projectSettings (DEC-53, DEC-54)', () => {
  it('Given a claim timeout below 1 minute or not whole, then an error', () => {
    expect(claimTimeoutError(0)).toBeDefined()
    expect(claimTimeoutError(2.5)).toBeDefined()
    expect(claimTimeoutError(1)).toBeUndefined()
  })

  it('Given branding, then a hex colour and an HTTPS logo are required; blank inherits the merchant', () => {
    expect(validateGeneral({ branding: {} })).toEqual([])
    expect(validateGeneral({ branding: { primaryColor: 'blue', logoUrl: 'http://x.example/logo.png' } }).map((e) => e.field)).toEqual(['primaryColor', 'logoUrl'])
  })

  it('Given access lists, then HTTPS redirects, origin without path, IPv4 or CIDR, no duplicates', () => {
    expect(validateAccessLists({ redirectUrls: ['https://a.example/done'], allowedOrigins: ['https://a.example:8443'], ipAllowlist: ['203.0.113.7', '198.51.100.0/24'] })).toEqual([])
    const errors = validateAccessLists({ redirectUrls: ['http://a.example'], allowedOrigins: ['https://a.example/path'], ipAllowlist: ['300.1.1.1', '10.0.0.0/24', '10.0.0.0/24'] })
    expect(errors.map((e) => e.field)).toEqual(['redirectUrls', 'allowedOrigins', 'ipAllowlist', 'ipAllowlist'])
  })

  it('Given a webhook URL, then HTTPS only', () => {
    expect(webhookUrlError('http://hooks.example')).toBeDefined()
    expect(webhookUrlError('https://hooks.example/ekyc')).toBeUndefined()
  })

  it('Given a change, then old and new values worded for the audit log', () => {
    expect(diffSettings({ claimTimeoutMin: 30, language: 'en' }, { claimTimeoutMin: 45, language: 'ms' })).toEqual([
      { field: 'Language', from: 'English', to: 'Bahasa Melayu' },
      { field: 'Claim timeout (min)', from: '30', to: '45' },
    ])
  })
})

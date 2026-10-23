import { describe, expect, it } from 'vitest'
import { activeReasons, canTurnOff, customCode, reasonsOf, SYSTEM_DECISION_REASONS, validateReasonInput } from './decisionReasons'
import type { DecisionReason } from './types'

const EMPTY = { disabledSystemCodes: [], custom: [] }
const custom = (over: Partial<DecisionReason> = {}): DecisionReason => ({ code: 'CUSTOM_WATCHLIST', name: 'On watchlist', outcome: 'REJECT', group: 'FRAUD_RISK', noteRequired: true, system: false, active: true, ...over })

describe('System Default decision reasons (DEC-106)', () => {
  it('Given the catalogue, then 16 Reject and 5 Approve reasons with unique stable codes; only "Other" needs a note', () => {
    expect(SYSTEM_DECISION_REASONS.filter((r) => r.outcome === 'REJECT')).toHaveLength(16)
    expect(SYSTEM_DECISION_REASONS.filter((r) => r.outcome === 'APPROVE')).toHaveLength(5)
    expect(new Set(SYSTEM_DECISION_REASONS.map((r) => r.code)).size).toBe(21)
    expect(SYSTEM_DECISION_REASONS.filter((r) => r.noteRequired).map((r) => r.code)).toEqual(['REJECT_OTHER', 'APPROVE_OTHER'])
    expect(SYSTEM_DECISION_REASONS.every((r) => r.system && (r.outcome === 'REJECT') === !!r.group)).toBe(true)
  })

  it('Given a project with every reason on, then all are active, in catalogue order', () => {
    expect(reasonsOf(EMPTY).map((r) => r.code)).toEqual(SYSTEM_DECISION_REASONS.map((r) => r.code))
    expect(activeReasons(EMPTY, 'APPROVE').map((r) => r.code)).toEqual(['FACE_CONFIRMED', 'QUALITY_LOW_IDENTITY_CONFIRMED', 'RISK_ACCEPTED', 'SAME_PERSON_REONBOARDING', 'APPROVE_OTHER'])
  })

  it('Given a turned-off System Default and Custom reasons, then the off one is inactive and Custom ones sit in their group, before "Other"', () => {
    const cfg = { disabledSystemCodes: ['UNDERAGE'], custom: [custom(), custom({ code: 'CUSTOM_VIDEO', name: 'Video call', outcome: 'APPROVE', group: undefined, noteRequired: false })] }
    const codes = reasonsOf(cfg).map((r) => r.code)
    expect(reasonsOf(cfg).find((r) => r.code === 'UNDERAGE')!.active).toBe(false)
    expect(codes.indexOf('CUSTOM_WATCHLIST')).toBe(codes.indexOf('OTHER_FRAUD') + 1)
    expect(codes.slice(-2)).toEqual(['CUSTOM_VIDEO', 'APPROVE_OTHER'])
    expect(activeReasons(cfg).some((r) => r.code === 'UNDERAGE')).toBe(false)
  })

  it('Given "Other", then it can never be turned off; any other reason can', () => {
    expect(canTurnOff({ code: 'REJECT_OTHER' })).toBe(false)
    expect(canTurnOff({ code: 'APPROVE_OTHER' })).toBe(false)
    expect(canTurnOff({ code: 'DOC_EXPIRED' })).toBe(true)
  })
})

describe('Custom decision reasons (DEC-106)', () => {
  it('Given a new name, then a CUSTOM_ code in capitals, numbered when taken', () => {
    expect(customCode('Customer on internal watchlist', [])).toBe('CUSTOM_CUSTOMER_ON_INTERNAL_WATCHLIST')
    expect(customCode('On watchlist!', [{ code: 'CUSTOM_ON_WATCHLIST' }])).toBe('CUSTOM_ON_WATCHLIST_2')
  })

  it('Given an empty, too long or duplicate name, or a Reject reason without a group, then the field errors', () => {
    const all = reasonsOf({ disabledSystemCodes: [], custom: [custom()] })
    expect(validateReasonInput({ name: ' ', outcome: 'APPROVE', noteRequired: false }, all)).toEqual([{ field: 'name', message: 'Enter a name.' }])
    expect(validateReasonInput({ name: 'x'.repeat(81), outcome: 'APPROVE', noteRequired: false }, all)[0].message).toBe('The name can be at most 80 characters.')
    expect(validateReasonInput({ name: 'document expired', outcome: 'REJECT', group: 'DOCUMENT', noteRequired: false }, all)[0].message).toBe('A Reject reason with this name already exists.')
    expect(validateReasonInput({ name: 'Document expired', outcome: 'APPROVE', noteRequired: false }, all)).toEqual([]) // unique per outcome
    expect(validateReasonInput({ name: 'New one', outcome: 'REJECT', noteRequired: false }, all)).toEqual([{ field: 'group', message: 'Choose a group.' }])
    expect(validateReasonInput({ name: 'On watchlist', outcome: 'REJECT', group: 'FRAUD_RISK', noteRequired: false }, all, 'CUSTOM_WATCHLIST')).toEqual([]) // its own name
  })
})

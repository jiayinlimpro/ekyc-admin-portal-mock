import { describe, expect, it } from 'vitest'
import type { AuditEntry } from '@/domain/types'
import { auditCsv, summarizeAudit } from './auditFormat'
import { fx } from '@/lib/ids'

const e = (action: AuditEntry['action'], details: Record<string, unknown> = {}): AuditEntry => ({
  id: 'evt_test00000000000000000001',
  at: '2026-09-25T02:00:00.000Z',
  action,
  actor: { kind: 'USER', userId: fx('USR-2026-0012'), fullName: 'Ali Bin Ahmad' },
  merchantId: fx('MER-0001'),
  referenceId: 'KYC-260901-900003',
  ip: '203.0.113.9',
  details,
})

describe('summarizeAudit', () => {
  it('CASE_DECISION_APPROVED shows from → to and the note', () => {
    expect(summarizeAudit(e('CASE_DECISION_APPROVED', { outcome: 'APPROVE', note: 'Same person', fromStatus: 'PENDING_REVIEW' }))).toBe('PENDING_REVIEW → Approved · “Same person”')
  })

  it('CASE_DECISION_REJECTED shows the chosen reasons; no note, no quote', () => {
    expect(summarizeAudit(e('CASE_DECISION_REJECTED', { outcome: 'REJECT', reasonIds: ['NOT_LIVE'], reasons: 'Face not live (Retry Not Allowed)', fromStatus: 'PENDING_REVIEW' }))).toBe(
      'PENDING_REVIEW → Rejected · Face not live (Retry Not Allowed)',
    )
  })

  it('CASE_CLAIM_EXPIRED names whose claim expired, in MYT', () => {
    expect(summarizeAudit(e('CASE_CLAIM_EXPIRED', { claimedBy: { userId: fx('USR-2026-0012'), fullName: 'Ali Bin Ahmad' }, claimExpiresAt: '2026-09-25T02:30:00.000Z' }))).toBe(
      'Claim by Ali Bin Ahmad expired at 25 Sep 2026, 10:30 MYT',
    )
  })

  it('CASE_RESUMED names the new session, the previous status and a flow move (DEC-113)', () => {
    const d = { fromStatus: 'FAILED', toStatus: 'PROCESSING', sessionNo: 2, fromFlowId: 'flw_a', toFlowId: 'flw_b', fromFlowName: 'Malaysian onboarding', toFlowName: 'Foreigner onboarding' }
    expect(summarizeAudit(e('CASE_RESUMED', d))).toBe('Session 2 started by the same Reference ID: Failed → Processing · flow Malaysian onboarding → Foreigner onboarding')
    expect(summarizeAudit(e('CASE_RESUMED', { ...d, toFlowId: 'flw_a', toFlowName: 'Malaysian onboarding' }))).toBe('Session 2 started by the same Reference ID: Failed → Processing')
  })

  it('CASE_DECISION_BLOCKED carries the refusal reason', () => {
    expect(summarizeAudit(e('CASE_DECISION_BLOCKED', { attempted: 'REJECT', reason: 'Your claim expired. No changes saved.' }))).toBe('Save refused (reject): Your claim expired. No changes saved.')
  })

  it('Given an event with setting changes, then each change reads field: old → new (DEC-42)', () => {
    expect(summarizeAudit(e('FLOW_SETTING_CHANGED', { changes: [{ field: 'Liveness', from: 'Standard', to: 'High' }] }))).toBe('Liveness: Standard → High')
  })
})

describe('auditCsv', () => {
  it('escapes commas and quotes', () => {
    const csv = auditCsv([e('CASE_DECISION_REJECTED', { outcome: 'REJECT', reasons: 'X', note: 'He said "no", twice', fromStatus: 'PENDING_REVIEW' })], () => 'Atoz Software Tech')
    const [header, row] = csv.split('\n')
    expect(header).toBe('Event ID,Time (MYT),Action,Actor,Actor ID,Merchant,Reference ID,Verification ID,IP,Summary')
    expect(row).toContain('"PENDING_REVIEW → Rejected · X · “He said ""no"", twice”"')
  })
})

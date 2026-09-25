import { describe, expect, it } from 'vitest'
import type { AuditEntry } from '@/domain/types'
import { auditCsv, summarizeAudit } from './auditFormat'

const e = (action: AuditEntry['action'], details: Record<string, unknown> = {}): AuditEntry => ({
  id: 'AUD-000001',
  at: '2026-09-25T02:00:00.000Z',
  action,
  actor: { kind: 'USER', userId: 'USR-2026-0012', fullName: 'Ali Bin Ahmad' },
  merchantId: 'MER-0001',
  referenceNo: 'KYC-260901-900003',
  ip: '203.0.113.9',
  details,
})

describe('summarizeAudit', () => {
  it('DECISION shows from → to, the reason label and the comment', () => {
    expect(summarizeAudit(e('DECISION', { outcome: 'APPROVE', reasonCode: 'FACE_MATCH_CONFIRMED', comment: 'Same person', fromStatus: 'PENDING_REVIEW' }))).toBe(
      'PENDING_REVIEW → Approved · Face match confirmed by reviewer · “Same person”',
    )
  })

  it('CLAIM_TIMEOUT names whose claim expired, in MYT', () => {
    expect(summarizeAudit(e('CLAIM_TIMEOUT', { claimedBy: { userId: 'USR-2026-0012', fullName: 'Ali Bin Ahmad' }, claimExpiresAt: '2026-09-25T02:30:00.000Z' }))).toBe(
      'Claim by Ali Bin Ahmad (USR-2026-0012) expired at 25 Sep 2026, 10:30 MYT',
    )
  })

  it('CONFIG_DEPLOY shows the version bump and change count; the first deployment is labelled', () => {
    expect(summarizeAudit(e('CONFIG_DEPLOY', { fromVersion: 'v1.1.0', toVersion: 'v1.2.0', changes: [{}, {}] }))).toBe('v1.1.0 → v1.2.0 · 2 change(s)')
    expect(summarizeAudit(e('CONFIG_DEPLOY', { fromVersion: null, toVersion: 'v1.0.0', changes: [] }))).toBe('Initial deployment v1.0.0')
  })

  it('OWNERSHIP_CONFLICT carries the refusal reason', () => {
    expect(summarizeAudit(e('OWNERSHIP_CONFLICT', { attempted: 'REJECT', reason: 'Your claim expired. No changes saved.' }))).toBe('Save refused (reject): Your claim expired. No changes saved.')
  })
})

describe('auditCsv', () => {
  it('escapes commas and quotes', () => {
    const csv = auditCsv([e('DECISION', { outcome: 'REJECT', reasonCode: 'X', comment: 'He said "no", twice', fromStatus: 'PENDING_REVIEW' })], () => 'Atoz Software Tech')
    const [header, row] = csv.split('\n')
    expect(header).toBe('Audit ID,Time (MYT),Action,Actor,Actor ID,Merchant,Reference No,IP,Summary')
    expect(row).toContain('"PENDING_REVIEW → Rejected · X · “He said ""no"", twice”"')
  })
})

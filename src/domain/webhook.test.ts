import { describe, expect, it } from 'vitest'
import { verification, SITI } from '@/test/factories'
import { webhookEventFor } from './webhook'

describe('webhookEventFor (DEC-55)', () => {
  it('Given a case in review, then the delivery names the case and the flow it ran on, besides the Reference ID', () => {
    const v = verification({ caseId: 'ver_a', flowId: 'flw_b', referenceNo: 'REF-1', status: 'PENDING_REVIEW' })
    expect(webhookEventFor(v)).toEqual({
      event: 'verification.status_changed',
      caseId: 'ver_a',
      flowId: 'flw_b',
      referenceId: 'REF-1',
      status: 'PENDING_REVIEW',
      lastUpdatedBy: { kind: 'SYSTEM' },
      occurredAt: v.lastUpdatedAt,
    })
  })

  it('Given a manual decision, then the reviewer is named without their user ID and no personal data of the applicant is sent', () => {
    const e = webhookEventFor(verification({ status: 'APPROVED', lastUpdatedBy: { kind: 'USER', userId: SITI.userId, fullName: SITI.fullName } }))!
    expect(e.lastUpdatedBy).toEqual({ kind: 'USER', fullName: SITI.fullName })
    expect(JSON.stringify(e)).not.toContain(SITI.userId)
    expect(Object.keys(e)).not.toContain('pii')
  })

  it('Given a case FAILED (no usable image), then it is sent like the other final statuses, by SYSTEM (DEC-112)', () => {
    expect(webhookEventFor(verification({ status: 'FAILED' }))).toMatchObject({ status: 'FAILED', lastUpdatedBy: { kind: 'SYSTEM' } })
  })

  it('Given a case still PROCESSING, then nothing is sent', () => {
    expect(webhookEventFor(verification({ status: 'PROCESSING' }))).toBeUndefined()
  })
})

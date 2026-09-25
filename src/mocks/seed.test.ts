import { describe, expect, it } from 'vitest'
import { isClaimActive } from '@/domain/claimRules'
import { deriveStatus } from '@/domain/statusRules'
import { VERIFICATION_STATUSES } from '@/domain/types'
import { NOW } from '@/test/factories'
import { EDGE_CASES } from './fixtures/edgeCases'
import { seedDatabase } from './seed'

const db = seedDatabase(NOW)
const configFor = (merchantId: string, version: string) => db.configs[merchantId].history.find((c) => c.version === version)!

describe('seedDatabase', () => {
  it('Given the same now, then the data is identical (deterministic)', () => {
    expect(seedDatabase(NOW)).toEqual(db)
  })

  it('has unique Reference Nos in KYC-YYMMDD-NNNNNN format', () => {
    const refs = db.verifications.map((v) => v.referenceNo)
    expect(new Set(refs).size).toBe(refs.length)
    for (const r of refs) expect(r).toMatch(/^KYC-\d{6}-\d{6}$/)
  })

  it('Given a SYSTEM-updated record, then its status equals deriveStatus with its own config version (no random statuses)', () => {
    for (const v of db.verifications.filter((x) => x.lastUpdatedBy.kind === 'SYSTEM')) {
      const cfg = configFor(v.merchantId, v.configVersion)
      expect(cfg, v.referenceNo).toBeDefined()
      expect(v.status, v.referenceNo).toBe(deriveStatus(v, cfg).status)
    }
  })

  it('Given a manually updated record, then it is APPROVED or REJECTED and has no claim', () => {
    const manual = db.verifications.filter((v) => v.lastUpdatedBy.kind === 'USER')
    expect(manual.length).toBeGreaterThan(0)
    for (const v of manual) {
      expect(['APPROVED', 'REJECTED']).toContain(v.status)
      expect(v.claimedBy).toBeUndefined()
    }
  })

  it('Given a claim, then the record is PENDING_REVIEW and the claim is active at seed time', () => {
    const claimed = db.verifications.filter((v) => v.claimedBy)
    expect(claimed.length).toBeGreaterThan(0)
    for (const v of claimed) {
      expect(v.status).toBe('PENDING_REVIEW')
      expect(isClaimActive(v, NOW)).toBe(true)
    }
  })

  it('never has a lastUpdatedAt or attempt in the future', () => {
    for (const v of db.verifications) {
      expect(Date.parse(v.lastUpdatedAt)).toBeLessThanOrEqual(NOW.getTime())
      for (const a of v.attempts) expect(Date.parse(a.startedAt)).toBeLessThanOrEqual(NOW.getTime())
    }
  })

  it('only V4 records carry a risk result', () => {
    for (const v of db.verifications.filter((x) => x.workflowVersion !== 'V4')) expect(v.riskLevel).toBeUndefined()
  })

  it('covers every status × V1/V4 combination, both manual and system decisions, and all risk levels', () => {
    for (const status of VERIFICATION_STATUSES) {
      for (const wf of ['V1', 'V4']) {
        expect(db.verifications.some((v) => v.status === status && v.workflowVersion === wf), `${status} × ${wf}`).toBe(true)
      }
    }
    for (const kind of ['SYSTEM', 'USER'] as const) {
      for (const status of ['APPROVED', 'REJECTED'] as const) {
        expect(db.verifications.some((v) => v.status === status && v.lastUpdatedBy.kind === kind), `${status} × ${kind}`).toBe(true)
      }
    }
    for (const lvl of ['LOW', 'MEDIUM', 'HIGH']) expect(db.verifications.some((v) => v.riskLevel === lvl), lvl).toBe(true)
  })

  it('every record is charged (DEC-60)', () => {
    expect(db.verifications.every((v) => v.charged === true)).toBe(true)
  })

  it('audit ids are sequential and entries are in time order', () => {
    db.audit.forEach((e, i) => {
      expect(e.id).toBe(`AUD-${String(i + 1).padStart(6, '0')}`)
      if (i > 0) expect(e.at >= db.audit[i - 1].at).toBe(true)
    })
    expect(db.auditSeq).toBe(db.audit.length)
  })

  it('Empty Demo Merchant has no records (S14)', () => {
    expect(db.verifications.filter((v) => v.merchantId === 'MER-0006')).toHaveLength(0)
  })
})

describe('named scenarios (docs/SCENARIOS.md)', () => {
  it.each(EDGE_CASES)('$id $referenceNo matches its expected state', (e) => {
    const v = db.verifications.find((x) => x.referenceNo === e.referenceNo)!
    expect(v).toBeDefined()
    expect(v.status).toBe(e.status)
    if (e.reason) expect(v.statusReason).toBe(e.reason)
    if (e.claimedByUserId) expect(v.claimedBy?.userId).toBe(e.claimedByUserId)
    if (e.lastUpdatedBy) expect(v.lastUpdatedBy.kind).toBe(e.lastUpdatedBy)
    if (e.configVersion) expect(v.configVersion).toBe(e.configVersion)
  })

  it('S06 keeps one Reference No across 3 attempts', () => {
    expect(db.verifications.find((v) => v.referenceNo === 'KYC-260901-900006')!.attempts).toHaveLength(3)
  })

  it('S13 has exactly 2 user retakes', () => {
    expect(db.verifications.find((v) => v.referenceNo === 'KYC-260901-900013')!.attempts.filter((a) => a.isUserRetake)).toHaveLength(2)
  })

  it('S15 is a passport without NRIC', () => {
    const v = db.verifications.find((x) => x.referenceNo === 'KYC-260901-900015')!
    expect(v.documentType).toBe('PASSPORT')
    expect(v.pii.nric).toBeUndefined()
  })

  it('S01 (V1) has no risk metrics; S02 (V4) does', () => {
    const phases = (ref: string) => db.verifications.find((v) => v.referenceNo === ref)!.metrics.map((m) => m.phase)
    expect(phases('KYC-260901-900001')).not.toContain('RISK_ASSESSMENT')
    expect(phases('KYC-260901-900002')).toContain('RISK_ASSESSMENT')
  })
})

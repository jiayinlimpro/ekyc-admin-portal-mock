// Named scenarios S01–S15 (docs/SCENARIOS.md). Each one is a UAT test case with a fixed Reference No (MOCK-05).
import { Faker, en } from '@faker-js/faker'
import { makeAudit } from '@/domain/audit'
import { applyDecision } from '@/domain/claimRules'
import type { Actor, Attempt, AuditEntry, CapturePhase, Merchant, UpdatedBy, Verification, VerificationStatus } from '@/domain/types'
import { buildVerification, type ConfigRecord } from '../builders'
import { clientMetadata, fakeIp, person } from '../malaysia'
import { userById } from './users'

export interface EdgeCaseExpectation {
  id: string
  referenceNo: string
  status: VerificationStatus
  reason?: string
  claimedByUserId?: string
  lastUpdatedBy?: UpdatedBy['kind']
  configVersion?: string
}

export const EDGE_CASES: EdgeCaseExpectation[] = [
  { id: 'S01', referenceNo: 'KYC-260901-900001', status: 'APPROVED', lastUpdatedBy: 'SYSTEM' },
  { id: 'S02', referenceNo: 'KYC-260901-900002', status: 'PENDING_REVIEW', reason: 'Risk Assessment not passed' },
  { id: 'S03', referenceNo: 'KYC-260901-900003', status: 'PENDING_REVIEW', reason: 'Between thresholds' },
  { id: 'S04', referenceNo: 'KYC-260901-900004', status: 'REJECTED', reason: 'Below Auto-Reject', lastUpdatedBy: 'SYSTEM' },
  { id: 'S05', referenceNo: 'KYC-260901-900005', status: 'PROCESSING' },
  { id: 'S06', referenceNo: 'KYC-260901-900006', status: 'PENDING_REVIEW', reason: 'Attempt limit reached – Liveness' },
  { id: 'S07', referenceNo: 'KYC-260901-900007', status: 'PENDING_REVIEW', claimedByUserId: 'USR-2026-0012' },
  { id: 'S08', referenceNo: 'KYC-260901-900008', status: 'PENDING_REVIEW', claimedByUserId: 'USR-2026-0012' },
  { id: 'S09', referenceNo: 'KYC-260901-900009', status: 'PENDING_REVIEW', claimedByUserId: 'USR-2026-0031' },
  { id: 'S10', referenceNo: 'KYC-260901-900010', status: 'PENDING_REVIEW' },
  { id: 'S11', referenceNo: 'KYC-260901-900011', status: 'APPROVED', lastUpdatedBy: 'USER' },
  { id: 'S12', referenceNo: 'KYC-260901-900012', status: 'PROCESSING', configVersion: 'v1.0.0' },
  { id: 'S13', referenceNo: 'KYC-260901-900013', status: 'APPROVED', lastUpdatedBy: 'SYSTEM' },
  { id: 'S15', referenceNo: 'KYC-260901-900015', status: 'APPROVED', lastUpdatedBy: 'SYSTEM' },
]

const ALL_PASS: Record<CapturePhase, number> = { DOCUMENT: 94.2, SELFIE: 91.8, FACE_MATCH: 96.1, LIVENESS: 97.4 }
const MIN = 60_000

export function buildEdgeCases(ctx: { now: Date; merchants: Merchant[]; configs: Record<string, ConfigRecord> }): {
  verifications: Verification[]
  audit: AuditEntry[]
} {
  const f = new Faker({ locale: [en] })
  f.seed(9000) // separate seed: changing the background seed never changes these records
  const { now } = ctx
  const ago = (min: number) => new Date(now.getTime() - min * MIN)
  const merchant = (id: string) => ctx.merchants.find((m) => m.merchantId === id)!
  const ali = userById('USR-2026-0012')!
  const siti = userById('USR-2026-0031')!
  const audit: AuditEntry[] = []

  const completed = (startMin: number, scores: Partial<Record<CapturePhase, number>>, attemptNo = 1): Attempt => ({
    attemptNo,
    phase: 'LIVENESS',
    startedAt: ago(startMin).toISOString(),
    outcome: 'COMPLETED',
    isUserRetake: attemptNo > 1,
    phaseScores: { ...ALL_PASS, ...scores },
  })
  const stopped = (startMin: number, phase: CapturePhase, outcome: Attempt['outcome'], attemptNo: number, stopScore?: number): Attempt => {
    const before = (['DOCUMENT', 'SELFIE', 'FACE_MATCH', 'LIVENESS'] as const).slice(0, ['DOCUMENT', 'SELFIE', 'FACE_MATCH', 'LIVENESS'].indexOf(phase))
    const phaseScores: Attempt['phaseScores'] = Object.fromEntries(before.map((p) => [p, ALL_PASS[p]]))
    if (stopScore !== undefined) phaseScores[phase] = stopScore
    return { attemptNo, phase, startedAt: ago(startMin).toISOString(), outcome, isUserRetake: attemptNo > 1, phaseScores }
  }

  const make = (seq: number, merchantId: string, attempts: Attempt[], riskScore?: number, documentType: 'MYKAD' | 'PASSPORT' = 'MYKAD') => {
    const p = person(f, now, documentType)
    return buildVerification({
      referenceNo: `KYC-260901-${String(900000 + seq)}`,
      merchant: merchant(merchantId),
      configs: ctx.configs[merchantId],
      person: p,
      metadata: clientMetadata(f, p.city),
      attempts,
      riskScore,
    })
  }

  const claimFor = (v: Verification, actor: Actor, claimedMinAgo: number): Verification => {
    const cfg = ctx.configs[v.merchantId].deployed
    const claimedAt = ago(claimedMinAgo)
    audit.push(makeAudit({ id: '', now: new Date(claimedAt.getTime() - MIN), action: 'PII_VIEW', actor, ip: fakeIp(f), merchantId: v.merchantId, referenceNo: v.referenceNo }))
    audit.push(
      makeAudit({
        id: '',
        now: claimedAt,
        action: 'CLAIM',
        actor,
        ip: fakeIp(f),
        merchantId: v.merchantId,
        referenceNo: v.referenceNo,
        details: { claimExpiresAt: new Date(claimedAt.getTime() + cfg.claimTimeoutMin * MIN).toISOString() },
      }),
    )
    return {
      ...v,
      claimedBy: { userId: actor.userId, fullName: actor.fullName },
      claimedAt: claimedAt.toISOString(),
      claimExpiresAt: new Date(claimedAt.getTime() + cfg.claimTimeoutMin * MIN).toISOString(),
    }
  }

  const ATOZ = 'MER-0001'
  const VANTAGE = 'MER-0002'
  const out: Verification[] = [
    make(1, VANTAGE, [completed(95, {})]),
    make(2, ATOZ, [completed(90, {})], 82),
    make(3, ATOZ, [completed(88, { FACE_MATCH: 83.5 })], 15),
    make(4, ATOZ, [completed(86, { LIVENESS: 45 })], 20),
    make(5, ATOZ, [stopped(84, 'SELFIE', 'ABORTED', 1)]),
    make(6, ATOZ, [stopped(82, 'LIVENESS', 'FAILED_RETAKE', 1, 52.3), stopped(78, 'LIVENESS', 'FAILED_RETAKE', 2, 58.9), stopped(74, 'LIVENESS', 'FAILED_RETAKE', 3, 61.0)]),
    claimFor(make(7, ATOZ, [completed(70, { FACE_MATCH: 80.2 })], 22), ali, 28), // 2 min left
    claimFor(make(8, ATOZ, [completed(68, { LIVENESS: 88.0 })], 18), ali, 20), // 10 min left: time-warp to expire
    claimFor(make(9, ATOZ, [completed(66, { SELFIE: 70.4 })], 30), siti, 5),
    make(10, ATOZ, [completed(64, { DOCUMENT: 75.6 })], 12),
    make(11, ATOZ, [completed(62, { FACE_MATCH: 82.0 })], 25),
    make(12, ATOZ, [stopped(180, 'FACE_MATCH', 'ABORTED', 1)]), // started before Atoz deployed v1.1.0 (2 h ago)
    make(13, VANTAGE, [stopped(60, 'LIVENESS', 'FAILED_RETAKE', 1, 55.0), stopped(55, 'LIVENESS', 'FAILED_RETAKE', 2, 66.2), completed(50, {}, 3)]),
    make(15, VANTAGE, [completed(45, {})], undefined, 'PASSPORT'),
  ]

  // S11: manually approved by Ali 10 minutes ago.
  const s11 = out.findIndex((v) => v.referenceNo === 'KYC-260901-900011')
  const decidedAt = ago(10)
  const claimed = claimFor(out[s11], ali, 14)
  const decision = { outcome: 'APPROVE' as const, reasonCode: 'FACE_MATCH_CONFIRMED', comment: 'Selfie and MyKad photo compared side by side; same person.' }
  out[s11] = applyDecision(claimed, ali, decision, 'Face match confirmed by reviewer', decidedAt)
  audit.push(
    makeAudit({
      id: '',
      now: decidedAt,
      action: 'DECISION',
      actor: ali,
      ip: fakeIp(f),
      merchantId: ATOZ,
      referenceNo: out[s11].referenceNo,
      details: { ...decision, fromStatus: 'PENDING_REVIEW', toStatus: 'APPROVED' },
    }),
  )

  return { verifications: out, audit }
}

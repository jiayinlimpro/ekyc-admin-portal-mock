// Named scenarios S01–S19 (docs/SCENARIOS.md). Each one is a UAT test case with a fixed Reference No (MOCK-05).
// Thresholds referred to below come from the flow revision (fixtures/catalog.ts) and the presets (OQ-02).
import { Faker, en } from '@faker-js/faker'
import { makeAudit } from '@/domain/audit'
import { applyDecision } from '@/domain/claimRules'
import type { Actor, AuditEntry, Check, DocumentType, Merchant, UpdatedBy, Verification, VerificationStatus } from '@/domain/types'
import { buildCase, type ConfigRecord } from '../builders'
import { clientMetadata, fakeIp, person } from '../malaysia'
import type { Catalog } from './catalog'
import { userById } from './users'

export interface EdgeCaseExpectation {
  id: string
  title: string
  /** Suggested user to open it as (docs/SCENARIOS.md). */
  asUserId: string
  referenceNo: string
  flowId: string
  status: VerificationStatus
  reason?: string
  claimedByUserId?: string
  lastUpdatedBy?: UpdatedBy['kind']
  configVersion?: string
  configRevision?: number
}

export const EDGE_CASES: EdgeCaseExpectation[] = [
  { id: 'S01', title: 'V1, both checks ≥ Auto-Pass', asUserId: 'USR-2026-0044', referenceNo: 'KYC-260901-900001', flowId: 'FLW-0005', status: 'APPROVED', lastUpdatedBy: 'SYSTEM' },
  { id: 'S02', title: 'V4, checks pass but risk HIGH', asUserId: 'USR-2026-0012', referenceNo: 'KYC-260901-900002', flowId: 'FLW-0001', status: 'PENDING_REVIEW', reason: 'Risk Assessment not passed' },
  { id: 'S03', title: 'Face match 88.5 after 3 retries (review band)', asUserId: 'USR-2026-0012', referenceNo: 'KYC-260901-900003', flowId: 'FLW-0001', status: 'PENDING_REVIEW', reason: 'Liveness face does not match ID face (Retry Not Allowed)' },
  { id: 'S04', title: 'Liveness below Auto-Reject after 3 retries', asUserId: 'USR-2026-0012', referenceNo: 'KYC-260901-900004', flowId: 'FLW-0001', status: 'REJECTED', reason: 'Face not live (Retry Not Allowed)', lastUpdatedBy: 'SYSTEM' },
  { id: 'S05', title: 'Stopped at ID capture (read-only)', asUserId: 'USR-2026-0012', referenceNo: 'KYC-260901-900005', flowId: 'FLW-0001', status: 'PROCESSING' },
  { id: 'S06', title: 'Liveness retries used up: 4 submissions, last in review band', asUserId: 'USR-2026-0012', referenceNo: 'KYC-260901-900006', flowId: 'FLW-0001', status: 'PENDING_REVIEW', reason: 'Face not live (Retry Not Allowed)' },
  { id: 'S07', title: 'Claimed by Ali, ~2 min left', asUserId: 'USR-2026-0012', referenceNo: 'KYC-260901-900007', flowId: 'FLW-0001', status: 'PENDING_REVIEW', claimedByUserId: 'USR-2026-0012' },
  { id: 'S08', title: 'Claimed by Ali, expires mid-review (time warp)', asUserId: 'USR-2026-0012', referenceNo: 'KYC-260901-900008', flowId: 'FLW-0001', status: 'PENDING_REVIEW', claimedByUserId: 'USR-2026-0012' },
  { id: 'S09', title: 'Claimed by Siti; Ali can only view', asUserId: 'USR-2026-0012', referenceNo: 'KYC-260901-900009', flowId: 'FLW-0001', status: 'PENDING_REVIEW', claimedByUserId: 'USR-2026-0031' },
  { id: 'S10', title: 'Unclaimed: two reviewers race', asUserId: 'USR-2026-0031', referenceNo: 'KYC-260901-900010', flowId: 'FLW-0001', status: 'PENDING_REVIEW' },
  { id: 'S11', title: 'Manually approved (final)', asUserId: 'USR-2026-0012', referenceNo: 'KYC-260901-900011', flowId: 'FLW-0001', status: 'APPROVED', lastUpdatedBy: 'USER' },
  { id: 'S12', title: 'In flight on the previous flow revision (V4-R1)', asUserId: 'USR-2026-0012', referenceNo: 'KYC-260901-900012', flowId: 'FLW-0001', status: 'PROCESSING', configVersion: 'v1.0.0', configRevision: 1 },
  { id: 'S13', title: 'Two liveness retries, then approved', asUserId: 'USR-2026-0044', referenceNo: 'KYC-260901-900013', flowId: 'FLW-0005', status: 'APPROVED', lastUpdatedBy: 'SYSTEM' },
  { id: 'S15', title: 'Passport (non-MyKad)', asUserId: 'USR-2026-0044', referenceNo: 'KYC-260901-900015', flowId: 'FLW-0005', status: 'APPROVED', lastUpdatedBy: 'SYSTEM' },
  { id: 'S16', title: 'SME app project (V3): Ali may only view', asUserId: 'USR-2026-0012', referenceNo: 'KYC-260901-900016', flowId: 'FLW-0004', status: 'PENDING_REVIEW', reason: 'Face not live (Retry Not Allowed)' },
  { id: 'S17', title: 'In flight on a retiring flow', asUserId: 'USR-2026-0063', referenceNo: 'KYC-260901-900017', flowId: 'FLW-0008', status: 'PROCESSING' },
  { id: 'S18', title: 'Rejected 30 min ago; 120-min cooldown running', asUserId: 'USR-2026-0012', referenceNo: 'KYC-260901-900018', flowId: 'FLW-0002', status: 'REJECTED', reason: 'Liveness face does not match ID face (Retry Not Allowed)', lastUpdatedBy: 'SYSTEM' },
  { id: 'S19', title: 'V1 face match (ID vs selfie) below threshold, retry pending', asUserId: 'USR-2026-0044', referenceNo: 'KYC-260901-900019', flowId: 'FLW-0005', status: 'PROCESSING' },
]

const MIN = 60_000

export function buildEdgeCases(ctx: { now: Date; merchants: Merchant[]; configs: Record<string, ConfigRecord>; catalog: Catalog }): {
  verifications: Verification[]
  audit: AuditEntry[]
} {
  const f = new Faker({ locale: [en] })
  f.seed(9000) // separate seed: changing the background seed never changes these records
  const { now, catalog } = ctx
  const ago = (min: number) => new Date(now.getTime() - min * MIN)
  const ali = userById('USR-2026-0012')!
  const siti = userById('USR-2026-0031')!
  const audit: AuditEntry[] = []

  const make = (
    seq: number,
    flowId: string,
    startMin: number,
    submissions: Partial<Record<Check, number[]>>,
    opts: { riskScore?: number; documentType?: DocumentType; stepMin?: number } = {},
  ): Verification => {
    const flow = catalog.flows.find((x) => x.flowId === flowId)!
    const p = person(f, now, opts.documentType ?? 'MYKAD')
    return buildCase({
      referenceNo: `KYC-260901-${String(900000 + seq)}`,
      merchant: ctx.merchants.find((m) => m.merchantId === flow.merchantId)!,
      merchantConfigs: ctx.configs[flow.merchantId],
      flow,
      revisions: catalog.flowRevisions,
      entry: catalog.registry.find((e) => e.code === flow.workflowVersion)!,
      person: p,
      metadata: clientMetadata(f, p.city),
      startedAt: ago(startMin),
      submissions,
      stepMin: opts.stepMin ?? 2,
      riskScore: opts.riskScore ?? 20,
    })
  }
  const passes = (n: number) => Array.from({ length: n }, (_, i) => 95.5 + i * 0.4)

  const claimFor = (v: Verification, actor: Actor, claimedMinAgo: number): Verification => {
    const timeoutMin = catalog.projects.find((p) => p.projectId === v.projectId)!.claimTimeoutMin // REQ: DEC-22
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
        details: { claimExpiresAt: new Date(claimedAt.getTime() + timeoutMin * MIN).toISOString() },
      }),
    )
    return {
      ...v,
      claimedBy: { userId: actor.userId, fullName: actor.fullName },
      claimedAt: claimedAt.toISOString(),
      claimExpiresAt: new Date(claimedAt.getTime() + timeoutMin * MIN).toISOString(),
    }
  }

  // Atoz "Malaysian onboarding" FLW-0001 R2: face match reject < 85 / approve ≥ 95, liveness < 70 / ≥ 85, 3 retries.
  const out: Verification[] = [
    make(1, 'FLW-0005', 95, { FACE_MATCH: [95.5], LIVENESS: [97.4] }),
    make(2, 'FLW-0001', 90, { FACE_MATCH: [96.1], LIVENESS: [97.4] }, { riskScore: 82 }),
    make(3, 'FLW-0001', 88, { FACE_MATCH: [80.4, 82.1, 84.0, 88.5], LIVENESS: passes(4) }, { riskScore: 15 }),
    make(4, 'FLW-0001', 86, { FACE_MATCH: passes(4), LIVENESS: [45.0, 52.4, 48.9, 50.2] }),
    make(5, 'FLW-0001', 84, {}),
    make(6, 'FLW-0001', 82, { FACE_MATCH: passes(4), LIVENESS: [52.3, 58.9, 61.0, 74.5] }, { stepMin: 4 }),
    claimFor(make(7, 'FLW-0001', 76, { FACE_MATCH: [83.0, 84.0, 86.0, 90.2], LIVENESS: passes(4) }, { riskScore: 22 }), ali, 28), // 2 min left
    claimFor(make(8, 'FLW-0001', 74, { FACE_MATCH: passes(4), LIVENESS: [65.0, 68.0, 72.0, 80.0] }, { riskScore: 18 }), ali, 20), // 10 min left
    claimFor(make(9, 'FLW-0001', 72, { FACE_MATCH: [84.0, 86.0, 87.0, 91.4], LIVENESS: passes(4) }, { riskScore: 30 }), siti, 5),
    make(10, 'FLW-0001', 70, { FACE_MATCH: passes(4), LIVENESS: [64.0, 69.0, 71.0, 76.6] }, { riskScore: 12 }),
    make(11, 'FLW-0001', 68, { FACE_MATCH: [85.5, 86.0, 87.0, 89.0], LIVENESS: passes(4) }, { riskScore: 25 }),
    // Started before R2 was saved (2 h ago): still evaluated with R1 (liveness < 60 / ≥ 80), retry pending.
    make(12, 'FLW-0001', 180, { FACE_MATCH: [95.0], LIVENESS: [55.0] }),
    // Vantage "Standard onboarding" FLW-0005 R2: face match Advanced < 82 / ≥ 93 (set by Platform Admin).
    make(13, 'FLW-0005', 60, { FACE_MATCH: [95.0], LIVENESS: [55.0, 66.2, 90.1] }, { stepMin: 5 }),
    make(15, 'FLW-0005', 45, { FACE_MATCH: [94.0], LIVENESS: [96.0] }, { documentType: 'PASSPORT' }),
    // Atoz "SME director check" FLW-0004 (V3, 2 retries): 3 submissions, last in the review band.
    make(16, 'FLW-0004', 40, { FACE_MATCH: passes(3), LIVENESS: [60.0, 65.5, 72.3] }),
    // Boring "Express (pilot)" FLW-0008 (V3, retiring; liveness < 60 / ≥ 80): first liveness failed, retry pending.
    make(17, 'FLW-0008', 35, { FACE_MATCH: [96.0], LIVENESS: [50.0] }),
    // Atoz "Foreigner onboarding" FLW-0002 (High face match < 90 / ≥ 97, cooldown 120 min).
    make(18, 'FLW-0002', 40, { FACE_MATCH: [84.0, 86.5, 88.0, 85.2], LIVENESS: passes(4) }, { documentType: 'PASSPORT' }),
    // Vantage FLW-0005 (V1, face match Advanced < 82 / ≥ 93): selfie retakes are free; face match retry pending.
    make(19, 'FLW-0005', 25, { FACE_MATCH: [70.0] }),
  ]

  // S11: manually approved by Ali 10 minutes ago.
  const s11 = out.findIndex((v) => v.referenceNo === 'KYC-260901-900011')
  const decidedAt = ago(10)
  const claimed = claimFor(out[s11], ali, 14)
  const decision = { outcome: 'APPROVE' as const, reasonCode: 'FACE_MATCH_CONFIRMED', comment: 'Liveness frame and MyKad photo compared side by side; same person.' }
  out[s11] = applyDecision(claimed, ali, decision, 'Face match confirmed by reviewer', decidedAt)
  audit.push(
    makeAudit({
      id: '',
      now: decidedAt,
      action: 'DECISION',
      actor: ali,
      ip: fakeIp(f),
      merchantId: out[s11].merchantId,
      referenceNo: out[s11].referenceNo,
      details: { ...decision, fromStatus: 'PENDING_REVIEW', toStatus: 'APPROVED' },
    }),
  )

  return { verifications: out, audit }
}

// Named scenarios S01–S22 (docs/SCENARIOS.md). Each one is a UAT test case with a fixed Reference No (MOCK-05).
// Thresholds referred to below come from the flow revision (fixtures/catalog.ts) and the presets (OQ-02).
import { Faker, en } from '@faker-js/faker'
import { makeAudit } from '@/domain/audit'
import { applyDecision } from '@/domain/claimRules'
import type { Actor, AuditEntry, Check, DocumentType, IdCaptureTelemetry, RiskCategoryScore, SelfieTelemetry, UpdatedBy, Verification, VerificationStatus } from '@/domain/types'
import { buildCase } from '../builders'
import { clientMetadata, fakeIp, person } from '../malaysia'
import type { Catalog } from './catalog'
import { userById } from './users'
import { fx } from '@/lib/ids'

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
  configRevision?: number
}

export const EDGE_CASES: EdgeCaseExpectation[] = [
  { id: 'S01', title: 'V1, both checks ≥ Auto-Pass', asUserId: fx('USR-2026-0044'), referenceNo: 'KYC-260901-900001', flowId: fx('FLW-0005'), status: 'APPROVED', lastUpdatedBy: 'SYSTEM' },
  { id: 'S02', title: 'V4, checks pass but risk HIGH', asUserId: fx('USR-2026-0012'), referenceNo: 'KYC-260901-900002', flowId: fx('FLW-0001'), status: 'PENDING_REVIEW', reason: 'Risk Assessment not passed' },
  { id: 'S03', title: 'Face match 88.5 after 3 retries (review band)', asUserId: fx('USR-2026-0012'), referenceNo: 'KYC-260901-900003', flowId: fx('FLW-0001'), status: 'PENDING_REVIEW', reason: 'Liveness face does not match ID face (Retry Not Allowed)' },
  { id: 'S04', title: 'Liveness below Auto-Reject after 3 retries', asUserId: fx('USR-2026-0012'), referenceNo: 'KYC-260901-900004', flowId: fx('FLW-0001'), status: 'REJECTED', reason: 'Face not live (Retry Not Allowed)', lastUpdatedBy: 'SYSTEM' },
  { id: 'S05', title: 'Stopped at ID capture (read-only)', asUserId: fx('USR-2026-0012'), referenceNo: 'KYC-260901-900005', flowId: fx('FLW-0001'), status: 'PROCESSING' },
  { id: 'S06', title: 'Liveness retries used up: 4 submissions, last in review band', asUserId: fx('USR-2026-0012'), referenceNo: 'KYC-260901-900006', flowId: fx('FLW-0001'), status: 'PENDING_REVIEW', reason: 'Face not live (Retry Not Allowed)' },
  { id: 'S07', title: 'Claimed by Ali, ~2 min left', asUserId: fx('USR-2026-0012'), referenceNo: 'KYC-260901-900007', flowId: fx('FLW-0001'), status: 'PENDING_REVIEW', claimedByUserId: fx('USR-2026-0012') },
  { id: 'S08', title: 'Claimed by Ali, expires mid-review (time warp)', asUserId: fx('USR-2026-0012'), referenceNo: 'KYC-260901-900008', flowId: fx('FLW-0001'), status: 'PENDING_REVIEW', claimedByUserId: fx('USR-2026-0012') },
  { id: 'S09', title: 'Claimed by Siti; Ali can only view', asUserId: fx('USR-2026-0012'), referenceNo: 'KYC-260901-900009', flowId: fx('FLW-0001'), status: 'PENDING_REVIEW', claimedByUserId: fx('USR-2026-0031') },
  { id: 'S10', title: 'Unclaimed: two reviewers race', asUserId: fx('USR-2026-0031'), referenceNo: 'KYC-260901-900010', flowId: fx('FLW-0001'), status: 'PENDING_REVIEW' },
  { id: 'S11', title: 'Manually approved (final)', asUserId: fx('USR-2026-0012'), referenceNo: 'KYC-260901-900011', flowId: fx('FLW-0001'), status: 'APPROVED', lastUpdatedBy: 'USER' },
  { id: 'S12', title: 'In flight on the previous flow revision (V4-R1)', asUserId: fx('USR-2026-0012'), referenceNo: 'KYC-260901-900012', flowId: fx('FLW-0001'), status: 'PROCESSING', configRevision: 1 },
  { id: 'S13', title: 'Two liveness retries, then approved', asUserId: fx('USR-2026-0044'), referenceNo: 'KYC-260901-900013', flowId: fx('FLW-0005'), status: 'APPROVED', lastUpdatedBy: 'SYSTEM' },
  { id: 'S15', title: 'Passport (non-MyKad)', asUserId: fx('USR-2026-0044'), referenceNo: 'KYC-260901-900015', flowId: fx('FLW-0005'), status: 'APPROVED', lastUpdatedBy: 'SYSTEM' },
  { id: 'S16', title: 'SME app project (V3): Ali may only view', asUserId: fx('USR-2026-0012'), referenceNo: 'KYC-260901-900016', flowId: fx('FLW-0004'), status: 'PENDING_REVIEW', reason: 'Face not live (Retry Not Allowed)' },
  { id: 'S17', title: 'In flight on a retiring flow', asUserId: fx('USR-2026-0063'), referenceNo: 'KYC-260901-900017', flowId: fx('FLW-0008'), status: 'PROCESSING' },
  { id: 'S18', title: 'Rejected 30 min ago; 120-min cooldown running', asUserId: fx('USR-2026-0012'), referenceNo: 'KYC-260901-900018', flowId: fx('FLW-0002'), status: 'REJECTED', reason: 'Liveness face does not match ID face (Retry Not Allowed)', lastUpdatedBy: 'SYSTEM' },
  { id: 'S19', title: 'V1 face match (ID vs selfie) below threshold, retry pending', asUserId: fx('USR-2026-0044'), referenceNo: 'KYC-260901-900019', flowId: fx('FLW-0005'), status: 'PROCESSING' },
  { id: 'S20', title: 'Driving License: face match retries used up, last in review band', asUserId: fx('USR-2026-0044'), referenceNo: 'KYC-260901-900020', flowId: fx('FLW-0005'), status: 'PENDING_REVIEW', reason: 'ID face and Selfie face do not match (Retry Not Allowed)' },
  { id: 'S22', title: 'V1: selfie too dark, rejected; user stopped, nothing compared', asUserId: fx('USR-2026-0044'), referenceNo: 'KYC-260901-900022', flowId: fx('FLW-0005'), status: 'PROCESSING' },
  { id: 'S21', title: 'Existing user found (duplicate, information only)', asUserId: fx('USR-2026-0012'), referenceNo: 'KYC-260901-900021', flowId: fx('FLW-0001'), status: 'PENDING_REVIEW', reason: 'Liveness face does not match ID face (Retry Not Allowed)' },
]

const MIN = 60_000

export function buildEdgeCases(ctx: { now: Date; catalog: Catalog }): {
  verifications: Verification[]
  audit: AuditEntry[]
} {
  const f = new Faker({ locale: [en] })
  f.seed(9000) // separate seed: changing the background seed never changes these records
  const { now, catalog } = ctx
  const ago = (min: number) => new Date(now.getTime() - min * MIN)
  const ali = userById(fx('USR-2026-0012'))!
  const siti = userById(fx('USR-2026-0031'))!
  const audit: AuditEntry[] = []

  const make = (
    seq: number,
    flowId: string,
    startMin: number,
    submissions: Partial<Record<Check, number[]>>,
    opts: { riskScore?: number; documentType?: DocumentType; stepMin?: number; idCapture?: Partial<IdCaptureTelemetry>; duplicateSimilarity?: number; riskCategories?: RiskCategoryScore[]; stoppedAtSelfie?: Partial<SelfieTelemetry> } = {},
  ): Verification => {
    const flow = catalog.flows.find((x) => x.flowId === flowId)!
    const p = person(f, now, opts.documentType ?? 'MYKAD')
    return buildCase({
      referenceNo: `KYC-260901-${String(900000 + seq)}`,
      flow,
      revisions: catalog.flowRevisions,
      entry: catalog.registry.find((e) => e.code === flow.workflowVersion)!,
      person: p,
      metadata: clientMetadata(f, p.city),
      startedAt: ago(startMin),
      submissions,
      stepMin: opts.stepMin ?? 2,
      riskScore: opts.riskScore ?? 20,
      idCapture: opts.idCapture,
      duplicateSimilarity: opts.duplicateSimilarity ?? 20 + seq, // REQ: DEC-105 — new users, except S21
      riskCategories: opts.riskCategories,
      stoppedAtSelfie: opts.stoppedAtSelfie,
    })
  }
  const passes = (n: number) => Array.from({ length: n }, (_, i) => 95.5 + i * 0.4)

  const claimFor = (v: Verification, actor: Actor, claimedMinAgo: number): Verification => {
    const timeoutMin = catalog.projects.find((p) => p.projectId === v.projectId)!.claimTimeoutSec / 60 // REQ: DEC-22
    const claimedAt = ago(claimedMinAgo)
    const ref = { merchantId: v.merchantId, projectId: v.projectId, caseId: v.caseId, referenceNo: v.referenceNo, actorRole: 'Reviewer' } // Ali and Siti review Atoz Default
    audit.push(makeAudit({ id: '', now: new Date(claimedAt.getTime() - MIN), action: 'SENSITIVE_PII_VIEW', actor, ip: fakeIp(f), ...ref }))
    audit.push(
      makeAudit({
        id: '',
        now: claimedAt,
        action: 'CASE_CLAIMED',
        actor,
        ip: fakeIp(f),
        ...ref,
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
    make(1, fx('FLW-0005'), 95, { FACE_MATCH: [95.5], LIVENESS: [97.4] }),
    make(2, fx('FLW-0001'), 90, { FACE_MATCH: [96.1], LIVENESS: [97.4] }, {
      riskScore: 82,
      riskCategories: [
        { category: 'EXIF', score: 35, reasonCodes: [] },
        { category: 'NOISE', score: 82, reasonCodes: ['NOISE_SCREEN_PATTERN', 'NOISE_RECOMPRESSED'] },
        { category: 'EMAIL_VALIDITY', score: 64, reasonCodes: ['EMAIL_DISPOSABLE'] },
        { category: 'OSINT', score: 20, reasonCodes: [] },
      ],
    }),
    make(3, fx('FLW-0001'), 88, { FACE_MATCH: [80.4, 82.1, 84.0, 88.5], LIVENESS: passes(4) }, { riskScore: 15 }),
    make(4, fx('FLW-0001'), 86, { FACE_MATCH: passes(4), LIVENESS: [45.0, 52.4, 48.9, 50.2] }),
    make(5, fx('FLW-0001'), 84, {}, { idCapture: { imageWidth: 300, imageHeight: 240, ocrFieldsMissing: ['Address'] } }), // why the user stopped (DEC-105)
    make(6, fx('FLW-0001'), 82, { FACE_MATCH: passes(4), LIVENESS: [52.3, 58.9, 61.0, 74.5] }, { stepMin: 4 }),
    claimFor(make(7, fx('FLW-0001'), 76, { FACE_MATCH: [83.0, 84.0, 86.0, 90.2], LIVENESS: passes(4) }, { riskScore: 22 }), ali, 28), // 2 min left
    claimFor(make(8, fx('FLW-0001'), 74, { FACE_MATCH: passes(4), LIVENESS: [65.0, 68.0, 72.0, 80.0] }, { riskScore: 18 }), ali, 20), // 10 min left
    claimFor(make(9, fx('FLW-0001'), 72, { FACE_MATCH: [84.0, 86.0, 87.0, 91.4], LIVENESS: passes(4) }, { riskScore: 30 }), siti, 5),
    make(10, fx('FLW-0001'), 70, { FACE_MATCH: passes(4), LIVENESS: [64.0, 69.0, 71.0, 76.6] }, { riskScore: 12 }),
    make(11, fx('FLW-0001'), 68, { FACE_MATCH: [85.5, 86.0, 87.0, 89.0], LIVENESS: passes(4) }, { riskScore: 25 }),
    // Started before R2 was saved (2 h ago): still evaluated with R1 (liveness < 60 / ≥ 80), retry pending.
    make(12, fx('FLW-0001'), 180, { FACE_MATCH: [95.0], LIVENESS: [55.0] }),
    // Vantage "Standard onboarding" FLW-0005 R2: face match Advanced < 82 / ≥ 93 (set by Super admin).
    make(13, fx('FLW-0005'), 60, { FACE_MATCH: [95.0], LIVENESS: [55.0, 66.2, 90.1] }, { stepMin: 5 }),
    make(15, fx('FLW-0005'), 45, { FACE_MATCH: [94.0], LIVENESS: [96.0] }, { documentType: 'PASSPORT' }),
    // Atoz "SME director check" FLW-0004 (V3, 2 retries): 3 submissions, last in the review band.
    make(16, fx('FLW-0004'), 40, { FACE_MATCH: passes(3), LIVENESS: [60.0, 65.5, 72.3] }),
    // Boring "Express (pilot)" FLW-0008 (V3, retiring; liveness < 60 / ≥ 80): first liveness failed, retry pending.
    make(17, fx('FLW-0008'), 35, { FACE_MATCH: [96.0], LIVENESS: [50.0] }),
    // Atoz "Foreigner onboarding" FLW-0002 (High face match < 90 / ≥ 97, cooldown 120 min).
    make(18, fx('FLW-0002'), 40, { FACE_MATCH: [84.0, 86.5, 88.0, 85.2], LIVENESS: passes(4) }, { documentType: 'PASSPORT' }),
    // Vantage FLW-0005 (V1, face match Advanced < 82 / ≥ 93): selfie retakes are free; face match retry pending.
    make(19, fx('FLW-0005'), 25, { FACE_MATCH: [70.0] }),
    // Vantage FLW-0005 R2 accepts Driving License: face match < 82 / ≥ 93, 3 retries used, last 88.0 → review; liveness passes.
    make(20, fx('FLW-0005'), 20, { FACE_MATCH: [80.1, 84.0, 86.2, 88.0], LIVENESS: [96.2] }, { documentType: 'DRIVING_LICENSE' }),
    // Atoz FLW-0001: face match in the review band after 3 retries; the face search found an existing user (97.6).
    make(21, fx('FLW-0001'), 50, { FACE_MATCH: [86.0, 87.5, 88.0, 89.2], LIVENESS: passes(4) }, { riskScore: 18, duplicateSimilarity: 97.6 }),
    // Vantage FLW-0005 (V1): the selfie was too dark (brightness 14.2), so the engine ended the run before Face Match.
    make(22, fx('FLW-0005'), 15, {}, { idCapture: { faceConfidence: 98.4, imageWidth: 1600, imageHeight: 1000, ocrFieldsMissing: [] }, stoppedAtSelfie: { brightness: 14.2, sharpness: 52.0, yaw: 4.0, pitch: -3.0, eyesOpen: true, occluded: false } }),
  ]

  // S16: Nurul (Reviewer, SME app) looked at it a few minutes ago without claiming it.
  const s16 = out.find((v) => v.referenceNo === 'KYC-260901-900016')!
  audit.push(makeAudit({ id: '', now: ago(5), action: 'SENSITIVE_PII_VIEW', actor: { userId: fx('USR-2026-0033'), fullName: 'Nurul Huda Binti Kamaruddin' }, actorRole: 'Reviewer', ip: fakeIp(f), merchantId: s16.merchantId, projectId: s16.projectId, caseId: s16.caseId, referenceNo: s16.referenceNo }))

  // S11: manually approved by Ali 10 minutes ago.
  const s11 = out.findIndex((v) => v.referenceNo === 'KYC-260901-900011')
  const decidedAt = ago(10)
  const claimed = claimFor(out[s11], ali, 14)
  const decision = { outcome: 'APPROVE' as const, reasonCodes: ['FACE_CONFIRMED'], note: 'Liveness frame and MyKad photo compared side by side; same person.' }
  out[s11] = applyDecision(claimed, ali, decision, decidedAt)
  audit.push(
    makeAudit({
      id: '',
      now: decidedAt,
      action: 'CASE_DECISION_APPROVED',
      actor: ali,
      actorRole: 'Reviewer',
      ip: fakeIp(f),
      merchantId: out[s11].merchantId,
      projectId: out[s11].projectId,
      caseId: out[s11].caseId,
      referenceNo: out[s11].referenceNo,
      details: { ...decision, fromStatus: 'PENDING_REVIEW', toStatus: 'APPROVED' },
    }),
  )

  return { verifications: out, audit }
}

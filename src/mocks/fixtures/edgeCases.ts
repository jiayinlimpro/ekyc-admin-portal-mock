// Named scenarios S01–S35 (docs/SCENARIOS.md). Each one is a UAT test case with a fixed Reference No (MOCK-05).
// Thresholds referred to below come from the flow revision (fixtures/catalog.ts) and the presets (OQ-02).
import { Faker, en } from '@faker-js/faker'
import { makeAudit } from '@/domain/audit'
import { continueCase, resumedAuditDetails } from '@/domain/caseSessions'
import { applyDecision } from '@/domain/claimRules'
import type { Actor, AuditEntry, Check, DocumentType, IdCaptureTelemetry, RiskScores, SelfieTelemetry, UpdatedBy, Verification, VerificationStatus } from '@/domain/types'
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
  referenceId: string
  flowId: string
  status: VerificationStatus
  reason?: string
  claimedByUserId?: string
  lastUpdatedBy?: UpdatedBy['kind']
  configRevision?: number
  sessions?: number // REQ: DEC-113 — how many sessions the case had (default 1)
  idVariant?: string // REQ: DEC-113 — set when the Reference ID also has a case in another project (verificationIdOf)
}

export const EDGE_CASES: EdgeCaseExpectation[] = [
  { id: 'S01', title: 'V1, both checks ≥ Auto-Pass', asUserId: fx('USR-2026-0044'), referenceId: 'KYC-260901-900001', flowId: fx('FLW-0005'), status: 'APPROVED', lastUpdatedBy: 'SYSTEM' },
  { id: 'S02', title: 'V4, checks pass but risk HIGH', asUserId: fx('USR-2026-0012'), referenceId: 'KYC-260901-900002', flowId: fx('FLW-0001'), status: 'PENDING_REVIEW', reason: 'Risk Assessment: high risk' },
  { id: 'S03', title: 'Face match 88.5 after 3 retries (review band)', asUserId: fx('USR-2026-0012'), referenceId: 'KYC-260901-900003', flowId: fx('FLW-0001'), status: 'PENDING_REVIEW', reason: 'Liveness face does not match ID face (Retry Not Allowed)' },
  { id: 'S04', title: 'Liveness below Auto-Reject after 3 retries', asUserId: fx('USR-2026-0012'), referenceId: 'KYC-260901-900004', flowId: fx('FLW-0001'), status: 'REJECTED', reason: 'Face not live (Retry Not Allowed)', lastUpdatedBy: 'SYSTEM' },
  { id: 'S05', title: 'Stopped at ID capture (read-only)', asUserId: fx('USR-2026-0012'), referenceId: 'KYC-260901-900005', flowId: fx('FLW-0001'), status: 'PROCESSING' },
  { id: 'S06', title: 'Liveness retries used up: 4 submissions, last in review band', asUserId: fx('USR-2026-0012'), referenceId: 'KYC-260901-900006', flowId: fx('FLW-0001'), status: 'PENDING_REVIEW', reason: 'Face not live (Retry Not Allowed)' },
  { id: 'S07', title: 'Claimed by Ali, ~2 min left', asUserId: fx('USR-2026-0012'), referenceId: 'KYC-260901-900007', flowId: fx('FLW-0001'), status: 'PENDING_REVIEW', claimedByUserId: fx('USR-2026-0012') },
  { id: 'S08', title: 'Claimed by Ali, expires mid-review (time warp)', asUserId: fx('USR-2026-0012'), referenceId: 'KYC-260901-900008', flowId: fx('FLW-0001'), status: 'PENDING_REVIEW', claimedByUserId: fx('USR-2026-0012') },
  { id: 'S09', title: 'Claimed by Siti; Ali can only view', asUserId: fx('USR-2026-0012'), referenceId: 'KYC-260901-900009', flowId: fx('FLW-0001'), status: 'PENDING_REVIEW', claimedByUserId: fx('USR-2026-0031') },
  { id: 'S10', title: 'Unclaimed: two reviewers race', asUserId: fx('USR-2026-0031'), referenceId: 'KYC-260901-900010', flowId: fx('FLW-0001'), status: 'PENDING_REVIEW' },
  { id: 'S11', title: 'Manually approved (final)', asUserId: fx('USR-2026-0012'), referenceId: 'KYC-260901-900011', flowId: fx('FLW-0001'), status: 'APPROVED', lastUpdatedBy: 'USER' },
  { id: 'S12', title: 'In flight on the previous flow revision (V4-R1)', asUserId: fx('USR-2026-0012'), referenceId: 'KYC-260901-900012', flowId: fx('FLW-0001'), status: 'PROCESSING', configRevision: 1 },
  { id: 'S13', title: 'Two liveness retries, then approved', asUserId: fx('USR-2026-0044'), referenceId: 'KYC-260901-900013', flowId: fx('FLW-0005'), status: 'APPROVED', lastUpdatedBy: 'SYSTEM' },
  { id: 'S15', title: 'Passport (non-MyKad)', asUserId: fx('USR-2026-0044'), referenceId: 'KYC-260901-900015', flowId: fx('FLW-0005'), status: 'APPROVED', lastUpdatedBy: 'SYSTEM' },
  { id: 'S16', title: 'SME app project (V3): Ali may only view', asUserId: fx('USR-2026-0012'), referenceId: 'KYC-260901-900016', flowId: fx('FLW-0004'), status: 'PENDING_REVIEW', reason: 'Face not live (Retry Not Allowed)' },
  { id: 'S17', title: 'In flight on a retiring flow', asUserId: fx('USR-2026-0063'), referenceId: 'KYC-260901-900017', flowId: fx('FLW-0008'), status: 'PROCESSING' },
  { id: 'S18', title: 'Rejected 30 min ago; 120-min cooldown running', asUserId: fx('USR-2026-0012'), referenceId: 'KYC-260901-900018', flowId: fx('FLW-0002'), status: 'REJECTED', reason: 'Liveness face does not match ID face (Retry Not Allowed)', lastUpdatedBy: 'SYSTEM' },
  { id: 'S19', title: 'V1 face match (ID vs selfie) below threshold, retry pending', asUserId: fx('USR-2026-0044'), referenceId: 'KYC-260901-900019', flowId: fx('FLW-0005'), status: 'PROCESSING' },
  { id: 'S20', title: 'Driving License: face match retries used up, last in review band', asUserId: fx('USR-2026-0044'), referenceId: 'KYC-260901-900020', flowId: fx('FLW-0005'), status: 'PENDING_REVIEW', reason: 'ID face and Selfie face do not match (Retry Not Allowed)' },
  { id: 'S22', title: 'V1: selfie too dark, rejected; user stopped, nothing compared', asUserId: fx('USR-2026-0044'), referenceId: 'KYC-260901-900022', flowId: fx('FLW-0005'), status: 'PROCESSING' },
  { id: 'S23', title: 'V5: High risk by its own OSINT minimum (22 < 30)', asUserId: fx('USR-2026-0012'), referenceId: 'KYC-260901-900023', flowId: fx('FLW-0014'), status: 'PENDING_REVIEW', reason: 'Risk Assessment: high risk' },
  { id: 'S24', title: 'V5: EXIF 45 is Low risk under the flow’s minimum 40 (a V4 flow would flag it)', asUserId: fx('USR-2026-0012'), referenceId: 'KYC-260901-900024', flowId: fx('FLW-0014'), status: 'APPROVED', lastUpdatedBy: 'SYSTEM' },
  { id: 'S25', title: 'Document retries used up: 4th ID image still too small → Failed', asUserId: fx('USR-2026-0012'), referenceId: 'KYC-260901-900025', flowId: fx('FLW-0001'), status: 'FAILED', reason: 'ID image smaller than 320x320 (Retry Not Allowed)', lastUpdatedBy: 'SYSTEM' },
  { id: 'S26', title: 'Internal test session on V6: not charged; hidden from Atoz’s users', asUserId: fx('USR-2026-0001'), referenceId: 'KYC-260901-900026', flowId: fx('FLW-0015'), status: 'APPROVED', lastUpdatedBy: 'SYSTEM' },
  // REQ: DEC-112 — FAILED on V1 (selfie) and V3 (document), and the V1 rule that the face match decides once a selfie was compared.
  { id: 'S27', title: 'V1: all 4 selfies failed the quality check, none compared → Failed', asUserId: fx('USR-2026-0044'), referenceId: 'KYC-260901-900027', flowId: fx('FLW-0005'), status: 'FAILED', reason: 'No valid face in Selfie detected (Retry Not Allowed)', lastUpdatedBy: 'SYSTEM' },
  { id: 'S28', title: 'V3: Document retries used up, Address still not read → Failed', asUserId: fx('USR-2026-0020'), referenceId: 'KYC-260901-900028', flowId: fx('FLW-0004'), status: 'FAILED', reason: 'Address field not detected (Retry Not Allowed)', lastUpdatedBy: 'SYSTEM' },
  { id: 'S29', title: 'V1: 3 compared selfies below Auto-Reject, the 4th blurry → Rejected (not Failed)', asUserId: fx('USR-2026-0044'), referenceId: 'KYC-260901-900029', flowId: fx('FLW-0005'), status: 'REJECTED', reason: 'ID face and Selfie face do not match (Retry Not Allowed)', lastUpdatedBy: 'SYSTEM' },
  // REQ: DEC-113 / DEC-26 — a returning Reference ID continues its case; cooldowns.
  { id: 'S30', title: 'Same Reference ID, 3 sessions: Failed → Rejected → Approved', asUserId: fx('USR-2026-0012'), referenceId: 'KYC-260901-900030', flowId: fx('FLW-0001'), status: 'APPROVED', lastUpdatedBy: 'SYSTEM', sessions: 3 },
  { id: 'S31', title: 'Rejected, came back after the 120-min cooldown: session 2 in progress', asUserId: fx('USR-2026-0012'), referenceId: 'KYC-260901-900031', flowId: fx('FLW-0002'), status: 'PROCESSING', sessions: 2 },
  { id: 'S32', title: 'Rejected by a reviewer, came back on another flow: session 2 in review', asUserId: fx('USR-2026-0012'), referenceId: 'KYC-260901-900032', flowId: fx('FLW-0014'), status: 'PENDING_REVIEW', reason: 'Liveness face does not match ID face (Retry Not Allowed)', sessions: 2 },
  { id: 'S33', title: 'Failed 17 min ago; 30-min Cooldown after Failed running', asUserId: fx('USR-2026-0012'), referenceId: 'KYC-260901-900033', flowId: fx('FLW-0002'), status: 'FAILED', reason: 'ID image smaller than 320x320 (Retry Not Allowed)', lastUpdatedBy: 'SYSTEM' },
  // REQ: DEC-113 — the same Reference ID in two projects of Atoz: two separate cases, each with its own Verification ID.
  { id: 'S34', title: 'Reference ID also used in SME app: here (Default) Rejected', asUserId: fx('USR-2026-0002'), referenceId: 'KYC-260901-900034', flowId: fx('FLW-0001'), status: 'REJECTED', reason: 'Face not live (Retry Not Allowed)', lastUpdatedBy: 'SYSTEM' },
  { id: 'S35', title: 'Same Reference ID as S34, in SME app: its own case, Approved', asUserId: fx('USR-2026-0002'), referenceId: 'KYC-260901-900034', flowId: fx('FLW-0004'), status: 'APPROVED', lastUpdatedBy: 'SYSTEM', idVariant: 'PRJ-0002' },
  { id: 'S21', title: 'Existing user found (duplicate, information only)', asUserId: fx('USR-2026-0012'), referenceId: 'KYC-260901-900021', flowId: fx('FLW-0001'), status: 'PENDING_REVIEW', reason: 'Liveness face does not match ID face (Retry Not Allowed)' },
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
    opts: { riskScore?: number; documentType?: DocumentType; stepMin?: number; idCapture?: Partial<IdCaptureTelemetry>; duplicateSimilarity?: number; riskScores?: RiskScores; stoppedAtSelfie?: Partial<SelfieTelemetry>; softRejects?: number; selfieFailures?: number; lastSelfieFailed?: Partial<SelfieTelemetry>; sessionNo?: number; idVariant?: string } = {},
  ): Verification => {
    const flow = catalog.flows.find((x) => x.flowId === flowId)!
    const p = person(f, now, opts.documentType ?? 'MYKAD')
    return buildCase({
      referenceId: `KYC-260901-${String(900000 + seq)}`,
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
      riskScores: opts.riskScores,
      stoppedAtSelfie: opts.stoppedAtSelfie,
      softRejects: opts.softRejects,
      selfieFailures: opts.selfieFailures,
      lastSelfieFailed: opts.lastSelfieFailed,
      sessionNo: opts.sessionNo,
      idVariant: opts.idVariant,
    })
  }

  // REQ: DEC-113 — the same Reference ID came back: each later session continues the case (CASE_RESUMED by SYSTEM).
  // The end user is the same person: personal data from the first session.
  const flowName = (id: string) => catalog.flows.find((x) => x.flowId === id)!.name
  const continued = (first: Verification, ...later: Verification[]): Verification => {
    let v = first
    for (const next of later) {
      const startedAt = new Date(next.createdAt)
      const resumed = continueCase(v, { flowId: next.flowId, projectId: next.projectId, workflowVersion: next.workflowVersion, configRevision: next.configRevision }, startedAt)
      audit.push(makeAudit({ id: '', now: startedAt, action: 'CASE_RESUMED', actor: 'SYSTEM', ip: fakeIp(f), merchantId: v.merchantId, projectId: v.projectId, verificationId: v.verificationId, referenceId: v.referenceId, details: resumedAuditDetails(v, resumed, flowName) }))
      v = { ...next, verificationId: resumed.verificationId, createdAt: resumed.createdAt, sessions: resumed.sessions, pii: { ...next.pii, ...first.pii }, documentType: first.documentType }
    }
    return v
  }
  const rejectedBy = (v: Verification, actor: Actor, decidedMinAgo: number, reasonCodes: string[]): Verification => {
    const claimed = claimFor(v, actor, decidedMinAgo + 4)
    const decision = { outcome: 'REJECT' as const, reasonCodes }
    const decidedAt = ago(decidedMinAgo)
    audit.push(makeAudit({ id: '', now: decidedAt, action: 'CASE_DECISION_REJECTED', actor, actorRole: 'Reviewer', ip: fakeIp(f), merchantId: v.merchantId, projectId: v.projectId, verificationId: v.verificationId, referenceId: v.referenceId, details: { ...decision, fromStatus: 'PENDING_REVIEW', toStatus: 'REJECTED' } }))
    return applyDecision(claimed, actor, decision, decidedAt)
  }
  const passes = (n: number) => Array.from({ length: n }, (_, i) => 95.5 + i * 0.4)

  const claimFor = (v: Verification, actor: Actor, claimedMinAgo: number): Verification => {
    const timeoutMin = catalog.projects.find((p) => p.projectId === v.projectId)!.claimTimeoutSec / 60 // REQ: DEC-22
    const claimedAt = ago(claimedMinAgo)
    const ref = { merchantId: v.merchantId, projectId: v.projectId, verificationId: v.verificationId, referenceId: v.referenceId, actorRole: 'Reviewer' } // Ali and Siti review Atoz Default
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
      // An edited photo, a disposable new email domain and no social presence: below every minimum (DEC-107).
      riskScores: { EXIF: 32, NOISE: 18, EMAIL_VALIDITY: 20, OSINT: 10 },
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
    // Vantage FLW-0005 (V1, face match Advanced < 82 / ≥ 93): face match retry pending.
    make(19, fx('FLW-0005'), 25, { FACE_MATCH: [70.0] }),
    // Vantage FLW-0005 R2 accepts Driving License: face match < 82 / ≥ 93, 3 retries used, last 88.0 → review; liveness passes.
    make(20, fx('FLW-0005'), 20, { FACE_MATCH: [80.1, 84.0, 86.2, 88.0], LIVENESS: [96.2] }, { documentType: 'DRIVING_LICENSE' }),
    // Atoz FLW-0001: face match in the review band after 3 retries; the face search found an existing user (97.6).
    make(21, fx('FLW-0001'), 50, { FACE_MATCH: [86.0, 87.5, 88.0, 89.2], LIVENESS: passes(4) }, { riskScore: 18, duplicateSimilarity: 97.6 }),
    // Atoz FLW-0001: three ID images failed, and the fourth (the last of 3 Document retries) is still too small (DEC-108).
    make(25, fx('FLW-0001'), 12, {}, { softRejects: 3, idCapture: { imageWidth: 300, imageHeight: 240 } }),
    // Atoz "Premium accounts" FLW-0014 (V5, own risk minimums EXIF 40 · Noise 60 · Email 50 · OSINT 30).
    make(23, fx('FLW-0014'), 30, { FACE_MATCH: [98.2], LIVENESS: [96.5] }, { riskScores: { EXIF: 72, NOISE: 80, EMAIL_VALIDITY: 65, OSINT: 22 } }),
    make(24, fx('FLW-0014'), 28, { FACE_MATCH: [98.0], LIVENESS: [95.9] }, { riskScores: { EXIF: 45, NOISE: 78, EMAIL_VALIDITY: 70, OSINT: 55 } }),
    // Atoz "Next engine trial" FLW-0015 (V6, Internal testing): a platform test session, not charged (DEC-56, DEC-60).
    make(26, fx('FLW-0015'), 35, { FACE_MATCH: [96.0], LIVENESS: [94.0] }),
    // Vantage FLW-0005 (V1): the selfie was too dark (brightness 14.2), so the engine ended the run before Face Match.
    make(22, fx('FLW-0005'), 15, {}, { idCapture: { faceConfidence: 98.4, imageWidth: 1600, imageHeight: 1000, ocrFieldsMissing: [] }, stoppedAtSelfie: { brightness: 14.2, sharpness: 52.0, yaw: 4.0, pitch: -3.0, eyesOpen: true, occluded: false } }),
    // Vantage FLW-0005 (V1, 3 Selfie retries): 4 selfies submitted, every one failed the quality check; nothing compared (DEC-112).
    make(27, fx('FLW-0005'), 18, {}, { idCapture: { faceConfidence: 98.0, imageWidth: 1600, imageHeight: 1000, ocrFieldsMissing: [] }, stoppedAtSelfie: { sharpness: 11.5, brightness: 48.0, yaw: 3.0, pitch: 2.0, eyesOpen: true, occluded: false }, selfieFailures: 4 }),
    // Atoz "SME director check" FLW-0004 (V3, 3 Document retries): the 4th MyKad image still has no readable Address (DEC-112).
    make(28, fx('FLW-0004'), 25, {}, { softRejects: 3, idCapture: { faceConfidence: 98.1, imageWidth: 1600, imageHeight: 1000, ocrFieldsMissing: ['Address'] } }),
    // Vantage FLW-0005 (face match Advanced < 82): 3 compared selfies below Auto-Reject, then a blurry one: Selfie retries
    // used up, but a selfie was compared, so the last face match decides → REJECTED, not FAILED (DEC-112).
    make(29, fx('FLW-0005'), 22, { FACE_MATCH: [70.0, 72.5, 75.0] }, { lastSelfieFailed: { sharpness: 9.0, brightness: 55.0, yaw: 2.0, pitch: 1.0, eyesOpen: true, occluded: false } }),
    // Atoz FLW-0001 (cooldowns 0): Failed at the document (R1, yesterday), then Rejected (liveness), then Approved today (R2).
    continued(
      make(30, fx('FLW-0001'), 1500, {}, { softRejects: 3, idCapture: { imageWidth: 300, imageHeight: 240 } }),
      make(30, fx('FLW-0001'), 1400, { FACE_MATCH: passes(4), LIVENESS: [20.0, 25.0, 30.0, 35.0] }, { sessionNo: 2 }),
      make(30, fx('FLW-0001'), 60, { FACE_MATCH: [96.1], LIVENESS: [97.0] }, { sessionNo: 3 }),
    ),
    // Atoz "Foreigner onboarding" FLW-0002 (Rejected cooldown 120 min): rejected ~4 h ago, back 30 min ago, liveness retry pending.
    continued(
      make(31, fx('FLW-0002'), 260, { FACE_MATCH: [80.0, 82.0, 84.0, 83.0], LIVENESS: passes(4) }, { documentType: 'PASSPORT' }),
      make(31, fx('FLW-0002'), 30, { FACE_MATCH: [98.0], LIVENESS: [60.0] }, { documentType: 'PASSPORT', sessionNo: 2 }),
    ),
    // Atoz FLW-0001 (Rejected cooldown 0): Ali rejected it 70 min ago; the same Reference ID came back on "Premium accounts"
    // (FLW-0014, V5, face match High < 90 / ≥ 97): the case moved to that flow and is in review again.
    continued(
      rejectedBy(make(32, fx('FLW-0001'), 100, { FACE_MATCH: [86.0, 87.0, 88.0, 89.0], LIVENESS: passes(4) }, { riskScore: 15 }), ali, 70, ['FACE_MISMATCH']),
      make(32, fx('FLW-0014'), 40, { FACE_MATCH: [91.0, 92.0, 93.0, 94.5], LIVENESS: passes(4) }, { riskScore: 15, sessionNo: 2 }),
    ),
    // Atoz FLW-0002 (Cooldown after Failed 30 min): the 4th passport image still too small, 17 min ago.
    make(33, fx('FLW-0002'), 20, {}, { documentType: 'PASSPORT', softRejects: 3, idCapture: { imageWidth: 300, imageHeight: 240 } }),
  ]
  // REQ: DEC-113 — the merchant sent the same Reference ID to two projects. Default: liveness below Auto-Reject → Rejected.
  // SME app (V3) has no case for it, so it starts its own (no cooldown carried over) and passes → Approved.
  const s34 = make(34, fx('FLW-0001'), 150, { FACE_MATCH: passes(4), LIVENESS: [45.0, 50.0, 48.0, 52.0] })
  const s35 = make(34, fx('FLW-0004'), 20, { FACE_MATCH: [96.0], LIVENESS: [90.0] }, { idVariant: 'PRJ-0002' })
  out.push(s34, { ...s35, pii: s34.pii, documentType: s34.documentType }) // the same person, as the merchant told us

  // S16: Nurul (Reviewer, SME app) looked at it a few minutes ago without claiming it.
  const s16 = out.find((v) => v.referenceId === 'KYC-260901-900016')!
  audit.push(makeAudit({ id: '', now: ago(5), action: 'SENSITIVE_PII_VIEW', actor: { userId: fx('USR-2026-0033'), fullName: 'Nurul Huda Binti Kamaruddin' }, actorRole: 'Reviewer', ip: fakeIp(f), merchantId: s16.merchantId, projectId: s16.projectId, verificationId: s16.verificationId, referenceId: s16.referenceId }))

  // S11: manually approved by Ali 10 minutes ago.
  const s11 = out.findIndex((v) => v.referenceId === 'KYC-260901-900011')
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
      verificationId: out[s11].verificationId,
      referenceId: out[s11].referenceId,
      details: { ...decision, fromStatus: 'PENDING_REVIEW', toStatus: 'APPROVED' },
    }),
  )

  return { verifications: out, audit }
}

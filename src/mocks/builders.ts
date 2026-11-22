// Shared builders for seeded and hand-written records. Status is always computed by checkRules.evaluateCase, never random.
import { evaluateCase, evaluateRisk, type FlowContext } from '@/domain/checkRules'
import { hasRisk } from '@/domain/registryRules'
import { ENGINE_THRESHOLDS, idCaptureCondition, OCR_FIELDS, SELFIE_FAILED_CONDITION } from '@/domain/telemetry'
import {
  type Attempt,
  type AttemptTelemetry,
  type Check,
  type ClientMetadata,
  type DocumentType,
  type Flow,
  type FlowRevision,
  type IdCaptureTelemetry,
  type RegistryEntry,
  RISK_CATEGORIES,
  type RiskScores,
  type SelfieTelemetry,
  type Verification,
  type WorkflowVersion,
} from '@/domain/types'
import { revisionAt } from './fixtures/catalog'
import type { Person } from './malaysia'
import { verificationIdOf, stableId } from '@/lib/ids'

const HOUR = 3_600_000

export interface CaseSpec {
  referenceId: string
  flow: Flow
  revisions: readonly FlowRevision[]
  entry: RegistryEntry
  person: Person
  metadata: ClientMetadata
  startedAt: Date
  /** Scores per check in submission order. Empty = the session stopped before the first liveness / selfie submission. */
  submissions: Partial<Record<Check, number[]>>
  /** Minutes between submissions (default 6). */
  stepMin?: number
  /** Mock input: how risky the session is (0–100). The engine's category scores are drawn from it (DEC-107). */
  riskScore?: number
  softRejects?: number
  abandoned?: 'ABORTED' | 'TIMED_OUT'
  /** DEC-105 overrides; otherwise generated from the Reference No (stable). */
  idCapture?: Partial<IdCaptureTelemetry>
  duplicateSimilarity?: number
  riskScores?: RiskScores
  /** V1 with no submission: the selfie the engine rejected when the user stopped (no similarity was run). */
  stoppedAtSelfie?: Partial<SelfieTelemetry>
  /** V1 with `stoppedAtSelfie`: how many submitted selfies failed the quality check (default 1; all retries used → FAILED, DEC-112). */
  selfieFailures?: number
  /** V1: after the compared selfies, one more submitted selfie failed the quality check (DEC-112: the face match still decides). */
  lastSelfieFailed?: Partial<SelfieTelemetry>
  /** REQ: DEC-113 — the session of the case this builds (default 1); later sessions get their own attempt IDs and telemetry. */
  sessionNo?: number
}

/** Builds a case in its SYSTEM-assigned state (checkRules.evaluateCase). Manual decisions and claims are applied afterwards. */
export function buildCase(spec: CaseSpec): Verification {
  const rev = revisionAt(spec.revisions, spec.flow.flowId, spec.startedAt)!
  const key = (spec.sessionNo ?? 1) > 1 ? `${spec.referenceId}#${spec.sessionNo}` : spec.referenceId // REQ: DEC-113
  const rand = rng(key) // REQ: DEC-105 — telemetry is stable per case across resets (MOCK-05)
  const flow: FlowContext = { checks: spec.entry.configurableChecks, faceMatchMethod: spec.entry.faceMatchMethod, hasRisk: hasRisk(spec.entry), settings: rev.settings }

  // REQ: DEC-17 — one attempt per submission round under the same Reference No (the round's time is on the timeline).
  const step = (spec.stepMin ?? 6) * 60_000
  const rounds = Math.max(0, ...Object.values(spec.submissions).map((s) => s?.length ?? 0))
  const at = (i: number) => new Date(spec.startedAt.getTime() + i * step).toISOString()
  const v1 = spec.entry.faceMatchMethod === 'ID_VS_SELFIE'
  const idCap = { ...idCapture(rand, spec.person.documentType, rounds === 0), ...spec.idCapture }
  // REQ: DEC-108 — failed ID submissions each used a Document retry; the last one may still be failing.
  const idFailed = idCaptureCondition(idCap, spec.person.documentType)
  const document = { failed: (spec.softRejects ?? 0) + (idFailed ? 1 : 0), lastFailed: idFailed }
  // REQ: DEC-105 — V1: a selfie that fails the quality check ends the run before Face Match: nothing is compared.
  const stoppedSelfie = rounds === 0 && v1 && !idFailed && (spec.stoppedAtSelfie || rand() < 0.5) ? { ...failingSelfie(rand), ...spec.stoppedAtSelfie } : undefined
  // REQ: DEC-108 — V1: sometimes one submitted selfie failed its check before a compared one. It used a Selfie retry, so it is
  // only added where the budget leaves the planned outcome unchanged.
  const fm = spec.submissions.FACE_MATCH ?? []
  const base = evaluateCase({ submissions: spec.submissions, document }, flow)
  const fmState = base.checks.find((c) => c.check === 'FACE_MATCH')?.state
  const room = rev.settings.retries.SELFIE + 1 - fm.length - (fmState === 'RETRY' ? 1 : 0)
  // REQ: DEC-112 — a failing selfie after the compared ones (the face match still decides), or several before stopping.
  const lastSelfie = v1 && fm.length > 0 && spec.lastSelfieFailed ? { ...failingSelfie(rand), ...spec.lastSelfieFailed } : undefined
  const earlierStopped = stoppedSelfie ? Array.from({ length: (spec.selfieFailures ?? 1) - 1 }, () => failingSelfie(rand)) : []
  const retakeRound = !lastSelfie && v1 && fm.length > 0 && room > 0 && rand() < 0.25 ? Math.floor(rand() * fm.length) : undefined
  const selfieFailed = stoppedSelfie ? (spec.selfieFailures ?? 1) : (retakeRound !== undefined ? 1 : 0) + (lastSelfie ? 1 : 0)
  const selfie = selfieFailed ? { failed: selfieFailed, lastFailed: stoppedSelfie || lastSelfie ? SELFIE_FAILED_CONDITION : undefined } : undefined
  const pre = evaluateCase({ submissions: spec.submissions, document, selfie }, flow)
  // Risk runs once onboarding completes without a reject (FRS AWS flow: V4 runs risk after onboarding).
  const riskRan = flow.hasRisk && spec.riskScore !== undefined && !document.lastFailed && pre.checks.every((c) => c.state === 'PASS' || c.state === 'REVIEW')
  const riskScores = riskRan ? (spec.riskScores ?? categoryScores(rand, spec.riskScore!)) : undefined
  const ev = evaluateCase({ submissions: spec.submissions, riskScores, document, selfie }, flow)
  const faceMatchState = pre.checks.find((c) => c.check === 'FACE_MATCH')?.state
  const attempts: Attempt[] =
    rounds === 0
      ? [
          {
            attemptId: stableId('att', `${key}:1`),
            attemptNo: 1,
            phase: stoppedSelfie ? 'SELFIE' : 'DOCUMENT',
            startedAt: at(0),
            outcome: ev.status === 'FAILED' ? 'COMPLETED' : (spec.abandoned ?? 'ABORTED'), // REQ: DEC-108 / DEC-112 — retries used up, no usable image
            isUserRetake: false,
            phaseScores: {},
            ...(stoppedSelfie ? { faceImage: { fileId: stableId('file', `${key}:face:1`), url: '/mock/selfie.svg' }, telemetry: { selfieRetakes: [...earlierStopped, stoppedSelfie] } } : {}),
          },
        ]
      : Array.from({ length: rounds }, (_, i) => {
          const scores: Attempt['phaseScores'] = {}
          // REQ: DEC-105 — a score only on the attempt that submitted it. V1 runs face match before liveness, so its face
          // match submissions open the session and its liveness submissions close it.
          for (const c of flow.checks) {
            const s = spec.submissions[c] ?? []
            const j = c === 'LIVENESS' ? i - (rounds - s.length) : i
            if (j >= 0 && j < s.length) scores[c] = s[j]
          }
          const final = i === rounds - 1 && ev.status !== 'PROCESSING' && !lastSelfie
          return {
            attemptId: stableId('att', `${key}:${i + 1}`),
            attemptNo: i + 1,
            phase: 'LIVENESS',
            startedAt: at(i),
            outcome: final ? 'COMPLETED' : 'FAILED_RETAKE',
            isUserRetake: i > 0,
            phaseScores: scores,
            ...(scores.FACE_MATCH === undefined
              ? {}
              : {
                  faceImage: { fileId: stableId('file', `${key}:face:${i + 1}`), url: spec.entry.faceMatchMethod === 'ID_VS_SELFIE' ? '/mock/selfie.svg' : '/mock/liveness.svg' },
                  telemetry: attemptTelemetry(rand, v1, scores.FACE_MATCH, i === retakeRound),
                }),
          }
        })
  // REQ: DEC-112 — V1: the last submitted selfie failed the quality check after the compared ones; nothing compared after it.
  if (lastSelfie)
    attempts.push({
      attemptId: stableId('att', `${key}:${rounds + 1}`),
      attemptNo: rounds + 1,
      phase: 'SELFIE',
      startedAt: at(rounds),
      outcome: ev.status === 'PROCESSING' ? 'ABORTED' : 'COMPLETED',
      isUserRetake: true,
      phaseScores: {},
      faceImage: { fileId: stableId('file', `${key}:face:${rounds + 1}`), url: '/mock/selfie.svg' },
      telemetry: { selfieRetakes: [lastSelfie] },
    })

  // REQ: DEC-03 — lastUpdatedAt only moves on status change: PROCESSING was set when the user entered the flow.
  const lastUpdatedAt = ev.status === 'PROCESSING' ? at(0) : new Date(Date.parse(attempts.at(-1)!.startedAt) + 3 * 60_000).toISOString()
  const decisive = ev.status === 'PENDING_REVIEW' || ev.status === 'REJECTED' || ev.status === 'FAILED'
  const image = { MYKAD: '/mock/mykad-front.svg', PASSPORT: '/mock/passport.svg', DRIVING_LICENSE: '/mock/driving-license.svg' }[spec.person.documentType]
  // REQ: DEC-44 — V4/V5 sessions require an email; reserved .example domain, never a real address.
  const email = spec.entry.requiredInputs.includes('EMAIL') ? emailFor(spec.person.pii.fullName, spec.referenceId) : undefined
  return {
    verificationId: verificationIdOf(spec.referenceId), // REQ: DEC-97 — stable for seeded cases (MOCK-05)
    referenceId: spec.referenceId,
    merchantId: spec.flow.merchantId,
    workflowVersion: spec.flow.workflowVersion as WorkflowVersion,
    status: ev.status,
    statusReason: decisive ? ev.reason : undefined,
    statusDetail: decisive ? ev.detail : undefined,
    lastUpdatedBy: { kind: 'SYSTEM' },
    lastUpdatedAt,
    attempts,
    riskScores,
    riskResult: riskScores ? evaluateRisk(riskScores, rev.settings.risk).result : undefined,
    idCapture: idCap,
    // REQ: DEC-105 — the existing-user search runs only after the face comparison passes ("Existing User Seeking" follows
    // "Match Validation"); in the review band the case goes on, so it is searched too.
    duplicateUser: faceMatchState === 'PASS' || faceMatchState === 'REVIEW' ? duplicateUser(spec.duplicateSimilarity ?? (rand() < 0.06 ? between(rand, 90, 99.5) : between(rand, 8, 62))) : undefined,
    documentType: spec.person.documentType,
    pii: email ? { ...spec.person.pii, email } : spec.person.pii,
    clientMetadata: spec.metadata,
    images: { docFront: { fileId: stableId('file', `${spec.referenceId}:doc`), url: image }, selfie: { fileId: stableId('file', `${spec.referenceId}:selfie`), url: '/mock/selfie.svg' } },
    charged: spec.entry.status !== 'INTERNAL_TESTING', // REQ: DEC-60 / DEC-56
    projectId: spec.flow.projectId,
    flowId: spec.flow.flowId,
    configRevision: rev.revision,
    createdAt: at(0),
    submissions: spec.submissions,
    idCaptureSoftRejects: spec.softRejects ?? 0,
    sessions: [{ sessionNo: 1, startedAt: at(0), flowId: spec.flow.flowId, workflowVersion: spec.flow.workflowVersion as WorkflowVersion, configRevision: rev.revision }], // REQ: DEC-113
  }
}

/** Small seeded PRNG (mulberry32 over a string hash): telemetry stays the same for a Reference No. */
function rng(seed: string): () => number {
  let h = 1779033703
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
  return () => {
    h = (h + 0x6d2b79f5) | 0
    let t = Math.imul(h ^ (h >>> 15), 1 | h)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const between = (r: () => number, min: number, max: number) => Math.round((min + r() * (max - min)) * 10) / 10
const T = ENGINE_THRESHOLDS

// REQ: DEC-105 / DEC-108 — an ID image or selfie that fails the engine checks is submitted again, so the accepted one passes.
// A session that stopped at ID capture sometimes shows why: its last image failed one check.
function idCapture(r: () => number, documentType: DocumentType, stoppedAtId: boolean): IdCaptureTelemetry {
  const ok: IdCaptureTelemetry = {
    facesFound: 1,
    faceConfidence: between(r, 96, 99.9),
    eyesOpen: true,
    occluded: false,
    imageWidth: [1280, 1600, 1920][Math.floor(r() * 3)],
    imageHeight: [800, 1000, 1200][Math.floor(r() * 3)],
    ocrFieldsMissing: [],
  }
  if (!stoppedAtId || r() < 0.5) return ok
  const fields = OCR_FIELDS[documentType]
  const fail = Math.floor(r() * 3)
  if (fail === 0) return { ...ok, imageWidth: 300, imageHeight: 240 }
  if (fail === 1) return { ...ok, faceConfidence: between(r, 60, T.faceMatchMin - 1) }
  return { ...ok, ocrFieldsMissing: [fields[fields.length - 1]] }
}

/** A selfie that fails one check of the engine's Selfie Quality Check (too dark, blurred, head turned, eyes closed, covered). */
function failingSelfie(r: () => number): SelfieTelemetry {
  const ok: SelfieTelemetry = { eyesOpen: true, occluded: false, sharpness: between(r, 40, 80), brightness: between(r, 40, 80), yaw: between(r, -10, 10), pitch: between(r, -10, 10), faceSizePx: Math.round(between(r, 90, 220)) }
  const fail = Math.floor(r() * 5)
  if (fail === 0) return { ...ok, brightness: between(r, 8, T.brightnessMin) }
  if (fail === 1) return { ...ok, sharpness: between(r, 6, T.sharpnessMin) }
  if (fail === 2) return { ...ok, yaw: (r() < 0.5 ? -1 : 1) * between(r, T.maxYawDeg + 2, 48) }
  if (fail === 3) return { ...ok, eyesOpen: false }
  return { ...ok, occluded: true }
}

/** Lower similarity comes with a poorer (still passing) selfie, as in real sessions. V1: `retake` = a failed selfie before it. */
function attemptTelemetry(r: () => number, selfie: boolean, similarity: number | undefined, retake: boolean): AttemptTelemetry {
  const q = similarity === undefined ? 1 : Math.max(0, Math.min(1, (similarity - 60) / 40))
  const sign = () => (r() < 0.5 ? -1 : 1)
  return {
    faceMatchConfidence: similarity === undefined ? undefined : between(r, 95, 99.9),
    ...(selfie && retake ? { selfieRetakes: [failingSelfie(r)] } : {}),
    selfie: selfie
      ? {
          eyesOpen: true,
          occluded: false,
          sharpness: between(r, 28 + 40 * q, 50 + 45 * q),
          brightness: between(r, 30 + 30 * q, 55 + 35 * q),
          yaw: sign() * between(r, 1, 26 - 18 * q),
          pitch: sign() * between(r, 1, 24 - 16 * q),
          faceSizePx: Math.round(between(r, 70 + 120 * q, 140 + 160 * q)),
        }
      : undefined,
  }
}

function duplicateUser(similarity: number) {
  return { existingUser: similarity >= T.duplicateSimilarityMin, similarity }
}

// REQ: DEC-107 (mock) — the weakest category sits at 100 − risk; the others somewhat above it. How the engine scores and
// normalises each category is OQ-25.
function categoryScores(r: () => number, risk: number): RiskScores {
  const base = 100 - risk
  const weakest = Math.floor(r() * RISK_CATEGORIES.length)
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))
  return Object.fromEntries(RISK_CATEGORIES.map((c, i) => [c, clamp(i === weakest ? base : base + 4 + r() * 20)])) as RiskScores
}

function emailFor(fullName: string, referenceId: string): string {
  const words = fullName.toLowerCase().replace(/[^a-z ]/g, '').split(' ').filter((w) => w && !['bin', 'binti', 'al', 'ap'].includes(w))
  return `${words.slice(0, 2).join('.')}${referenceId.slice(-3)}@mail.example`
}

export function refNo(date: Date, seq: number): string {
  // Reference date in MYT (UTC+8).
  const myt = new Date(date.getTime() + 8 * HOUR)
  const yymmdd = myt.toISOString().slice(2, 10).replaceAll('-', '')
  return `KYC-${yymmdd}-${String(seq).padStart(6, '0')}`
}

/** Mock secret: never a real key. */
export function mockSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return `sk_mock_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

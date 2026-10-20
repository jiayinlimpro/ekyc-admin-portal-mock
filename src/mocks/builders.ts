// Shared builders for seeded and hand-written records. Status is always computed by checkRules.evaluateCase, never random.
import { evaluateCase, type FlowContext } from '@/domain/checkRules'
import { riskLevelFromScore } from '@/domain/openQuestions'
import { hasRisk } from '@/domain/registryRules'
import type { Attempt, Check, ClientMetadata, Flow, FlowRevision, RegistryEntry, Verification, WorkflowVersion } from '@/domain/types'
import { revisionAt } from './fixtures/catalog'
import type { Person } from './malaysia'

const HOUR = 3_600_000

export interface CaseSpec {
  referenceNo: string
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
  riskScore?: number // V4: engine output, used once every check has a non-reject result
  softRejects?: number
  abandoned?: 'ABORTED' | 'TIMED_OUT'
}

/** Builds a case in its SYSTEM-assigned state (checkRules.evaluateCase). Manual decisions and claims are applied afterwards. */
export function buildCase(spec: CaseSpec): Verification {
  const rev = revisionAt(spec.revisions, spec.flow.flowId, spec.startedAt)!
  const flow: FlowContext = { checks: spec.entry.configurableChecks, faceMatchMethod: spec.entry.faceMatchMethod, hasRisk: hasRisk(spec.entry), settings: rev.settings }
  const pre = evaluateCase({ submissions: spec.submissions }, flow)
  // Risk runs once onboarding completes without a reject (FRS AWS flow: V4 runs risk after onboarding).
  const riskRan = flow.hasRisk && spec.riskScore !== undefined && pre.checks.every((c) => c.state === 'PASS' || c.state === 'REVIEW')
  const riskLevel = riskRan ? riskLevelFromScore(spec.riskScore!) : undefined
  const ev = evaluateCase({ submissions: spec.submissions, riskLevel }, flow)

  // REQ: DEC-17 — one attempt per submission round under the same Reference No (the round's time is on the timeline).
  const step = (spec.stepMin ?? 6) * 60_000
  const rounds = Math.max(0, ...Object.values(spec.submissions).map((s) => s?.length ?? 0))
  const at = (i: number) => new Date(spec.startedAt.getTime() + i * step).toISOString()
  const attempts: Attempt[] =
    rounds === 0
      ? [{ attemptNo: 1, phase: 'DOCUMENT', startedAt: at(0), outcome: spec.abandoned ?? 'ABORTED', isUserRetake: false, phaseScores: {} }]
      : Array.from({ length: rounds }, (_, i) => {
          const scores: Attempt['phaseScores'] = {}
          for (const c of flow.checks) {
            const s = spec.submissions[c]
            if (s?.length) scores[c] = s[Math.min(i, s.length - 1)]
          }
          const final = i === rounds - 1 && ev.status !== 'PROCESSING'
          return { attemptNo: i + 1, phase: 'LIVENESS', startedAt: at(i), outcome: final ? 'COMPLETED' : 'FAILED_RETAKE', isUserRetake: i > 0, phaseScores: scores }
        })

  // REQ: DEC-03 — lastUpdatedAt only moves on status change: PROCESSING was set when the user entered the flow.
  const lastUpdatedAt = ev.status === 'PROCESSING' ? at(0) : new Date(Date.parse(attempts.at(-1)!.startedAt) + 3 * 60_000).toISOString()
  const decisive = ev.status === 'PENDING_REVIEW' || ev.status === 'REJECTED'
  const image = { MYKAD: '/mock/mykad-front.svg', PASSPORT: '/mock/passport.svg', DRIVING_LICENSE: '/mock/driving-license.svg' }[spec.person.documentType]
  // REQ: DEC-44 — V4/V5 sessions require an email; reserved .example domain, never a real address.
  const email = spec.entry.requiredInputs.includes('EMAIL') ? emailFor(spec.person.pii.fullName, spec.referenceNo) : undefined
  return {
    referenceNo: spec.referenceNo,
    merchantId: spec.flow.merchantId,
    workflowVersion: spec.flow.workflowVersion as WorkflowVersion,
    status: ev.status,
    statusReason: decisive ? ev.reason : undefined,
    statusDetail: decisive ? ev.detail : undefined,
    lastUpdatedBy: { kind: 'SYSTEM' },
    lastUpdatedAt,
    attempts,
    riskLevel,
    riskScore: riskRan ? spec.riskScore : undefined,
    documentType: spec.person.documentType,
    pii: email ? { ...spec.person.pii, email } : spec.person.pii,
    clientMetadata: spec.metadata,
    images: { docFront: image, selfie: '/mock/selfie.svg' },
    charged: true,
    projectId: spec.flow.projectId,
    flowId: spec.flow.flowId,
    configRevision: rev.revision,
    createdAt: at(0),
    submissions: spec.submissions,
    idCaptureSoftRejects: spec.softRejects ?? 0,
  }
}

function emailFor(fullName: string, referenceNo: string): string {
  const words = fullName.toLowerCase().replace(/[^a-z ]/g, '').split(' ').filter((w) => w && !['bin', 'binti', 'al', 'ap'].includes(w))
  return `${words.slice(0, 2).join('.')}${referenceNo.slice(-3)}@mail.example`
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

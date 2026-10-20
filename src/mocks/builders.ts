// Shared builders for seeded and hand-written records. Status is always computed by checkRules.evaluateCase, never random.
import { evaluateCase, type CaseEvaluation, type FlowContext } from '@/domain/checkRules'
import { DEFAULT_CLAIM_TIMEOUT_MIN, DEFAULT_CLAIM_WARNING_MIN, DEFAULT_PHASE_THRESHOLDS, DEFAULT_RISK_MAX_ALLOWED, riskLevelFromScore } from '@/domain/openQuestions'
import { hasRisk } from '@/domain/registryRules'
import {
  CAPTURE_PHASES,
  RISK_LEVELS,
  type Attempt,
  type Check,
  type ClientMetadata,
  type Flow,
  type FlowRevision,
  type Merchant,
  type MerchantConfig,
  type PhaseMetric,
  type RegistryEntry,
  type RiskLevel,
  type Verification,
  type WorkflowVersion,
} from '@/domain/types'
import { revisionAt } from './fixtures/catalog'
import type { Person } from './malaysia'

export interface ConfigRecord {
  deployed: MerchantConfig
  draft?: MerchantConfig
  history: MerchantConfig[] // every deployed version, oldest first (includes `deployed`)
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** v1.0.0 (older, looser thresholds) and v1.1.0 (current defaults). Atoz deployed v1.1.0 two hours ago, so S12 is in flight on v1.0.0. */
export function makeConfigs(merchants: Merchant[], now: Date): Record<string, ConfigRecord> {
  const out: Record<string, ConfigRecord> = {}
  for (const m of merchants) {
    const base = (version: string, deployedAt: Date, loose: boolean): MerchantConfig => ({
      merchantId: m.merchantId,
      version,
      state: 'DEPLOYED',
      workflowVersion: m.workflowVersion,
      phases: CAPTURE_PHASES.map((phase) => {
        const d = DEFAULT_PHASE_THRESHOLDS[phase]
        return { phase, enabled: true, ...d, ...(loose ? { autoPass: d.autoPass - 5, autoReject: d.autoReject - 5 } : {}) }
      }),
      risk: m.workflowVersion === 'V4' ? { enabled: true, maxAllowedLevel: DEFAULT_RISK_MAX_ALLOWED } : undefined,
      claimTimeoutMin: DEFAULT_CLAIM_TIMEOUT_MIN,
      claimWarningMin: DEFAULT_CLAIM_WARNING_MIN,
      updatedAt: deployedAt.toISOString(),
      updatedBy: { userId: 'USR-2026-0001', fullName: 'Lim Wei Jie' },
      deployedAt: deployedAt.toISOString(),
    })
    const v100 = base('v1.0.0', new Date(now.getTime() - 120 * DAY), true)
    const v110 = base('v1.1.0', new Date(now.getTime() - (m.merchantId === 'MER-0001' ? 2 * HOUR : 30 * DAY)), false)
    out[m.merchantId] = { deployed: v110, history: [v100, v110] }
  }
  return out
}

/** The config version that was live when a session started (DEC-52). */
export function configAt(rec: ConfigRecord, when: string | Date): MerchantConfig {
  const t = new Date(when).getTime()
  const live = rec.history.filter((c) => Date.parse(c.deployedAt!) <= t)
  return live.at(-1) ?? rec.history[0]
}

const CHECK_METRIC: Record<Check, string> = { FACE_MATCH: 'Face Similarity', LIVENESS: 'Liveness Score' }

/** Display-only scores for the current Detail screen: the last score per check against the revision's thresholds. */
function metricsFor(ev: CaseEvaluation, risk: { score: number; level: RiskLevel; maxAllowed: RiskLevel } | undefined): PhaseMetric[] {
  const out: PhaseMetric[] = []
  for (const c of ev.checks) {
    if (c.lastScore === undefined) continue
    const r = c.lastScore >= c.thresholds.autoPass ? 'PASS' : c.lastScore < c.thresholds.autoReject ? 'FAIL' : 'REVIEW'
    out.push({ phase: c.check, name: CHECK_METRIC[c.check], detected: c.lastScore, threshold: `Pass ≥ ${c.thresholds.autoPass} · Reject < ${c.thresholds.autoReject}`, result: r })
  }
  if (risk) {
    const passes = RISK_LEVELS.indexOf(risk.level) <= RISK_LEVELS.indexOf(risk.maxAllowed)
    out.push({ phase: 'RISK_ASSESSMENT', name: 'Risk Score', detected: risk.score, threshold: `Max allowed level: ${risk.maxAllowed}`, result: passes ? 'PASS' : 'REVIEW' })
    out.push({ phase: 'RISK_ASSESSMENT', name: 'Risk Level', detected: risk.level, result: passes ? 'PASS' : 'REVIEW' })
  }
  return out
}

export interface CaseSpec {
  referenceNo: string
  merchant: Merchant
  merchantConfigs: ConfigRecord // legacy: only for `configVersion` on the current screens
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

  // Legacy attempts: one per submission round (liveness, or selfie for V1), so the current screens and KPIs still work.
  const step = (spec.stepMin ?? 6) * 60_000
  const rounds = Math.max(0, ...Object.values(spec.submissions).map((s) => s?.length ?? 0))
  const at = (i: number) => new Date(spec.startedAt.getTime() + i * step).toISOString()
  const attempts: Attempt[] =
    rounds === 0
      ? [{ attemptNo: 1, phase: 'DOCUMENT', startedAt: at(0), outcome: spec.abandoned ?? 'ABORTED', isUserRetake: false, phaseScores: {} }]
      : Array.from({ length: rounds }, (_, i) => {
          // Fixed passing document/selfie scores keep the legacy eKYC Workflow what-if meaningful until Phase 9 retires it.
          const scores: Attempt['phaseScores'] = { DOCUMENT: 94.2, SELFIE: 91.8 }
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
    merchantId: spec.merchant.merchantId,
    workflowVersion: spec.flow.workflowVersion as WorkflowVersion,
    configVersion: configAt(spec.merchantConfigs, spec.startedAt).version,
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
    metrics: metricsFor(ev, riskRan ? { score: spec.riskScore!, level: riskLevel!, maxAllowed: rev.settings.risk!.maxAllowedLevel } : undefined),
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

/** First config for a merchant created in UAM: defaults, v1.0.0, deployed now. */
export function initialConfig(merchant: Merchant, now: Date, by: { userId: string; fullName: string }): MerchantConfig {
  return {
    merchantId: merchant.merchantId,
    version: 'v1.0.0',
    state: 'DEPLOYED',
    workflowVersion: merchant.workflowVersion,
    phases: CAPTURE_PHASES.map((phase) => ({ phase, enabled: true, ...DEFAULT_PHASE_THRESHOLDS[phase] })),
    risk: merchant.workflowVersion === 'V4' ? { enabled: true, maxAllowedLevel: DEFAULT_RISK_MAX_ALLOWED } : undefined,
    claimTimeoutMin: DEFAULT_CLAIM_TIMEOUT_MIN,
    claimWarningMin: DEFAULT_CLAIM_WARNING_MIN,
    updatedAt: now.toISOString(),
    updatedBy: by,
    deployedAt: now.toISOString(),
  }
}

/** Mock secret: never a real key. */
export function mockSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return `sk_mock_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

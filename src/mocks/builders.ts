// Shared builders for seeded and hand-written records. Status is always computed by deriveStatus, never random.
import { DEFAULT_CLAIM_TIMEOUT_MIN, DEFAULT_CLAIM_WARNING_MIN, DEFAULT_PHASE_THRESHOLDS, DEFAULT_RISK_MAX_ALLOWED, riskLevelFromScore } from '@/domain/openQuestions'
import { deriveStatus, derivePhaseResult, riskPasses, thresholdLabel } from '@/domain/statusRules'
import {
  CAPTURE_PHASES,
  type Attempt,
  type CapturePhase,
  type ClientMetadata,
  type Merchant,
  type MerchantConfig,
  type MetricResult,
  type PhaseMetric,
  type Verification,
} from '@/domain/types'
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

const toMetric = (r: ReturnType<typeof derivePhaseResult>): MetricResult => (r === 'REJECT' ? 'FAIL' : r)

const PRIMARY_METRIC: Record<CapturePhase, string> = {
  DOCUMENT: 'Document Authenticity',
  SELFIE: 'Image Quality',
  FACE_MATCH: 'Face Similarity',
  LIVENESS: 'Liveness Score',
}

/** Display-only metrics grouped by phase (DEC-10), from the last attempt's scores. */
export function metricsFor(attempt: Attempt | undefined, cfg: MerchantConfig, risk?: { score: number; level: Verification['riskLevel'] }): PhaseMetric[] {
  const out: PhaseMetric[] = []
  if (!attempt) return out
  for (const p of cfg.phases) {
    const score = attempt.phaseScores[p.phase]
    if (score === undefined) continue
    const result = toMetric(derivePhaseResult(score, p))
    out.push({ phase: p.phase, name: PRIMARY_METRIC[p.phase], detected: score, threshold: thresholdLabel(p), result })
    const ok = result !== 'FAIL'
    if (p.phase === 'DOCUMENT') {
      out.push({ phase: p.phase, name: 'OCR Confidence', detected: Math.min(99.9, Math.round((score + 3.2) * 10) / 10), result: 'PASS' })
      out.push({ phase: p.phase, name: 'Tamper Detection', detected: ok ? 'Not detected' : 'Suspected', result: ok ? 'PASS' : 'FAIL' })
    }
    if (p.phase === 'SELFIE') out.push({ phase: p.phase, name: 'Face Detected', detected: 'Yes', result: 'PASS' })
    if (p.phase === 'LIVENESS') {
      out.push({ phase: p.phase, name: 'Spoof Detection', detected: ok ? 'Not detected' : 'Suspected', result: ok ? 'PASS' : 'FAIL' })
    }
  }
  if (risk && cfg.risk?.enabled) {
    const passes = riskPasses({ riskLevel: risk.level }, cfg)
    out.push({ phase: 'RISK_ASSESSMENT', name: 'Risk Score', detected: risk.score, threshold: `Max allowed level: ${cfg.risk.maxAllowedLevel}`, result: passes ? 'PASS' : 'REVIEW' })
    out.push({ phase: 'RISK_ASSESSMENT', name: 'Risk Level', detected: risk.level!, result: passes ? 'PASS' : 'REVIEW' })
  }
  return out
}

export interface BuildSpec {
  referenceNo: string
  merchant: Merchant
  configs: ConfigRecord
  person: Person
  metadata: ClientMetadata
  attempts: Attempt[]
  riskScore?: number // V4: engine output, only used when the last attempt completed
}

/** Builds a record in its SYSTEM-assigned state. Manual decisions and claims are applied afterwards. */
export function buildVerification(spec: BuildSpec): Verification {
  const cfg = configAt(spec.configs, spec.attempts[0].startedAt)
  const last = spec.attempts.at(-1)!
  const hasRisk = cfg.workflowVersion === 'V4' && last.outcome === 'COMPLETED' && spec.riskScore !== undefined
  const riskLevel = hasRisk ? riskLevelFromScore(spec.riskScore!) : undefined
  const derived = deriveStatus({ attempts: spec.attempts, riskLevel }, cfg)
  // REQ: DEC-03 — lastUpdatedAt only moves on status change: PROCESSING was set when the user entered the flow.
  const lastUpdatedAt =
    derived.status === 'PROCESSING' ? spec.attempts[0].startedAt : new Date(Date.parse(last.startedAt) + 3 * 60_000).toISOString()
  const passport = spec.person.documentType === 'PASSPORT'
  return {
    referenceNo: spec.referenceNo,
    merchantId: spec.merchant.merchantId,
    workflowVersion: cfg.workflowVersion,
    configVersion: cfg.version,
    status: derived.status,
    statusReason: derived.reason,
    lastUpdatedBy: { kind: 'SYSTEM' },
    lastUpdatedAt,
    attempts: spec.attempts,
    riskLevel,
    riskScore: hasRisk ? spec.riskScore : undefined,
    documentType: spec.person.documentType,
    pii: spec.person.pii,
    clientMetadata: spec.metadata,
    metrics: metricsFor(last, cfg, hasRisk ? { score: spec.riskScore!, level: riskLevel } : undefined),
    images: { docFront: passport ? '/mock/passport.svg' : '/mock/mykad-front.svg', selfie: '/mock/selfie.svg' },
    charged: true,
  }
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

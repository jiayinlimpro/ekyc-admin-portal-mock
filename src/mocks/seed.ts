// Deterministic seed (MOCK-05): same `now` → same data. Background volume + the named scenarios in fixtures/edgeCases.ts.
import { Faker, en } from '@faker-js/faker'
import { makeAudit } from '@/domain/audit'
import { applyDecision } from '@/domain/claimRules'
import { REASON_CODES } from '@/domain/openQuestions'
import { REASONS } from '@/domain/statusRules'
import { CAPTURE_PHASES, type ApiCredential, type Attempt, type UserRecord, type AuditEntry, type CapturePhase, type Flow, type FlowRevision, type Merchant, type MerchantConfig, type PhaseConfig, type Project, type RegistryEntry, type UserAccount, type Verification } from '@/domain/types'
import { buildVerification, configAt, makeConfigs, refNo, type ConfigRecord } from './builders'
import { buildEdgeCases } from './fixtures/edgeCases'
import { MERCHANT_WEIGHTS, MERCHANTS } from './fixtures/merchants'
import { buildCatalog } from './fixtures/catalog'
import { USERS, buildAccounts } from './fixtures/users'
import { clientMetadata, fakeIp, person } from './malaysia'

export const SEED = 2026
export const BACKGROUND_COUNT = 300
/** Bump when the shape of MockDbState changes: persisted demo data is then re-seeded. */
export const DB_VERSION = 3

export interface MockDbState {
  dbVersion: number
  seededAt: string
  merchants: Merchant[]
  users: UserRecord[]
  apiKeys: Record<string, ApiCredential>
  configs: Record<string, ConfigRecord>
  verifications: Verification[]
  audit: AuditEntry[] // append-only, oldest first
  auditSeq: number
  // Projects & Flows model (DEC-90 …). Read by services from Phase 4; the merchant-level data above stays until then.
  registry: RegistryEntry[]
  projects: Project[]
  flows: Flow[]
  flowRevisions: FlowRevision[]
  accounts: UserAccount[]
}

type Band = 'PASS' | 'REVIEW' | 'REJECT'
type Profile = 'CLEAN' | 'REVIEW' | 'REJECT' | 'PROCESSING' | 'LIMIT' | 'RETAKE_THEN_CLEAN'

const MIN = 60_000
const DAY = 24 * 60 * MIN

function score(f: Faker, band: Band, p: PhaseConfig): number {
  const r = (min: number, max: number) => f.number.float({ min, max, fractionDigits: 1 })
  if (band === 'PASS') return r(p.autoPass, 99.9)
  if (band === 'REVIEW') return r(p.autoReject, p.autoPass - 0.1)
  return r(Math.max(0, p.autoReject - 30), p.autoReject - 0.1)
}

function scores(f: Faker, cfg: MerchantConfig, phases: readonly CapturePhase[], override?: { phase: CapturePhase; band: Band }) {
  const out: Attempt['phaseScores'] = {}
  for (const phase of phases) {
    const p = cfg.phases.find((c) => c.phase === phase)!
    out[phase] = score(f, override?.phase === phase ? override.band : 'PASS', p)
  }
  return out
}

const phasesBefore = (phase: CapturePhase) => CAPTURE_PHASES.slice(0, CAPTURE_PHASES.indexOf(phase))

function attemptsFor(f: Faker, profile: Profile, cfg: MerchantConfig, start: Date): Attempt[] {
  const maxFor = (phase: CapturePhase) => cfg.phases.find((p) => p.phase === phase)!.maxAttempts
  let t = start.getTime()
  const next = () => {
    const at = new Date(t).toISOString()
    t += f.number.int({ min: 3, max: 15 }) * MIN
    return at
  }
  const done = (attemptNo: number, override?: { phase: CapturePhase; band: Band }): Attempt => ({
    attemptNo,
    phase: 'LIVENESS',
    startedAt: next(),
    outcome: 'COMPLETED',
    isUserRetake: attemptNo > 1,
    phaseScores: scores(f, cfg, CAPTURE_PHASES, override),
  })
  const stop = (attemptNo: number, phase: CapturePhase, outcome: Attempt['outcome']): Attempt => ({
    attemptNo,
    phase,
    startedAt: next(),
    outcome,
    isUserRetake: attemptNo > 1,
    phaseScores: {
      ...scores(f, cfg, phasesBefore(phase)),
      ...(outcome === 'FAILED_RETAKE' ? { [phase]: score(f, 'REJECT', cfg.phases.find((p) => p.phase === phase)!) } : {}),
    },
  })

  switch (profile) {
    case 'CLEAN':
      return [done(1)]
    case 'REVIEW':
    case 'REJECT':
      return [done(1, { phase: f.helpers.arrayElement(CAPTURE_PHASES), band: profile })]
    case 'PROCESSING': {
      const phase = f.helpers.arrayElement(CAPTURE_PHASES)
      const n = f.number.int({ min: 1, max: maxFor(phase) - 1 })
      const outcome = f.helpers.arrayElement(['ABORTED', 'TIMED_OUT', 'FAILED_RETAKE'] as const)
      return Array.from({ length: n }, (_, i) => stop(i + 1, phase, i === n - 1 ? outcome : 'FAILED_RETAKE'))
    }
    case 'LIMIT': {
      const phase = f.helpers.arrayElement(['SELFIE', 'FACE_MATCH', 'LIVENESS'] as const)
      return Array.from({ length: maxFor(phase) }, (_, i) => stop(i + 1, phase, 'FAILED_RETAKE'))
    }
    case 'RETAKE_THEN_CLEAN': {
      const k = f.number.int({ min: 1, max: maxFor('LIVENESS') - 1 })
      return [...Array.from({ length: k }, (_, i) => stop(i + 1, 'LIVENESS', 'FAILED_RETAKE')), done(k + 1)]
    }
  }
}

function riskScore(f: Faker): number {
  const band = f.helpers.weightedArrayElement([
    { value: [0, 39], weight: 65 },
    { value: [40, 69], weight: 22 },
    { value: [70, 99], weight: 13 },
  ])
  return f.number.int({ min: band[0], max: band[1] })
}

function decisionFor(f: Faker, reason: string | undefined) {
  const approveChance = reason === REASONS.BETWEEN_THRESHOLDS ? 0.7 : reason === REASONS.RISK_NOT_PASSED ? 0.5 : 0.4
  const approve = f.number.float({ min: 0, max: 1 }) < approveChance
  const r = f.helpers.arrayElement(approve ? REASON_CODES.APPROVE : REASON_CODES.REJECT)
  return {
    decision: { outcome: approve ? ('APPROVE' as const) : ('REJECT' as const), reasonCode: r.code, comment: approve ? 'Checked document and selfie manually; consistent.' : 'Inconsistencies found during manual review.' },
    label: r.label,
  }
}

export function seedDatabase(now: Date): MockDbState {
  const f = new Faker({ locale: [en] })
  f.seed(SEED)
  const configs = makeConfigs(MERCHANTS, now)
  const audit: AuditEntry[] = []
  const reviewersOf = (merchantId: string) => USERS.filter((u) => u.merchantId === merchantId)
  const admin = USERS.find((u) => u.role === 'PLATFORM_ADMIN')!

  // Config deployment history.
  for (const rec of Object.values(configs)) {
    rec.history.forEach((c, i) =>
      audit.push(
        makeAudit({
          id: '',
          now: new Date(c.deployedAt!),
          action: 'CONFIG_DEPLOY',
          actor: admin,
          ip: fakeIp(f),
          merchantId: c.merchantId,
          details: { fromVersion: i === 0 ? null : rec.history[i - 1].version, toVersion: c.version, changes: [] },
        }),
      ),
    )
  }

  // Session start times first, sorted, so Reference Nos increase with time.
  const starts = Array.from({ length: BACKGROUND_COUNT }, () => {
    const daysAgo = Math.floor(f.number.float({ min: 0, max: 1 }) ** 2 * 90) // skewed towards recent
    return { daysAgo, minutesAgo: f.number.int({ min: 60, max: 900 }) }
  }).sort((a, b) => b.daysAgo * 1440 + b.minutesAgo - (a.daysAgo * 1440 + a.minutesAgo))

  const verifications: Verification[] = starts.map((s, i) => {
    const merchant = f.helpers.weightedArrayElement(MERCHANTS.filter((m) => MERCHANT_WEIGHTS[m.merchantId]).map((m) => ({ value: m, weight: MERCHANT_WEIGHTS[m.merchantId] })))
    let profile = f.helpers.weightedArrayElement<Profile>([
      { value: 'CLEAN', weight: 55 },
      { value: 'REVIEW', weight: 15 },
      { value: 'REJECT', weight: 10 },
      { value: 'PROCESSING', weight: 10 },
      { value: 'LIMIT', weight: 5 },
      { value: 'RETAKE_THEN_CLEAN', weight: 5 },
    ])
    if (profile === 'PROCESSING' && s.daysAgo > 2) profile = 'CLEAN' // in-flight sessions are recent
    const start = new Date(now.getTime() - s.daysAgo * DAY - s.minutesAgo * MIN)
    const cfg = configAt(configs[merchant.merchantId], start)
    const p = person(f, now, f.number.int({ min: 1, max: 100 }) <= 8 ? 'PASSPORT' : 'MYKAD')
    return buildVerification({
      referenceNo: refNo(start, i + 1),
      merchant,
      configs: configs[merchant.merchantId],
      person: p,
      metadata: clientMetadata(f, p.city),
      attempts: attemptsFor(f, profile, cfg, start),
      riskScore: merchant.workflowVersion === 'V4' ? riskScore(f) : undefined,
    })
  })

  // Manual decisions on older reviews; active claims on some of the rest.
  for (let i = 0; i < verifications.length; i++) {
    const v = verifications[i]
    if (v.status !== 'PENDING_REVIEW') continue
    const reviewers = reviewersOf(v.merchantId)
    const actor = f.number.int({ min: 1, max: 10 }) === 1 ? admin : f.helpers.arrayElement(reviewers)
    const cfg = configs[v.merchantId].deployed
    const age = now.getTime() - Date.parse(v.lastUpdatedAt)
    const ip = fakeIp(f)
    const ref = { merchantId: v.merchantId, referenceNo: v.referenceNo, ip }

    if (age > DAY && f.number.float({ min: 0, max: 1 }) < 0.7) {
      const decidedAt = new Date(Math.min(Date.parse(v.lastUpdatedAt) + f.number.int({ min: 30, max: 2880 }) * MIN, now.getTime() - 10 * MIN))
      const { decision, label } = decisionFor(f, v.statusReason)
      audit.push(makeAudit({ id: '', now: new Date(decidedAt.getTime() - 4 * MIN), action: 'PII_VIEW', actor, ...ref }))
      audit.push(makeAudit({ id: '', now: new Date(decidedAt.getTime() - 3 * MIN), action: 'CLAIM', actor, ...ref }))
      audit.push(makeAudit({ id: '', now: decidedAt, action: 'DECISION', actor, ...ref, details: { ...decision, fromStatus: v.status, toStatus: decision.outcome === 'APPROVE' ? 'APPROVED' : 'REJECTED' } }))
      verifications[i] = applyDecision(v, actor, decision, label, decidedAt)
    } else if (f.number.float({ min: 0, max: 1 }) < 0.2) {
      const claimedAt = new Date(now.getTime() - f.number.int({ min: 1, max: cfg.claimTimeoutMin - 1 }) * MIN)
      if (claimedAt.getTime() <= Date.parse(v.lastUpdatedAt)) continue
      const claimExpiresAt = new Date(claimedAt.getTime() + cfg.claimTimeoutMin * MIN).toISOString()
      audit.push(makeAudit({ id: '', now: new Date(claimedAt.getTime() - MIN), action: 'PII_VIEW', actor, ...ref }))
      audit.push(makeAudit({ id: '', now: claimedAt, action: 'CLAIM', actor, ...ref, details: { claimExpiresAt } }))
      verifications[i] = { ...v, claimedBy: { userId: actor.userId, fullName: actor.fullName }, claimedAt: claimedAt.toISOString(), claimExpiresAt }
    }
  }

  // API keys: Atoz rotated once, 7 days ago (its key is _02).
  const apiKeys: Record<string, ApiCredential> = {}
  for (const m of MERCHANTS) {
    const rotated = m.merchantId === 'MER-0001'
    apiKeys[m.merchantId] = {
      merchantId: m.merchantId,
      keyId: `key_mock_${m.merchantId.toLowerCase()}_${rotated ? '02' : '01'}`,
      secret: `sk_mock_${f.string.hexadecimal({ length: 32, casing: 'lower', prefix: '' })}`,
      createdAt: new Date(now.getTime() - (rotated ? 7 : 120) * DAY).toISOString(),
      createdBy: admin.fullName,
    }
  }
  audit.push(makeAudit({ id: '', now: new Date(now.getTime() - 7 * DAY), action: 'CREDENTIAL_ROTATION', actor: admin, ip: fakeIp(f), merchantId: 'MER-0001', details: { fromKeyId: 'key_mock_mer-0001_01', keyId: 'key_mock_mer-0001_02' } }))

  const edge = buildEdgeCases({ now, merchants: MERCHANTS, configs })
  const allAudit = [...audit, ...edge.audit].sort((a, b) => a.at.localeCompare(b.at)).map((e, i) => ({ ...e, id: `AUD-${String(i + 1).padStart(6, '0')}` }))

  return {
    dbVersion: DB_VERSION,
    seededAt: now.toISOString(),
    merchants: MERCHANTS,
    users: USERS.map((u) => ({ ...u, active: true, createdAt: new Date(now.getTime() - 150 * DAY).toISOString() })),
    apiKeys,
    configs,
    verifications: [...verifications, ...edge.verifications],
    audit: allAudit,
    auditSeq: allAudit.length,
    ...buildCatalog(now),
    accounts: buildAccounts(now),
  }
}

// Deterministic seed (MOCK-05): same `now` → same data. Background volume + the named scenarios in fixtures/edgeCases.ts.
import { Faker, en } from '@faker-js/faker'
import { canInProject, roleInProject } from '@/domain/access'
import { makeAudit } from '@/domain/audit'
import { RISK_NOT_PASSED } from '@/domain/checkRules'
import { applyDecision } from '@/domain/claimRules'
import { CONDITIONS, REJECT_REASONS } from '@/domain/conditions'
import { resolveThreshold, type Thresholds } from '@/domain/thresholds'
import type { Actor, ApiCredential, AuditEntry, Check, Decision, Flow, FlowRevision, Merchant, Project, RegistryEntry, UserAccount, UserRecord, Verification } from '@/domain/types'
import { buildCase, makeConfigs, refNo, type ConfigRecord } from './builders'
import { buildCatalog, revisionAt } from './fixtures/catalog'
import { buildEdgeCases } from './fixtures/edgeCases'
import { MERCHANTS } from './fixtures/merchants'
import { buildAccounts, legacyActor } from './fixtures/users'
import { clientMetadata, fakeIp, person } from './malaysia'

export const SEED = 2026
export const BACKGROUND_COUNT = 300
/** Bump when the shape of MockDbState changes: persisted demo data is then re-seeded. */
export const DB_VERSION = 6

export interface MockDbState {
  dbVersion: number
  seededAt: string
  merchants: Merchant[]
  users: UserRecord[] // legacy two-role view of `accounts`, for the UAM screens until Phase 11
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

type Profile = 'CLEAN' | 'RETAKE_THEN_CLEAN' | 'REVIEW' | 'REJECT' | 'ABANDONED' | 'RETRYING'

const MIN = 60_000
const DAY = 24 * 60 * MIN

/** Share of background cases per flow (DRAFT flows never get cases; INACTIVE ones only before they were retired). */
const FLOW_WEIGHTS: Record<string, number> = {
  'FLW-0001': 22, 'FLW-0002': 5, 'FLW-0004': 6, // Atoz: Default (2 flows) + SME app
  'FLW-0005': 20, // Vantage
  'FLW-0006': 16, 'FLW-0013': 4, // Tesla: 20 % share on the strict flow
  'FLW-0007': 12, 'FLW-0008': 3, // Boring: the Express pilot is retiring
  'FLW-0009': 8, 'FLW-0010': 5, 'FLW-0011': 2, // 3Nova: Default, Wallet app, archived Pilot 2025
}
const INACTIVE_BEFORE_DAYS = 60

function scoreIn(f: Faker, t: Thresholds, band: 'PASS' | 'REVIEW' | 'REJECT'): number {
  const r = (min: number, max: number) => f.number.float({ min, max, fractionDigits: 1 })
  if (band === 'PASS') return r(t.autoPass, 99.9)
  if (band === 'REVIEW') return r(t.autoReject, t.autoPass - 0.1)
  return r(Math.max(0, t.autoReject - 30), t.autoReject - 0.1)
}

/** Per-check submissions for a profile. V3/V4 score face match on every liveness submission, so both lists have the same length. */
function submissionsFor(f: Faker, profile: Profile, rev: FlowRevision, entry: RegistryEntry): Partial<Record<Check, number[]>> {
  const t = (c: Check) => resolveThreshold(c, rev.settings.checks[c].threshold)
  const retries = (c: Check) => rev.settings.checks[c].retriesAllowed
  const below = (c: Check) => scoreIn(f, t(c), f.helpers.arrayElement(['REVIEW', 'REJECT'] as const))
  const pass = (c: Check) => scoreIn(f, t(c), 'PASS')
  const paired = entry.faceMatchMethod === 'ID_VS_LIVENESS'
  const target = f.helpers.arrayElement(entry.configurableChecks)
  const other: Check = target === 'FACE_MATCH' ? 'LIVENESS' : 'FACE_MATCH'

  /** `n` submissions on the target check, ending with `last`; the other check passes (on every round when paired). */
  const build = (n: number, last: () => number, otherEmpty = false): Partial<Record<Check, number[]>> => {
    const main = [...Array.from({ length: n - 1 }, () => below(target)), last()]
    const others = otherEmpty ? [] : Array.from({ length: paired ? n : 1 }, () => pass(other))
    return { [target]: main, [other]: others }
  }

  switch (profile) {
    case 'CLEAN':
      return { FACE_MATCH: [pass('FACE_MATCH')], LIVENESS: [pass('LIVENESS')] }
    case 'RETAKE_THEN_CLEAN':
      return build(f.number.int({ min: 2, max: retries(target) + 1 }), () => pass(target))
    case 'REVIEW':
      return build(retries(target) + 1, () => scoreIn(f, t(target), 'REVIEW'))
    case 'REJECT': // a final reject ends the session: V1 never reaches liveness after a face match reject
      return build(retries(target) + 1, () => scoreIn(f, t(target), 'REJECT'), !paired && target === 'FACE_MATCH')
    case 'RETRYING':
      return build(f.number.int({ min: 1, max: retries(target) }), () => below(target), !paired && target === 'FACE_MATCH')
    case 'ABANDONED':
      return {}
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

// REQ: DEC-31 — a reviewer rejecting keeps the condition that sent the case to review; risk-only cases have no matching
// condition in the catalogue (OQ-26), so one is picked.
function decisionFor(f: Faker, reason: string | undefined): Decision {
  const approve = f.number.float({ min: 0, max: 1 }) < (reason === RISK_NOT_PASSED ? 0.5 : 0.6)
  const withNote = f.number.float({ min: 0, max: 1 }) < 0.5
  if (approve) return { outcome: 'APPROVE', note: withNote ? 'Checked document and liveness manually; consistent.' : undefined }
  const matching = CONDITIONS.find((c) => c.label === reason && REJECT_REASONS.includes(c))
  return { outcome: 'REJECT', reasonIds: [(matching ?? f.helpers.arrayElement(REJECT_REASONS)).id], note: withNote ? 'Inconsistencies found during manual review.' : undefined }
}

export function seedDatabase(now: Date): MockDbState {
  const f = new Faker({ locale: [en] })
  f.seed(SEED)
  const configs = makeConfigs(MERCHANTS, now)
  const catalog = buildCatalog(now)
  const audit: AuditEntry[] = []
  const accounts = buildAccounts(now)
  // REQ: DEC-70 — only active users who may claim in the case's project review it (Platform Admin never decides).
  const reviewersOf = (v: Verification): Actor[] =>
    accounts
      .filter((a) => a.status === 'ACTIVE' && canInProject(a, 'claimCase', { projectId: v.projectId, merchantId: v.merchantId }))
      .map(legacyActor)
  const roleOf = (a: Actor, v: Verification) => roleInProject(accounts.find((x) => x.userId === a.userId)!, v)
  const admin = legacyActor(accounts.find((a) => a.level === 'PLATFORM_ADMIN')!)
  const merchantOf = (id: string) => MERCHANTS.find((m) => m.merchantId === id)!
  const entryOf = (code: string) => catalog.registry.find((e) => e.code === code)!

  // Legacy config deployment history (current eKYC Workflow screen).
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
    const start = new Date(now.getTime() - s.daysAgo * DAY - s.minutesAgo * MIN)
    const eligible = catalog.flows.filter(
      (fl) => FLOW_WEIGHTS[fl.flowId] && Date.parse(fl.createdAt) <= start.getTime() && (fl.status !== 'INACTIVE' || s.daysAgo > INACTIVE_BEFORE_DAYS),
    )
    const flow = f.helpers.weightedArrayElement(eligible.map((fl) => ({ value: fl, weight: FLOW_WEIGHTS[fl.flowId] })))
    const entry = entryOf(flow.workflowVersion)
    const rev = revisionAt(catalog.flowRevisions, flow.flowId, start)!
    let profile = f.helpers.weightedArrayElement<Profile>([
      { value: 'CLEAN', weight: 55 },
      { value: 'RETAKE_THEN_CLEAN', weight: 8 },
      { value: 'REVIEW', weight: 15 },
      { value: 'REJECT', weight: 10 },
      { value: 'RETRYING', weight: 7 },
      { value: 'ABANDONED', weight: 5 },
    ])
    if ((profile === 'RETRYING' || profile === 'ABANDONED') && s.daysAgo > 2) profile = 'CLEAN' // in-flight sessions are recent
    const docs = rev.settings.acceptedDocuments
    const DOC_WEIGHT = { MYKAD: 85, PASSPORT: 8, DRIVING_LICENSE: 7 } as const
    const documentType = docs.length === 1 ? docs[0] : f.helpers.weightedArrayElement(docs.map((d) => ({ value: d, weight: DOC_WEIGHT[d] })))
    const p = person(f, now, documentType)
    return buildCase({
      referenceNo: refNo(start, i + 1),
      merchant: merchantOf(flow.merchantId),
      merchantConfigs: configs[flow.merchantId],
      flow,
      revisions: catalog.flowRevisions,
      entry,
      person: p,
      metadata: clientMetadata(f, p.city),
      startedAt: start,
      submissions: submissionsFor(f, profile, rev, entry),
      stepMin: f.number.int({ min: 3, max: 15 }),
      riskScore: riskScore(f),
      softRejects: f.helpers.weightedArrayElement([{ value: 0, weight: 70 }, { value: 1, weight: 20 }, { value: 2, weight: 10 }]),
      abandoned: f.helpers.arrayElement(['ABORTED', 'TIMED_OUT'] as const),
    })
  })

  // Manual decisions on older reviews; active claims on some of the rest.
  for (let i = 0; i < verifications.length; i++) {
    const v = verifications[i]
    if (v.status !== 'PENDING_REVIEW') continue
    const actor = f.helpers.arrayElement(reviewersOf(v))
    const timeoutMin = catalog.projects.find((p) => p.projectId === v.projectId)!.claimTimeoutMin // REQ: DEC-22
    const age = now.getTime() - Date.parse(v.lastUpdatedAt)
    const ip = fakeIp(f)
    const ref = { merchantId: v.merchantId, projectId: v.projectId, referenceNo: v.referenceNo, ip, actorRole: roleOf(actor, v) }

    if (age > DAY && f.number.float({ min: 0, max: 1 }) < 0.7) {
      const decidedAt = new Date(Math.min(Date.parse(v.lastUpdatedAt) + f.number.int({ min: 30, max: 2880 }) * MIN, now.getTime() - 10 * MIN))
      const decision = decisionFor(f, v.statusReason)
      audit.push(makeAudit({ id: '', now: new Date(decidedAt.getTime() - 4 * MIN), action: 'SENSITIVE_PII_VIEW', actor, ...ref }))
      audit.push(makeAudit({ id: '', now: new Date(decidedAt.getTime() - 3 * MIN), action: 'CASE_CLAIMED', actor, ...ref }))
      audit.push(makeAudit({ id: '', now: decidedAt, action: decision.outcome === 'APPROVE' ? 'CASE_DECISION_APPROVED' : 'CASE_DECISION_REJECTED', actor, ...ref, details: { ...decision, fromStatus: v.status, toStatus: decision.outcome === 'APPROVE' ? 'APPROVED' : 'REJECTED' } }))
      verifications[i] = applyDecision(v, actor, decision, decidedAt)
    } else if (f.number.float({ min: 0, max: 1 }) < 0.2) {
      const claimedAt = new Date(now.getTime() - f.number.int({ min: 1, max: timeoutMin - 1 }) * MIN)
      if (claimedAt.getTime() <= Date.parse(v.lastUpdatedAt)) continue
      const claimExpiresAt = new Date(claimedAt.getTime() + timeoutMin * MIN).toISOString()
      audit.push(makeAudit({ id: '', now: new Date(claimedAt.getTime() - MIN), action: 'SENSITIVE_PII_VIEW', actor, ...ref }))
      audit.push(makeAudit({ id: '', now: claimedAt, action: 'CASE_CLAIMED', actor, ...ref, details: { claimExpiresAt } }))
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
  audit.push(makeAudit({ id: '', now: new Date(now.getTime() - 7 * DAY), action: 'API_KEY_ROTATED', actor: admin, ip: fakeIp(f), merchantId: 'MER-0001', details: { fromKeyId: 'key_mock_mer-0001_01', keyId: 'key_mock_mer-0001_02' } }))

  const edge = buildEdgeCases({ now, merchants: MERCHANTS, configs, catalog })
  const allAudit = [...audit, ...edge.audit].sort((a, b) => a.at.localeCompare(b.at)).map((e, i) => ({ ...e, id: `AUD-${String(i + 1).padStart(6, '0')}` }))

  return {
    dbVersion: DB_VERSION,
    seededAt: now.toISOString(),
    merchants: MERCHANTS,
    users: accounts.map((a) => ({ ...legacyActor(a), active: a.status === 'ACTIVE', createdAt: a.invitedAt })),
    apiKeys,
    configs,
    verifications: [...verifications, ...edge.verifications],
    audit: allAudit,
    auditSeq: allAudit.length,
    ...catalog,
    accounts,
  }
}

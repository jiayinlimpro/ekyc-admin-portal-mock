// Deterministic seed (MOCK-05): same `now` → same data. Background volume + the named scenarios in fixtures/edgeCases.ts.
import { Faker, en } from '@faker-js/faker'
import { canInProject, roleNamesInProject } from '@/domain/access'
import { grantsOf } from '@/domain/roles'
import { makeAudit } from '@/domain/audit'
import { RISK_NOT_PASSED, retryPhaseOf } from '@/domain/checkRules'
import { applyDecision } from '@/domain/claimRules'
import { resolveThreshold, type Thresholds } from '@/domain/thresholds'
import type { Actor, AuditEntry, Check, Decision, Flow, ProjectApiKey, ProjectWebhook, FlowRevision, Merchant, Project, RegistryEntry, Role, UserAccount, Verification } from '@/domain/types'
import { buildCase, refNo } from './builders'
import { buildCatalog, revisionAt } from './fixtures/catalog'
import { buildEdgeCases } from './fixtures/edgeCases'
import { buildMerchants } from './fixtures/merchants'
import { actorOf, buildAccounts, buildRoles } from './fixtures/users'
import { clientMetadata, fakeIp, person } from './malaysia'
import { fx, stableId } from '@/lib/ids'

export const SEED = 2026
export const BACKGROUND_COUNT = 300
/** Bump when the shape of MockDbState changes: persisted demo data is then re-seeded. */
export const DB_VERSION = 27

export interface MockDbState {
  dbVersion: number
  seededAt: string
  merchants: Merchant[]
  verifications: Verification[]
  audit: AuditEntry[] // append-only, oldest first (the order breaks ties between equal times)
  // Projects & Flows (DEC-90 …)
  registry: RegistryEntry[]
  projects: Project[]
  flows: Flow[]
  flowRevisions: FlowRevision[]
  accounts: UserAccount[]
  roles: Role[] // REQ: DEC-76 — System Default (shared) and each merchant's Custom roles
  // REQ: DEC-54 — per-project integration (Project Settings › Integration).
  projectKeys: ProjectApiKey[]
  webhooks: ProjectWebhook[]
}

type Profile = 'CLEAN' | 'RETAKE_THEN_CLEAN' | 'REVIEW' | 'REJECT' | 'ABANDONED' | 'RETRYING'

const MIN = 60_000
const DAY = 24 * 60 * MIN

/** Share of background cases per flow (DRAFT flows never get cases; INACTIVE ones only before they were retired). */
const FLOW_WEIGHTS: Record<string, number> = {
  [fx('FLW-0001')]: 22, [fx('FLW-0002')]: 5, [fx('FLW-0014')]: 4, [fx('FLW-0004')]: 6, // Atoz: Default (3 flows, one V5) + SME app
  [fx('FLW-0005')]: 20, // Vantage
  [fx('FLW-0006')]: 16, [fx('FLW-0013')]: 4, // Tesla: 20 % share on the strict flow
  [fx('FLW-0007')]: 12, [fx('FLW-0008')]: 3, // Boring: the Express pilot is retiring
  [fx('FLW-0009')]: 8, [fx('FLW-0010')]: 5, [fx('FLW-0011')]: 2, // 3Nova: Default, Wallet app, archived Pilot 2025
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
  const retries = (c: Check) => rev.settings.retries[retryPhaseOf(c, entry.faceMatchMethod)] // REQ: DEC-108
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

// REQ: DEC-31 / DEC-106 — the reviewer's reason follows what sent the case to review (a System Default reason).
function decisionFor(f: Faker, reason: string | undefined): Decision {
  const approve = f.number.float({ min: 0, max: 1 }) < (reason === RISK_NOT_PASSED ? 0.5 : 0.6)
  const withNote = f.number.float({ min: 0, max: 1 }) < 0.5
  const [pass, fail] = reason === RISK_NOT_PASSED ? ['RISK_ACCEPTED', 'RISK_NOT_ACCEPTABLE'] : reason?.startsWith('Face not live') ? ['QUALITY_LOW_IDENTITY_CONFIRMED', 'SPOOF_SUSPECTED'] : ['FACE_CONFIRMED', 'FACE_MISMATCH']
  if (approve) return { outcome: 'APPROVE', reasonCodes: [pass], note: withNote ? 'Checked document and liveness manually; consistent.' : undefined }
  return { outcome: 'REJECT', reasonCodes: [fail], note: withNote ? 'Inconsistencies found during manual review.' : undefined }
}

/** The seeded production key of a project (one per project). */
const seededKeyId = (projectId: string) => stableId('key', `${projectId}:production`)

export function seedDatabase(now: Date): MockDbState {
  const f = new Faker({ locale: [en] })
  f.seed(SEED)
  const catalog = buildCatalog(now)
  const audit: AuditEntry[] = []
  const accounts = buildAccounts(now)
  const roles = buildRoles(now)
  const accessOf = (a: UserAccount) => ({ ...a, grants: grantsOf(a.assignments, roles) })
  // REQ: DEC-70 — seeded reviews are by the merchant's own active users who may claim there (Super admin could, DEC-75,
  // but the demo history is the merchant's).
  const reviewersOf = (v: Verification): Actor[] =>
    accounts
      .filter((a) => a.level === 'MERCHANT_USER' && a.status === 'ACTIVE' && canInProject(accessOf(a), 'claimCase', { projectId: v.projectId, merchantId: v.merchantId }))
      .map(actorOf)
  const roleOf = (a: Actor, v: Verification) => roleNamesInProject(accessOf(accounts.find((x) => x.userId === a.userId)!), v).join(', ')
  const entryOf = (code: string) => catalog.registry.find((e) => e.code === code)!

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
    const timeoutMin = catalog.projects.find((p) => p.projectId === v.projectId)!.claimTimeoutSec / 60 // REQ: DEC-22
    const age = now.getTime() - Date.parse(v.lastUpdatedAt)
    const ip = fakeIp(f)
    const ref = { merchantId: v.merchantId, projectId: v.projectId, caseId: v.caseId, referenceNo: v.referenceNo, ip, actorRole: roleOf(actor, v) }

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

  // Atoz Default's production key was rotated by the Merchant Owner a week ago (DEC-54).
  const owner = accounts.find((a) => a.userId === fx('USR-2026-0002'))!
  audit.push(
    makeAudit({ id: '', now: new Date(now.getTime() - 7 * DAY), action: 'API_KEY_ROTATED', actor: owner, actorRole: 'Merchant Owner', ip: fakeIp(f), merchantId: fx('MER-0001'), projectId: fx('PRJ-0001'), details: { keyId: seededKeyId(fx('PRJ-0001')) } }),
  )

  const edge = buildEdgeCases({ now, catalog })
  const allAudit = [...audit, ...edge.audit].sort((a, b) => a.at.localeCompare(b.at)).map((e, i) => ({ ...e, id: stableId('evt', String(i + 1)) }))

  return {
    dbVersion: DB_VERSION,
    seededAt: now.toISOString(),
    merchants: buildMerchants(now),
    verifications: [...verifications, ...edge.verifications],
    audit: allAudit,
    ...catalog,
    accounts,
    roles,
    // One production key per project (mock hints only, never real secrets); Atoz Default also has a webhook.
    projectKeys: catalog.projects.map((p) => ({
      keyId: seededKeyId(p.projectId),
      projectId: p.projectId,
      name: 'Production',
      secretHint: `sk_mock_…${f.string.hexadecimal({ length: 4, casing: 'lower', prefix: '' })}`,
      status: 'ACTIVE' as const,
      createdAt: p.createdAt,
      createdBy: p.createdBy,
      lastUsedAt: p.status === 'ACTIVE' ? new Date(now.getTime() - f.number.int({ min: 5, max: 600 }) * MIN).toISOString() : undefined,
    })),
    webhooks: [{ webhookId: stableId('whk', fx('PRJ-0001')), projectId: fx('PRJ-0001'), url: 'https://hooks.atoz.example/ekyc', events: ['verification.status_changed'], secretHint: 'whsec_mock_…a1b2', updatedAt: new Date(now.getTime() - 30 * DAY).toISOString(), updatedBy: 'Tan Mei Ling' }],
  }
}

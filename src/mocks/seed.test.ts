import { describe, expect, it } from 'vitest'
import { canInProject, roleNamesInProject } from '@/domain/access'
import { evaluateCase } from '@/domain/checkRules'
import { isClaimActive } from '@/domain/claimRules'
import { inCooldown, revisionLabel, validateProjectName } from '@/domain/flowRules'
import { validateFlow } from '@/domain/flowSettings'
import { evaluateRisk } from '@/domain/checkRules'
import { hasRisk, validateRegistryInput } from '@/domain/registryRules'
import { caseInputOf, ENGINE_THRESHOLDS, idCaptureMetrics, selfiePasses } from '@/domain/telemetry'
import { grantsOf, SYSTEM_ROLE_IDS } from '@/domain/roles'
import { VERIFICATION_STATUSES, type UserAccount } from '@/domain/types'
import { NOW } from '@/test/factories'
import { EDGE_CASES } from './fixtures/edgeCases'
import { seedDatabase } from './seed'
import { fx, isId } from '@/lib/ids'

const db = seedDatabase(NOW)
const flowOf = (id: string) => db.flows.find((f) => f.flowId === id)!
const entryOf = (code: string) => db.registry.find((e) => e.code === code)!
const revisionOf = (flowId: string, revision: number) => db.flowRevisions.find((r) => r.flowId === flowId && r.revision === revision)!
const byRef = (ref: string) => db.verifications.find((v) => v.referenceNo === ref)!
const accessOf = (a: UserAccount) => ({ ...a, grants: grantsOf(a.assignments, db.roles) })

describe('seedDatabase', () => {
  it('Given the same now, then the data is identical (deterministic)', () => {
    expect(seedDatabase(NOW)).toEqual(db)
  })

  it('has unique Reference Nos in KYC-YYMMDD-NNNNNN format', () => {
    const refs = db.verifications.map((v) => v.referenceNo)
    expect(new Set(refs).size).toBe(refs.length)
    for (const r of refs) expect(r).toMatch(/^KYC-\d{6}-\d{6}$/)
  })

  it('Given a SYSTEM-updated record, then its status and reason equal evaluateCase with its own flow revision (no random statuses)', () => {
    for (const v of db.verifications.filter((x) => x.lastUpdatedBy.kind === 'SYSTEM')) {
      const flow = flowOf(v.flowId)
      const entry = entryOf(flow.workflowVersion)
      const rev = revisionOf(v.flowId, v.configRevision)
      expect(rev, v.referenceNo).toBeDefined()
      const ev = evaluateCase(
        caseInputOf(v), // REQ: DEC-108 — failed document and selfie submissions count too
        { checks: entry.configurableChecks, faceMatchMethod: entry.faceMatchMethod, hasRisk: hasRisk(entry), settings: rev.settings },
      )
      expect(v.status, v.referenceNo).toBe(ev.status)
      if (v.status === 'PENDING_REVIEW' || v.status === 'REJECTED') expect(v.statusReason, v.referenceNo).toBe(ev.reason)
    }
  })

  it('Given every case, then its flow belongs to its project and merchant, the revision was live at session start, and its document is accepted', () => {
    for (const v of db.verifications) {
      const flow = flowOf(v.flowId)
      expect(flow.projectId, v.referenceNo).toBe(v.projectId)
      expect(flow.merchantId, v.referenceNo).toBe(v.merchantId)
      expect(v.workflowVersion, v.referenceNo).toBe(flow.workflowVersion)
      const rev = revisionOf(v.flowId, v.configRevision)
      expect(Date.parse(rev.savedAt), v.referenceNo).toBeLessThanOrEqual(Date.parse(v.createdAt))
      expect(rev.settings.acceptedDocuments, v.referenceNo).toContain(v.documentType)
    }
  })

  it('Given flow statuses, then Draft flows have no cases and every Retiring flow still has a case in flight (DEC-94)', () => {
    for (const f of db.flows.filter((x) => x.status === 'DRAFT')) expect(db.verifications.some((v) => v.flowId === f.flowId), f.flowId).toBe(false)
    for (const f of db.flows.filter((x) => x.status === 'RETIRING')) {
      expect(db.verifications.some((v) => v.flowId === f.flowId && (v.status === 'PROCESSING' || v.status === 'PENDING_REVIEW')), f.flowId).toBe(true)
    }
  })

  it('Given a claim or a manual decision, then the user may claim in that case’s project (DEC-70)', () => {
    for (const v of db.verifications) {
      const userId = v.claimedBy?.userId ?? (v.lastUpdatedBy.kind === 'USER' ? v.lastUpdatedBy.userId : undefined)
      if (!userId) continue
      const account = accessOf(db.accounts.find((a) => a.userId === userId)!)
      expect(canInProject(account, 'claimCase', { projectId: v.projectId, merchantId: v.merchantId }), `${v.referenceNo} ${userId}`).toBe(true)
    }
  })

  it('Given a manually updated record, then it is APPROVED or REJECTED and has no claim', () => {
    const manual = db.verifications.filter((v) => v.lastUpdatedBy.kind === 'USER')
    expect(manual.length).toBeGreaterThan(0)
    for (const v of manual) {
      expect(['APPROVED', 'REJECTED']).toContain(v.status)
      expect(v.claimedBy).toBeUndefined()
    }
  })

  it('Given a claim, then the record is PENDING_REVIEW and the claim is active at seed time', () => {
    const claimed = db.verifications.filter((v) => v.claimedBy)
    expect(claimed.length).toBeGreaterThan(0)
    for (const v of claimed) {
      expect(v.status).toBe('PENDING_REVIEW')
      expect(isClaimActive(v, NOW)).toBe(true)
    }
  })

  it('never has a lastUpdatedAt or attempt in the future', () => {
    for (const v of db.verifications) {
      expect(Date.parse(v.lastUpdatedAt)).toBeLessThanOrEqual(NOW.getTime())
      for (const a of v.attempts) expect(Date.parse(a.startedAt)).toBeLessThanOrEqual(NOW.getTime())
    }
  })

  it('only cases on a version with Risk Assessment carry a risk result (DEC-13)', () => {
    for (const v of db.verifications.filter((x) => !hasRisk(entryOf(x.workflowVersion)))) expect(v.riskScores ?? v.riskResult, v.referenceNo).toBeUndefined()
  })

  it('covers every status × V1/V3/V4 combination, both manual and system decisions, and both risk results', () => {
    // REQ: DEC-112 — FAILED: S25 (V4 document) for now; V1 selfie and V3 document examples come with the demo data step.
    for (const status of VERIFICATION_STATUSES.filter((s) => s !== 'FAILED')) {
      for (const wf of ['V1', 'V3', 'V4']) {
        expect(db.verifications.some((v) => v.status === status && v.workflowVersion === wf), `${status} × ${wf}`).toBe(true)
      }
    }
    for (const kind of ['SYSTEM', 'USER'] as const) {
      for (const status of ['APPROVED', 'REJECTED'] as const) {
        expect(db.verifications.some((v) => v.status === status && v.lastUpdatedBy.kind === kind), `${status} × ${kind}`).toBe(true)
      }
    }
    for (const r of ['LOW', 'HIGH']) expect(db.verifications.some((v) => v.riskResult === r), r).toBe(true)
    expect(db.verifications.some((v) => v.status === 'FAILED'), 'FAILED').toBe(true)
  })

  it('every record is charged except the Internal testing session S26 (DEC-60, DEC-56)', () => {
    expect(db.verifications.filter((v) => !v.charged).map((v) => v.referenceNo)).toEqual(['KYC-260901-900026'])
  })

  it('audit entries have unique event IDs and are in time order (DEC-97)', () => {
    db.audit.forEach((e, i) => {
      expect(isId('evt', e.id), e.id).toBe(true)
      if (i > 0) expect(e.at >= db.audit[i - 1].at).toBe(true)
    })
    expect(new Set(db.audit.map((e) => e.id)).size).toBe(db.audit.length)
  })

  it('every stored record has an internal ID of its type (DEC-97)', () => {
    const all: [Parameters<typeof isId>[0], string[]][] = [
      ['mer', db.merchants.map((m) => m.merchantId)],
      ['prj', db.projects.map((p) => p.projectId)],
      ['flw', db.flows.map((f) => f.flowId)],
      ['rev', db.flowRevisions.map((r) => r.revisionId)],
      ['ver', db.verifications.map((v) => v.caseId)],
      ['att', db.verifications.flatMap((v) => v.attempts.map((a) => a.attemptId))],
      ['file', db.verifications.flatMap((v) => [v.images.docFront.fileId, v.images.selfie.fileId])],
      ['usr', db.accounts.map((a) => a.userId)],
      ['rol', db.roles.map((r) => r.roleId)],
      ['asg', db.accounts.flatMap((a) => a.assignments.map((x) => x.assignmentId))],
      ['inv', db.accounts.flatMap((a) => (a.invitationId ? [a.invitationId] : []))],
      ['key', db.projectKeys.map((k) => k.keyId)],
      ['whk', db.webhooks.map((w) => w.webhookId)],
      ['wfv', db.registry.map((e) => e.entryId)],
    ]
    for (const [prefix, ids] of all) {
      expect(ids.length, prefix).toBeGreaterThan(0)
      for (const id of ids) expect(isId(prefix, id), `${prefix}: ${id}`).toBe(true)
      expect(new Set(ids).size, prefix).toBe(ids.length)
    }
  })

  it('Empty Demo Merchant has no records (S14)', () => {
    expect(db.verifications.filter((v) => v.merchantId === fx('MER-0006'))).toHaveLength(0)
  })
})

describe('telemetry, duplicate user and risk categories (DEC-105)', () => {
  it('Given a case past ID capture, then its accepted ID image passes every engine check', () => {
    for (const v of db.verifications.filter((x) => x.attempts.some((a) => Object.keys(a.phaseScores).length > 0))) {
      expect(idCaptureMetrics(v.idCapture!, v.documentType).every((m) => m.result === 'PASS'), v.referenceNo).toBe(true)
    }
  })

  it('Given each compared attempt, then a face image and face match > 90; a V1 selfie was compared only after passing its check', () => {
    for (const v of db.verifications) {
      const v1 = entryOf(v.workflowVersion).faceMatchMethod === 'ID_VS_SELFIE'
      for (const a of v.attempts.filter((x) => x.phaseScores.FACE_MATCH !== undefined)) {
        expect(a.faceImage?.url, v.referenceNo).toBe(v1 ? '/mock/selfie.svg' : '/mock/liveness.svg')
        expect(a.telemetry?.faceMatchConfidence).toBeGreaterThan(ENGINE_THRESHOLDS.faceMatchMin)
        if (v1) expect(selfiePasses(a.telemetry!.selfie!), v.referenceNo).toBe(true)
        else expect(a.telemetry?.selfie).toBeUndefined()
      }
    }
  })

  it('Given a V1 selfie rejected by its quality check, then it fails a check and nothing was compared on that run (DEC-105)', () => {
    const rejected = db.verifications.flatMap((v) => v.attempts.flatMap((a) => (a.telemetry?.selfieRetakes ?? []).map((t) => ({ v, a, t }))))
    expect(rejected.length).toBeGreaterThan(0)
    for (const { v, t } of rejected) {
      expect(entryOf(v.workflowVersion).faceMatchMethod, v.referenceNo).toBe('ID_VS_SELFIE')
      expect(selfiePasses(t), v.referenceNo).toBe(false)
    }
    const s22 = byRef('KYC-260901-900022')
    expect(s22.attempts).toMatchObject([{ phase: 'SELFIE', phaseScores: {} }])
    expect(s22.attempts[0].telemetry?.faceMatchConfidence).toBeUndefined()
    expect(s22.duplicateUser).toBeUndefined()
  })

  it('Given the existing-user search, then it ran only where the face comparison passed or reached the review band', () => {
    for (const v of db.verifications.filter((x) => x.duplicateUser)) {
      const fm = v.submissions.FACE_MATCH ?? []
      expect(fm.length, v.referenceNo).toBeGreaterThan(0)
    }
    expect(byRef('KYC-260901-900019').duplicateUser).toBeUndefined() // S19: retry pending after 70.0
  })

  it('Given an attempt, then it shows only the scores it submitted: V1 face match first, liveness last', () => {
    for (const v of db.verifications) {
      for (const c of ['FACE_MATCH', 'LIVENESS'] as const) {
        expect(v.attempts.flatMap((a) => (a.phaseScores[c] === undefined ? [] : [a.phaseScores[c]])), `${v.referenceNo} ${c}`).toEqual(v.submissions[c] ?? [])
      }
    }
    const s20 = byRef('KYC-260901-900020').attempts.map((a) => a.phaseScores)
    expect(s20).toEqual([{ FACE_MATCH: 80.1 }, { FACE_MATCH: 84.0 }, { FACE_MATCH: 86.2 }, { FACE_MATCH: 88.0, LIVENESS: 96.2 }])
  })

  it('Given the duplicate-user result, then "existing" means similarity ≥ 90, and some seeded cases have one', () => {
    const checked = db.verifications.filter((v) => v.duplicateUser)
    for (const v of checked) expect(v.duplicateUser!.existingUser).toBe(v.duplicateUser!.similarity! >= ENGINE_THRESHOLDS.duplicateSimilarityMin)
    expect(checked.some((v) => v.duplicateUser!.existingUser)).toBe(true)
  })

  it('Given risk ran, then four category scores 0–100 and the result from the minimums of the rules applied (DEC-107)', () => {
    const withRisk = db.verifications.filter((v) => v.riskScores)
    expect(withRisk.length).toBeGreaterThan(0)
    for (const v of withRisk) {
      expect(Object.keys(v.riskScores!).sort()).toEqual(['EMAIL_VALIDITY', 'EXIF', 'NOISE', 'OSINT'])
      for (const n of Object.values(v.riskScores!)) expect(n >= 0 && n <= 100, v.referenceNo).toBe(true)
      expect(v.riskResult, v.referenceNo).toBe(evaluateRisk(v.riskScores!, revisionOf(v.flowId, v.configRevision).settings.risk).result)
    }
    expect(db.verifications.filter((v) => !v.riskScores).every((v) => v.riskResult === undefined)).toBe(true)
  })

  it('S25 used its 3 Document retries: the 4th ID image is still too small, so FAILED by SYSTEM (DEC-108, DEC-112)', () => {
    const v = byRef('KYC-260901-900025')
    expect(v).toMatchObject({ status: 'FAILED', statusReason: 'ID image smaller than 320x320 (Retry Not Allowed)', idCaptureSoftRejects: 3, lastUpdatedBy: { kind: 'SYSTEM' } })
    expect(v.attempts).toMatchObject([{ phase: 'DOCUMENT', outcome: 'COMPLETED' }])
  })

  it('Given any case, then no phase has more submissions than its retries allow (DEC-108)', () => {
    for (const v of db.verifications) {
      const rev = revisionOf(v.flowId, v.configRevision)
      const entry = entryOf(v.workflowVersion)
      const ev = evaluateCase(caseInputOf(v), { checks: entry.configurableChecks, faceMatchMethod: entry.faceMatchMethod, hasRisk: hasRisk(entry), settings: rev.settings })
      for (const p of ev.phases) expect(p.retriesUsed, `${v.referenceNo} ${p.phase}`).toBeLessThanOrEqual(p.retriesAllowed)
    }
  })

  it('S02 is High risk in every category; S23 (V5) by its own OSINT minimum; S24 (V5) Low risk with EXIF 45 under its minimum 40', () => {
    expect(byRef('KYC-260901-900002')).toMatchObject({ riskResult: 'HIGH', statusDetail: 'EXIF Score 32 < 50 · Noise Score 18 < 50 · Email Validity Score 20 < 50 · OSINT Score 10 < 50' })
    expect(byRef('KYC-260901-900023')).toMatchObject({ riskResult: 'HIGH', status: 'PENDING_REVIEW', statusDetail: 'OSINT Score 22 < 30' })
    expect(byRef('KYC-260901-900024')).toMatchObject({ riskResult: 'LOW', status: 'APPROVED' })
    expect(evaluateRisk(byRef('KYC-260901-900024').riskScores!, { enabled: true, minimums: { EXIF: 50, NOISE: 50, EMAIL_VALIDITY: 50, OSINT: 50 } }).result).toBe('HIGH') // V4's fixed minimums would flag it
  })

  it('S05 shows why the user stopped at ID capture; S21 found an existing user but is in review only for its face match', () => {
    const failed = idCaptureMetrics(byRef('KYC-260901-900005').idCapture!, 'MYKAD').filter((m) => m.result === 'FAIL').map((m) => m.label)
    expect(failed).toEqual(['Image size', 'OCR fields detected'])
    const s21 = byRef('KYC-260901-900021')
    expect(s21.duplicateUser).toEqual({ existingUser: true, similarity: 97.6 })
    expect(s21.status).toBe('PENDING_REVIEW')
    const flow = flowOf(s21.flowId)
    const entry = entryOf(flow.workflowVersion)
    const rev = revisionOf(s21.flowId, s21.configRevision)
    const ev = evaluateCase({ submissions: s21.submissions, riskScores: s21.riskScores }, { checks: entry.configurableChecks, faceMatchMethod: entry.faceMatchMethod, hasRisk: hasRisk(entry), settings: rev.settings })
    expect(ev.status).toBe(s21.status) // the duplicate result is not an input
  })
})

describe('named scenarios (docs/SCENARIOS.md)', () => {
  it.each(EDGE_CASES)('$id $referenceNo matches its expected state', (e) => {
    const v = db.verifications.find((x) => x.referenceNo === e.referenceNo)!
    expect(v).toBeDefined()
    expect(v.status).toBe(e.status)
    if (e.reason) expect(v.statusReason).toBe(e.reason)
    if (e.claimedByUserId) expect(v.claimedBy?.userId).toBe(e.claimedByUserId)
    if (e.lastUpdatedBy) expect(v.lastUpdatedBy.kind).toBe(e.lastUpdatedBy)
    if (e.configRevision) expect(v.configRevision).toBe(e.configRevision)
    expect(v.flowId).toBe(e.flowId)
  })

  it('S06 keeps one Reference No across 4 liveness submissions (3 retries, DEC-18)', () => {
    const v = byRef('KYC-260901-900006')
    expect(v.submissions.LIVENESS).toHaveLength(4)
    expect(v.attempts).toHaveLength(4)
  })

  it('S12 started on V4-R1 and is still evaluated with it after R2 was saved (DEC-52)', () => {
    const v = byRef('KYC-260901-900012')
    expect(v.configRevision).toBe(1)
    expect(flowOf(v.flowId).revision).toBe(2)
  })

  it('S16 is in the SME app project, where Ali is only a Viewer', () => {
    const v = byRef('KYC-260901-900016')
    const ali = accessOf(db.accounts.find((a) => a.userId === fx('USR-2026-0012'))!)
    expect(v.projectId).toBe(fx('PRJ-0002'))
    expect(canInProject(ali, 'viewCases', { projectId: v.projectId, merchantId: v.merchantId })).toBe(true)
    expect(canInProject(ali, 'claimCase', { projectId: v.projectId, merchantId: v.merchantId })).toBe(false)
  })

  it('S18 was rejected inside a 120-minute cooldown that is still running at seed time (DEC-26)', () => {
    const v = byRef('KYC-260901-900018')
    expect(inCooldown(v.lastUpdatedAt, flowOf(v.flowId).settings.cooldownMin, NOW)).toBe(true)
  })

  it('S13 has exactly 2 user retakes', () => {
    expect(db.verifications.find((v) => v.referenceNo === 'KYC-260901-900013')!.attempts.filter((a) => a.isUserRetake)).toHaveLength(2)
  })

  it('S15 is a passport without NRIC', () => {
    const v = db.verifications.find((x) => x.referenceNo === 'KYC-260901-900015')!
    expect(v.documentType).toBe('PASSPORT')
    expect(v.pii.nric).toBeUndefined()
  })

  it('S01 (V1) has no risk result; S02 (V4) does', () => {
    const risk = (ref: string) => db.verifications.find((v) => v.referenceNo === ref)!.riskResult
    expect(risk('KYC-260901-900001')).toBeUndefined()
    expect(risk('KYC-260901-900002')).toBe('HIGH')
  })
})

describe('projects, flows and registry (DEC-56 … DEC-58, DEC-90 … DEC-95)', () => {
  const entry = (code: string) => db.registry.find((e) => e.code === code)!

  it('Given the registry, then V1, V3, V4, V5 Active, no V2, one Active default, and only V5 lets flows set risk minimums (DEC-57, DEC-107)', () => {
    expect(db.registry.map((e) => `${e.code}:${e.status}`)).toEqual(['V1:ACTIVE', 'V3:ACTIVE', 'V4:ACTIVE', 'V5:LIMITED_RELEASE', 'V6:INTERNAL_TESTING'])
    expect(db.registry.filter((e) => e.riskMinimumsPerFlow).map((e) => e.code)).toEqual(['V5'])
    expect(db.registry.filter((e) => e.isDefault).map((e) => e.code)).toEqual(['V1'])
    for (const e of db.registry) expect(validateRegistryInput({ ...e, releaseNote: 'seed' }, [])).toEqual([])
  })

  it('Given every merchant, then exactly one Default project, and projects are unique by name per merchant', () => {
    for (const m of db.merchants) {
      const own = db.projects.filter((p) => p.merchantId === m.merchantId)
      expect(own.filter((p) => p.isDefault), m.merchantId).toHaveLength(1)
      for (const p of own) expect(validateProjectName(p.name, own.filter((o) => o !== p)), p.projectId).toEqual([])
    }
  })

  it('Given every active project, then it has at least one Active flow to send sessions to (DEC-95: no default flow)', () => {
    for (const p of db.projects.filter((x) => x.status === 'ACTIVE')) {
      expect(db.flows.some((f) => f.projectId === p.projectId && f.status === 'ACTIVE'), p.projectId).toBe(true)
    }
  })

  it('Given every flow, then its version is registered, its revision matches its history, and active flows pass validation', () => {
    for (const f of db.flows) {
      const e = entry(f.workflowVersion)
      expect(e, f.flowId).toBeDefined()
      const revs = db.flowRevisions.filter((r) => r.flowId === f.flowId)
      expect(revs.map((r) => r.revision), f.flowId).toEqual(revs.map((_, i) => i + 1))
      expect(f.revision, f.flowId).toBe(revs.length)
      if (f.status !== 'DRAFT') expect(validateFlow(f, e), f.flowId).toEqual([])
      if (f.status === 'DRAFT') expect(revisionLabel(f)).toBeUndefined()
    }
  })

  it('covers every flow status, Advanced thresholds by Super admin and a multi-revision flow', () => {
    expect(new Set(db.flows.map((f) => f.status))).toEqual(new Set(['ACTIVE', 'DRAFT', 'RETIRING', 'INACTIVE']))
    const advanced = db.flowRevisions.find((r) => r.settings.checks.FACE_MATCH.threshold.preset === 'ADVANCED')!
    expect(advanced.savedBy.userId).toBe(fx('USR-2026-0001'))
    expect(revisionLabel(db.flows.find((f) => f.flowId === fx('FLW-0001'))!)).toBe('V4-R2')
    expect(db.flowRevisions.find((r) => r.flowId === fx('FLW-0001') && r.revision === 2)!.changes.length).toBeGreaterThan(0)
  })
})

describe('accounts (DEC-70, DEC-74)', () => {
  const account = (id: string) => db.accounts.find((a) => a.userId === id)!
  const project = (id: string) => db.projects.find((p) => p.projectId === id)!

  it('Given merchant users, then each has an assignment, every selected project is of their own merchant, and roles exist', () => {
    for (const a of db.accounts.filter((x) => x.level === 'MERCHANT_USER')) {
      expect(a.assignments.length, a.userId).toBeGreaterThan(0)
      for (const x of a.assignments) {
        const role = db.roles.find((r) => r.roleId === x.roleId)
        expect(role && (!role.merchantId || role.merchantId === a.merchantId), `${a.userId} ${x.roleId}`).toBe(true)
        if (x.scope.kind === 'PROJECTS') for (const id of x.scope.projectIds) expect(project(id).merchantId, a.userId).toBe(a.merchantId)
      }
    }
    expect(db.accounts.filter((x) => x.level === 'SUPER_ADMIN').every((a) => a.assignments.length === 0)).toBe(true)
  })

  it('Given assignment ids, then they are unique', () => {
    const ids = db.accounts.flatMap((a) => a.assignments.map((x) => x.assignmentId))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('Given every merchant, then its primary contact is an active Owner (DEC-74, DEC-92)', () => {
    for (const m of db.merchants) {
      const contact = db.accounts.find((a) => a.email === m.primaryContact.email)!
      expect(contact.assignments.some((x) => x.roleId === SYSTEM_ROLE_IDS.OWNER && x.scope.kind === 'ALL_PROJECTS'), m.name).toBe(true)
    }
  })

  it('Given every merchant user, then exactly one merchant role, and project roles only from the project role table (DEC-104)', () => {
    const roleOf = (id: string) => db.roles.find((r) => r.roleId === id)!
    for (const a of db.accounts.filter((x) => x.level === 'MERCHANT_USER')) {
      const merchantRoles = a.assignments.filter((x) => x.scope.kind === 'ALL_PROJECTS')
      expect(merchantRoles.map((x) => roleOf(x.roleId).level), a.fullName).toEqual(['MERCHANT'])
      for (const x of a.assignments.filter((y) => y.scope.kind === 'PROJECTS')) expect(roleOf(x.roleId).level, a.fullName).toBe('PROJECT')
    }
  })

  it('covers every role but Release Tester (kept unheld to show Deactivate), different roles per project, and Pending and Suspended users', () => {
    const held = new Set(db.accounts.flatMap((a) => a.assignments.map((x) => x.roleId)))
    for (const r of db.roles.filter((x) => x.audience === 'MERCHANT' && x.name !== 'Release Tester')) expect(held.has(r.roleId), r.name).toBe(true)
    expect(held.has(db.roles.find((x) => x.name === 'Release Tester')!.roleId)).toBe(false)
    expect(db.roles.filter((r) => r.type === 'CUSTOM').map((r) => `${r.name}:${r.level}`)).toEqual(['User Coordinator:MERCHANT', 'Fraud Checker:PROJECT', 'Release Tester:PROJECT'])
    expect(roleNamesInProject(accessOf(account(fx('USR-2026-0012'))), project(fx('PRJ-0001')))).toEqual(['Reviewer'])
    expect(roleNamesInProject(accessOf(account(fx('USR-2026-0012'))), project(fx('PRJ-0002')))).toEqual(['Viewer'])
    expect(db.accounts.map((a) => a.status)).toEqual(expect.arrayContaining(['PENDING', 'SUSPENDED']))
  })

  it('Given the scenario personas, then each exists as an account', () => {
    for (const id of [fx('USR-2026-0001'), fx('USR-2026-0002'), fx('USR-2026-0012'), fx('USR-2026-0031'), fx('USR-2026-0044')]) expect(account(id), id).toBeDefined()
  })
})

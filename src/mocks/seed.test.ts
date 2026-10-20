import { describe, expect, it } from 'vitest'
import { canInProject, roleInProject } from '@/domain/access'
import { evaluateCase } from '@/domain/checkRules'
import { isClaimActive } from '@/domain/claimRules'
import { inCooldown, revisionLabel, validateProjectName } from '@/domain/flowRules'
import { validateFlow } from '@/domain/flowSettings'
import { hasRisk, validateRegistryInput } from '@/domain/registryRules'
import { VERIFICATION_STATUSES } from '@/domain/types'
import { NOW } from '@/test/factories'
import { EDGE_CASES } from './fixtures/edgeCases'
import { seedDatabase } from './seed'

const db = seedDatabase(NOW)
const flowOf = (id: string) => db.flows.find((f) => f.flowId === id)!
const entryOf = (code: string) => db.registry.find((e) => e.code === code)!
const revisionOf = (flowId: string, revision: number) => db.flowRevisions.find((r) => r.flowId === flowId && r.revision === revision)!
const byRef = (ref: string) => db.verifications.find((v) => v.referenceNo === ref)!

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
        { submissions: v.submissions, riskLevel: v.riskLevel },
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
      const account = db.accounts.find((a) => a.userId === userId)!
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
    for (const v of db.verifications.filter((x) => !hasRisk(entryOf(x.workflowVersion)))) expect(v.riskLevel, v.referenceNo).toBeUndefined()
  })

  it('covers every status × V1/V3/V4 combination, both manual and system decisions, and all risk levels', () => {
    for (const status of VERIFICATION_STATUSES) {
      for (const wf of ['V1', 'V3', 'V4']) {
        expect(db.verifications.some((v) => v.status === status && v.workflowVersion === wf), `${status} × ${wf}`).toBe(true)
      }
    }
    for (const kind of ['SYSTEM', 'USER'] as const) {
      for (const status of ['APPROVED', 'REJECTED'] as const) {
        expect(db.verifications.some((v) => v.status === status && v.lastUpdatedBy.kind === kind), `${status} × ${kind}`).toBe(true)
      }
    }
    for (const lvl of ['LOW', 'MEDIUM', 'HIGH']) expect(db.verifications.some((v) => v.riskLevel === lvl), lvl).toBe(true)
  })

  it('every record is charged (DEC-60)', () => {
    expect(db.verifications.every((v) => v.charged === true)).toBe(true)
  })

  it('audit ids are sequential and entries are in time order', () => {
    db.audit.forEach((e, i) => {
      expect(e.id).toBe(`AUD-${String(i + 1).padStart(6, '0')}`)
      if (i > 0) expect(e.at >= db.audit[i - 1].at).toBe(true)
    })
    expect(db.auditSeq).toBe(db.audit.length)
  })

  it('Empty Demo Merchant has no records (S14)', () => {
    expect(db.verifications.filter((v) => v.merchantId === 'MER-0006')).toHaveLength(0)
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
    const ali = db.accounts.find((a) => a.userId === 'USR-2026-0012')!
    expect(v.projectId).toBe('PRJ-0002')
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
    const risk = (ref: string) => db.verifications.find((v) => v.referenceNo === ref)!.riskLevel
    expect(risk('KYC-260901-900001')).toBeUndefined()
    expect(risk('KYC-260901-900002')).toBe('HIGH')
  })
})

describe('projects, flows and registry (DEC-56 … DEC-58, DEC-90 … DEC-95)', () => {
  const entry = (code: string) => db.registry.find((e) => e.code === code)!

  it('Given the registry, then V1, V3, V4 Active, V5 Draft, no V2, and exactly one default which is Active (DEC-57)', () => {
    expect(db.registry.map((e) => `${e.code}:${e.status}`)).toEqual(['V1:ACTIVE', 'V3:ACTIVE', 'V4:ACTIVE', 'V5:DRAFT'])
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

  it('Given every project, then its default flow belongs to it; active projects default to an Active flow', () => {
    for (const p of db.projects) {
      const def = db.flows.find((f) => f.flowId === p.defaultFlowId)!
      expect(def.projectId, p.projectId).toBe(p.projectId)
      if (p.status === 'ACTIVE') expect(def.status, p.projectId).toBe('ACTIVE')
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

  it('covers every flow status, Advanced thresholds by Platform Admin, rule and share routing, and a multi-revision flow', () => {
    expect(new Set(db.flows.map((f) => f.status))).toEqual(new Set(['ACTIVE', 'DRAFT', 'RETIRING', 'INACTIVE']))
    const advanced = db.flowRevisions.find((r) => r.settings.checks.FACE_MATCH.threshold.preset === 'ADVANCED')!
    expect(advanced.savedBy.userId).toBe('USR-2026-0001')
    expect(db.flows.some((f) => f.routing.kind === 'RULE')).toBe(true)
    expect(db.flows.some((f) => f.routing.kind === 'SHARE')).toBe(true)
    expect(revisionLabel(db.flows.find((f) => f.flowId === 'FLW-0001')!)).toBe('V4-R2')
    expect(db.flowRevisions.find((r) => r.flowId === 'FLW-0001' && r.revision === 2)!.changes.length).toBeGreaterThan(0)
  })
})

describe('accounts (DEC-70, DEC-74)', () => {
  const account = (id: string) => db.accounts.find((a) => a.userId === id)!
  const project = (id: string) => db.projects.find((p) => p.projectId === id)!

  it('Given members, then every membership is a project of their own merchant, one role per project', () => {
    for (const a of db.accounts.filter((x) => x.level === 'MEMBER')) {
      expect(a.memberships.length, a.userId).toBeGreaterThan(0)
      expect(new Set(a.memberships.map((m) => m.projectId)).size, a.userId).toBe(a.memberships.length)
      for (const m of a.memberships) expect(project(m.projectId).merchantId, a.userId).toBe(a.merchantId)
    }
  })

  it('Given every merchant, then at least one Merchant Owner or Project Admin can manage it', () => {
    for (const m of db.merchants) {
      expect(db.accounts.some((a) => a.merchantId === m.merchantId && (a.level === 'MERCHANT_OWNER' || a.memberships.some((x) => x.role === 'PROJECT_ADMIN'))), m.merchantId).toBe(true)
    }
  })

  it('covers all five roles, different roles per project, and Invited and Deactivated users', () => {
    const roles = new Set(db.accounts.flatMap((a) => (a.level === 'MEMBER' ? a.memberships.map((m) => m.role) : [a.level])))
    expect(roles).toEqual(new Set(['PLATFORM_ADMIN', 'MERCHANT_OWNER', 'PROJECT_ADMIN', 'REVIEWER', 'VIEWER']))
    expect(roleInProject(account('USR-2026-0012'), project('PRJ-0001'))).toBe('REVIEWER')
    expect(roleInProject(account('USR-2026-0012'), project('PRJ-0002'))).toBe('VIEWER')
    expect(db.accounts.map((a) => a.status)).toEqual(expect.arrayContaining(['INVITED', 'DEACTIVATED']))
  })

  it('Given the scenario personas, then each exists as an account', () => {
    for (const id of ['USR-2026-0001', 'USR-2026-0002', 'USR-2026-0012', 'USR-2026-0031', 'USR-2026-0044']) expect(account(id), id).toBeDefined()
  })
})

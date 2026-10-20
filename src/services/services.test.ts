// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuditAction } from '@/domain/types'
import { ADMIN, ALI, EMPTY_OWNER, HAFIZ, NOW, NURUL, OTHER_MERCHANT_REVIEWER, OWNER, SITI, minutes } from '@/test/factories'
import { analyticsService } from './analyticsService'
import { auditService } from './auditService'
import { configService } from './configService'
import { devService } from './devService'
import { isServiceError } from './errors'
import { merchantService } from './merchantService'
import { verificationService as svc } from './verificationService'

const S = (n: number) => `KYC-260901-${900000 + n}`

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  await devService.resetDemoData()
})
afterEach(() => vi.useRealTimers())

async function auditFor(ref: string, actions?: AuditAction[]) {
  return (await auditService.list({ referenceNo: ref, actions, pageSize: 500 }, ADMIN)).items.map((e) => e.action).reverse()
}

async function expectError(p: Promise<unknown>, code: string, message?: string) {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  )
  expect(isServiceError(e), 'expected a ServiceError').toBe(true)
  expect(e).toMatchObject({ code, ...(message ? { message } : {}) })
}

describe('verificationService.list', () => {
  it('Given a list page, then rows contain no NRIC, passport, address or client metadata (DEC-40)', async () => {
    const page = await svc.list({ pageSize: 500 }, OWNER)
    expect(page.total).toBeGreaterThan(50)
    for (const row of page.items) {
      expect(Object.keys(row)).not.toEqual(expect.arrayContaining(['pii']))
      const json = JSON.stringify(row)
      for (const leak of ['nric', 'passportNo', 'address', 'clientMetadata', 'ip', 'dob']) expect(json).not.toContain(`"${leak}"`)
    }
  })

  it("Given a Reviewer, then only their projects are visible, even when another merchant's project is requested (DEC-72)", async () => {
    const own = await svc.list({ pageSize: 500 }, ALI)
    expect(own.items.every((r) => r.merchantId === 'MER-0001')).toBe(true)
    expect((await svc.list({ projectIds: ['PRJ-0003'] }, ALI)).total).toBe(0)
  })

  it('Given a list row, then it names its project and flow and carries Created (DEC-40)', async () => {
    const row = (await svc.list({ referenceNo: S(16) }, ALI)).items[0]
    expect(row).toMatchObject({ projectId: 'PRJ-0002', projectName: 'SME app', flowId: 'FLW-0004', flowName: 'SME director check', workflowVersion: 'V3' })
    expect(row.createdAt).toBe((await svc.get(S(16), ALI)).createdAt)
  })

  it('Given project, flow and version filters, then only matching rows', async () => {
    const sme = await svc.list({ projectIds: ['PRJ-0002'], pageSize: 500 }, ALI)
    expect(sme.total).toBeGreaterThan(0)
    expect(sme.items.every((r) => r.projectId === 'PRJ-0002')).toBe(true)
    const foreigner = await svc.list({ flowId: 'FLW-0002', pageSize: 500 }, ALI)
    expect(foreigner.items.every((r) => r.flowId === 'FLW-0002')).toBe(true)
    expect((await svc.list({ workflowVersion: 'V3', pageSize: 500 }, ALI)).items.every((r) => r.workflowVersion === 'V3')).toBe(true)
  })

  it('Given claim state filters, then unclaimed, mine and others split the active claims (DEC-43)', async () => {
    const mine = (await svc.list({ claim: 'MINE', pageSize: 500 }, ALI)).items
    expect(mine.map((r) => r.referenceNo)).toEqual(expect.arrayContaining([S(7), S(8)]))
    expect(mine.every((r) => r.claimedBy?.userId === ALI.userId)).toBe(true)
    const others = (await svc.list({ claim: 'OTHERS', pageSize: 500 }, ALI)).items
    expect(others.map((r) => r.referenceNo)).toContain(S(9))
    expect(others.every((r) => r.claimedBy && r.claimedBy.userId !== ALI.userId)).toBe(true)
    expect((await svc.list({ claim: 'UNCLAIMED', pageSize: 500 }, ALI)).items.every((r) => !r.claimedBy)).toBe(true)
  })

  it('Given no sort, then oldest Last updated first; NEWEST reverses it (DEC-43)', async () => {
    const oldest = (await svc.list({ statuses: ['PENDING_REVIEW'], pageSize: 500 }, ALI)).items.map((r) => r.lastUpdatedAt)
    expect(oldest).toEqual([...oldest].sort())
    const newest = (await svc.list({ statuses: ['PENDING_REVIEW'], sort: 'NEWEST', pageSize: 500 }, ALI)).items.map((r) => r.lastUpdatedAt)
    expect(newest).toEqual([...oldest].reverse())
  })

  it('Given filter options, then only projects and flows in the case scope, with whether each flow runs risk', async () => {
    const o = await svc.filterOptions(ALI)
    expect(o.projects.map((p) => p.projectId)).toEqual(['PRJ-0001', 'PRJ-0002'])
    expect(o.flows.map((f) => f.flowId)).toEqual(['FLW-0001', 'FLW-0002', 'FLW-0004']) // FLW-0003 is Draft
    expect(o.flows.find((f) => f.flowId === 'FLW-0004')!.runsRisk).toBe(false)
    expect(o.flows.find((f) => f.flowId === 'FLW-0001')!.runsRisk).toBe(true)
    expect((await svc.filterOptions(ADMIN)).projects).toEqual([]) // OQ-20
  })

  it('filters by status, Last Updated By, claim and name', async () => {
    const manual = await svc.list({ lastUpdatedBy: 'MANUAL', pageSize: 500 }, OWNER)
    expect(manual.items.every((r) => r.lastUpdatedBy.kind === 'USER')).toBe(true)
    const pending = await svc.list({ statuses: ['PENDING_REVIEW'], pageSize: 500 }, OWNER)
    expect(pending.items.every((r) => r.status === 'PENDING_REVIEW')).toBe(true)
    const mine = await svc.list({ claim: 'MINE' }, ALI)
    expect(mine.items.map((r) => r.referenceNo).sort()).toEqual(expect.arrayContaining([S(7), S(8)]))
    const target = (await svc.get(S(3), ALI)).pii.fullName
    expect((await svc.list({ fullName: target.toLowerCase() }, ALI)).items.map((r) => r.referenceNo)).toContain(S(3))
  })

  it('Given Empty Demo Merchant, then no rows (S14)', async () => {
    expect((await svc.list({}, EMPTY_OWNER)).total).toBe(0)
  })

  it('paginates', async () => {
    const p2 = await svc.list({ page: 2, pageSize: 10 }, OWNER)
    expect(p2.items).toHaveLength(10)
    expect(p2.page).toBe(2)
  })
})

describe('per-project case access (DEC-70, DEC-72)', () => {
  it('Given Ali (Reviewer in Default, Viewer in SME app), then he sees cases from both projects and nothing else', async () => {
    const refs = (await svc.list({ pageSize: 1000 }, ALI)).items.map((r) => r.referenceNo)
    expect(refs).toEqual(expect.arrayContaining([S(2), S(16), S(18)])) // Default › Malaysian, SME app, Default › Foreigner
    expect(refs).not.toContain(S(1)) // Vantage
  })

  it('Given Hafiz (Project Admin of SME app only), then Default cases are "not found", not "forbidden"', async () => {
    expect((await svc.list({ pageSize: 1000 }, HAFIZ)).items.map((r) => r.referenceNo)).toEqual(expect.arrayContaining([S(16)]))
    await expectError(svc.get(S(2), HAFIZ), 'NOT_FOUND', `Verification ${S(2)} not found.`)
    await expectError(svc.claim(S(10), HAFIZ), 'NOT_FOUND')
  })

  it('Given a reviewer from another merchant, then NOT_FOUND', async () => {
    await expectError(svc.get(S(2), OTHER_MERCHANT_REVIEWER), 'NOT_FOUND')
  })

  it('Given the Platform Admin, then no case access by default (OQ-20)', async () => {
    expect((await svc.list({}, ADMIN)).total).toBe(0)
    await expectError(svc.get(S(2), ADMIN), 'NOT_FOUND')
  })

  it('Given the Merchant Owner, then cases from every Atoz project are visible; a one-project admin sees fewer', async () => {
    const owner = (await svc.list({}, OWNER)).total
    expect(owner).toBe((await svc.list({}, ALI)).total) // Ali is a member of both Atoz projects
    expect((await svc.list({}, HAFIZ)).total).toBeLessThan(owner)
    expect((await svc.get(S(16), OWNER)).projectId).toBe('PRJ-0002')
  })

  it('Given S16 in SME app, when Ali (Viewer) tries to claim, then FORBIDDEN; Nurul (Reviewer) gets the 45-min project timeout (S16, DEC-22)', async () => {
    await expect(svc.get(S(16), ALI)).resolves.toBeTruthy()
    await expectError(svc.claim(S(16), ALI), 'FORBIDDEN', 'You do not have review permission for this project.')
    const v = await svc.claim(S(16), NURUL)
    expect(Date.parse(v.claimExpiresAt!) - Date.parse(v.claimedAt!)).toBe(minutes(45))
  })
})

describe('verificationService.get detail sections (DEC-44)', () => {
  it('Given S03, then project, flow, revision, steps and each check with threshold applied and retries used / allowed', async () => {
    const d = await svc.get(S(3), ALI)
    expect(d).toMatchObject({ projectName: 'Default', flowName: 'Malaysian onboarding', revisionLabel: 'V4-R2', steps: { runsRisk: true, faceMatchMethod: 'ID_VS_LIVENESS' } })
    const fm = d.checks.find((c) => c.check === 'FACE_MATCH')!
    expect(fm).toMatchObject({ state: 'REVIEW', thresholds: { autoReject: 85, autoPass: 95 }, lastScore: 88.5, submissions: 4, retriesUsed: 3, retriesAllowed: 3 })
    expect(d.rulesApplied.checks.FACE_MATCH.threshold).toEqual({ preset: 'STANDARD' })
  })

  it('Given S12 started on R1, then Rules applied are R1 even though R2 is live (DEC-52)', async () => {
    const d = await svc.get(S(12), ALI)
    expect(d.revisionLabel).toBe('V4-R1')
    expect(d.rulesApplied.checks.LIVENESS.threshold).toEqual({ preset: 'LOW' })
  })

  it('Given S18 rejected with a 120-min cooldown, then "New case allowed from" is 2 h after the rejection (DEC-26)', async () => {
    const d = await svc.get(S(18), ALI)
    expect(d.status).toBe('REJECTED')
    expect(Date.parse(d.newCaseAllowedAt!) - Date.parse(d.lastUpdatedAt)).toBe(minutes(120))
    expect((await svc.get(S(4), ALI)).newCaseAllowedAt).toBeUndefined() // cooldown 0
  })

  it('Given S11, then the activity timeline runs session start → submissions → claim → decision, without PII views', async () => {
    const kinds = (await svc.get(S(11), ALI)).activity.map((a) => a.kind)
    expect(kinds).toEqual(['SESSION_STARTED', 'SUBMISSION', 'SUBMISSION', 'SUBMISSION', 'SUBMISSION', 'CASE_CLAIMED', 'CASE_DECISION_APPROVED'])
    const s04 = (await svc.get(S(4), ALI)).activity
    expect(s04.at(-1)).toMatchObject({ kind: 'SYSTEM_RESULT', detail: 'REJECTED · Face not live (Retry Not Allowed)' })
  })
})

describe('verificationService.get (DEC-41)', () => {
  it('Given a detail open, then full PII is returned and one SENSITIVE_PII_VIEW is written per request id', async () => {
    const before = (await auditFor(S(10), ['SENSITIVE_PII_VIEW'])).length
    const d = await svc.get(S(10), ALI, { requestId: 'r-1' })
    await svc.get(S(10), ALI, { requestId: 'r-1' }) // StrictMode double effect
    expect(d.pii.nric).toMatch(/999\d$/)
    expect(d.clientMetadata.ip).toMatch(/^(192\.0\.2|198\.51\.100|203\.0\.113)\./)
    expect((await auditFor(S(10), ['SENSITIVE_PII_VIEW'])).length).toBe(before + 1)
    await svc.get(S(10), ALI, { requestId: 'r-2' })
    expect((await auditFor(S(10), ['SENSITIVE_PII_VIEW'])).length).toBe(before + 2)
  })

  it('Given the same request id on two different records, then each record gets its own SENSITIVE_PII_VIEW', async () => {
    const a = (await auditFor(S(3), ['SENSITIVE_PII_VIEW'])).length
    const b = (await auditFor(S(4), ['SENSITIVE_PII_VIEW'])).length
    await svc.get(S(3), ALI, { requestId: 'page-1' })
    await svc.get(S(4), ALI, { requestId: 'page-1' })
    expect((await auditFor(S(3), ['SENSITIVE_PII_VIEW'])).length).toBe(a + 1)
    expect((await auditFor(S(4), ['SENSITIVE_PII_VIEW'])).length).toBe(b + 1)
  })

  it("Given another merchant's record, then NOT_FOUND", async () => {
    await expectError(svc.get(S(1), ALI), 'NOT_FOUND') // S01 belongs to Vantage
  })
})

describe('claim and release', () => {
  it('Given S10 unclaimed, when Ali then Siti click Assign, then Ali wins and Siti gets ALREADY_CLAIMED (S10)', async () => {
    const d = await svc.claim(S(10), ALI)
    expect(d.claimedBy?.userId).toBe(ALI.userId)
    await expectError(svc.claim(S(10), SITI), 'ALREADY_CLAIMED', 'Already claimed by Ali Bin Ahmad.')
    expect(await auditFor(S(10), ['CASE_CLAIMED'])).toEqual(['CASE_CLAIMED'])
  })

  it('Given a claim, then status, lastUpdatedBy and lastUpdatedAt are unchanged (DEC-03, DEC-20)', async () => {
    const before = await svc.get(S(10), ALI)
    const after = await svc.claim(S(10), ALI)
    expect(after.status).toBe('PENDING_REVIEW')
    expect(after.lastUpdatedBy).toEqual(before.lastUpdatedBy)
    expect(after.lastUpdatedAt).toBe(before.lastUpdatedAt)
  })

  it('Given a PROCESSING record, then it cannot be claimed (S05)', async () => {
    await expectError(svc.claim(S(5), ALI), 'NOT_CLAIMABLE')
  })

  it("Given Siti's claim, when Ali cancels, then NOT_CLAIM_OWNER; when Siti cancels, then CASE_RELEASED", async () => {
    await expectError(svc.release(S(9), ALI), 'NOT_CLAIM_OWNER')
    const d = await svc.release(S(9), SITI)
    expect(d.claimedBy).toBeUndefined()
    expect(await auditFor(S(9), ['CASE_RELEASED'])).toEqual(['CASE_RELEASED'])
  })

  it("Given time passes the claim expiry, then the claim disappears and one CASE_CLAIM_EXPIRED is written", async () => {
    vi.setSystemTime(NOW.getTime() + minutes(3)) // S07 had ~2 min left
    await svc.list({}, ALI)
    await svc.list({}, ALI) // idempotent
    expect((await svc.get(S(7), ALI)).claimedBy).toBeUndefined()
    expect(await auditFor(S(7), ['CASE_CLAIM_EXPIRED'])).toEqual(['CASE_CLAIM_EXPIRED'])
  })
})

describe('decide (DEC-24, DEC-30)', () => {
  const approve = { outcome: 'APPROVE' as const, note: 'Matches.' }

  it('Given Ali holds the S07 claim, when he approves, then APPROVED by Ali and a CASE_DECISION_APPROVED entry with his project role', async () => {
    vi.setSystemTime(NOW.getTime() + minutes(1))
    const d = await svc.decide(S(7), ALI, approve)
    expect(d).toMatchObject({ status: 'APPROVED', lastUpdatedBy: { kind: 'USER', userId: ALI.userId }, statusReason: 'Confirmed manual pass by reviewer', claimedBy: undefined })
    expect(d.lastUpdatedAt).toBe(new Date(NOW.getTime() + minutes(1)).toISOString())
    expect((await auditFor(S(7))).at(-1)).toBe('CASE_DECISION_APPROVED')
    const [entry] = (await auditService.list({ referenceNo: S(7), actions: ['CASE_DECISION_APPROVED'] }, ADMIN)).items
    expect(entry).toMatchObject({ actorRole: 'REVIEWER', projectId: 'PRJ-0001', details: { fromStatus: 'PENDING_REVIEW', toStatus: 'APPROVED' } })
    await expectError(svc.decide(S(7), ALI, approve), 'OWNERSHIP_CONFLICT', 'This record has already been decided. No changes saved.')
  })

  it("Given Ali's S08 claim expires while he types, when he saves, then nothing is saved and CASE_CLAIM_EXPIRED + CASE_DECISION_BLOCKED are audited (S08, DEC-24)", async () => {
    vi.setSystemTime(NOW.getTime() + minutes(11)) // S08 had ~10 min left
    await expectError(svc.decide(S(8), ALI, approve), 'OWNERSHIP_CONFLICT', 'Your claim expired. No changes saved.')
    const d = await svc.get(S(8), ALI)
    expect(d.status).toBe('PENDING_REVIEW')
    expect(d.lastUpdatedBy.kind).toBe('SYSTEM')
    expect((await auditFor(S(8), ['CASE_CLAIM_EXPIRED', 'CASE_DECISION_BLOCKED']))).toEqual(['CASE_CLAIM_EXPIRED', 'CASE_DECISION_BLOCKED'])
  })

  it('Given Siti holds the claim, when Ali saves, then OWNERSHIP_CONFLICT (S09)', async () => {
    await expectError(svc.decide(S(9), ALI, approve), 'OWNERSHIP_CONFLICT')
  })

  it('Given Reject without a reason, then VALIDATION and nothing is written (DEC-31)', async () => {
    await expectError(svc.decide(S(7), ALI, { outcome: 'REJECT', reasonIds: [] }), 'VALIDATION', 'Choose at least one reason for the rejection.')
    expect(await auditFor(S(7), ['CASE_DECISION_APPROVED', 'CASE_DECISION_REJECTED', 'CASE_DECISION_BLOCKED'])).toEqual([])
  })

  it('Given S11 manually approved, then any save is refused (decisions are final)', async () => {
    await expectError(svc.decide(S(11), ALI, approve), 'OWNERSHIP_CONFLICT')
  })
})

describe('configService (DEC-50 … DEC-53)', () => {
  it('Given a valid change, when admin saves a draft and deploys, then the version bumps and both steps are audited; old records keep their version (S12)', async () => {
    const active = await configService.getActive('MER-0001', ADMIN)
    expect(active.version).toBe('v1.1.0')
    const phases = active.phases.map((p) => (p.phase === 'FACE_MATCH' ? { ...p, autoPass: 88 } : p))
    const draft = await configService.saveDraft('MER-0001', { ...active, phases }, ADMIN)
    expect(draft).toMatchObject({ state: 'DRAFT', version: 'v1.2.0' })
    const deployed = await configService.deploy('MER-0001', ADMIN)
    expect(deployed).toMatchObject({ state: 'DEPLOYED', version: 'v1.2.0' })
    expect(await configService.getDraft('MER-0001', ADMIN)).toBeNull()

    const log = (await auditService.list({ merchantId: 'MER-0001', actions: ['CONFIG_DRAFT_SAVE', 'CONFIG_DEPLOY'] }, ADMIN)).items
    expect(log[0]).toMatchObject({ action: 'CONFIG_DEPLOY', details: { fromVersion: 'v1.1.0', toVersion: 'v1.2.0', changes: [{ field: 'phases.FACE_MATCH.autoPass', from: 85, to: 88 }] } })
    expect(log[1].action).toBe('CONFIG_DRAFT_SAVE')
    expect((await svc.get(S(12), ALI)).configVersion).toBe('v1.0.0')
  })

  it('Given an invalid draft, then VALIDATION with field errors', async () => {
    const active = await configService.getActive('MER-0001', ADMIN)
    const phases = active.phases.map((p) => (p.phase === 'LIVENESS' ? { ...p, autoReject: 95 } : p))
    await expectError(configService.saveDraft('MER-0001', { ...active, phases }, ADMIN), 'VALIDATION')
  })

  it('Given no changes, then deploy is refused', async () => {
    const active = await configService.getActive('MER-0001', ADMIN)
    await configService.saveDraft('MER-0001', active, ADMIN)
    await expectError(configService.deploy('MER-0001', ADMIN), 'VALIDATION', 'The draft has no changes to deploy.')
  })

  it('Given a Merchant Reviewer, then they can read but not change config', async () => {
    const active = await configService.getActive('MER-0001', ALI)
    await expectError(configService.saveDraft('MER-0001', active, ALI), 'FORBIDDEN')
    await expectError(configService.getActive('MER-0002', ALI), 'NOT_FOUND')
  })

  it('Given a V1 merchant, then risk settings are dropped from the draft', async () => {
    const active = await configService.getActive('MER-0002', ADMIN)
    const draft = await configService.saveDraft('MER-0002', { ...active, risk: { enabled: true, maxAllowedLevel: 'LOW' }, claimTimeoutMin: 20 }, ADMIN)
    expect(draft.risk).toBeUndefined()
  })

  it('Given a discard, then the draft is gone and CONFIG_DISCARD is audited', async () => {
    const active = await configService.getActive('MER-0001', ADMIN)
    await configService.saveDraft('MER-0001', { ...active, claimTimeoutMin: 45 }, ADMIN)
    await configService.discardDraft('MER-0001', ADMIN)
    expect(await configService.getDraft('MER-0001', ADMIN)).toBeNull()
    expect((await auditService.list({ actions: ['CONFIG_DISCARD'] }, ADMIN)).total).toBe(1)
  })
})

describe('auditService and merchantService scoping (DEC-70, DEC-72)', () => {
  it('Given the Merchant Owner, then audit entries and merchants are limited to their merchant', async () => {
    const log = await auditService.list({ pageSize: 1000 }, OWNER)
    expect(log.items.every((e) => e.merchantId === 'MER-0001')).toBe(true)
    expect(log.items.some((e) => e.action === 'API_KEY_ROTATED')).toBe(true) // merchant-wide entries included
    expect((await merchantService.list(ALI)).map((m) => m.merchantId)).toEqual(['MER-0001'])
    expect((await merchantService.list(ADMIN)).length).toBe(6)
  })

  it('Given a Project Admin, then only their project entries; merchant-wide entries are not theirs', async () => {
    const log = await auditService.list({ pageSize: 1000 }, HAFIZ)
    expect(log.total).toBeGreaterThan(0)
    expect(log.items.every((e) => e.projectId === 'PRJ-0002')).toBe(true)
  })

  it('Given a Reviewer, then the Audit Log is refused', async () => {
    await expectError(auditService.list({}, ALI), 'FORBIDDEN')
  })

  it('Given a project filter, then only that project', async () => {
    const log = await auditService.list({ projectId: 'PRJ-0002', pageSize: 1000 }, OWNER)
    expect(log.items.every((e) => e.projectId === 'PRJ-0002')).toBe(true)
  })
})

describe('analyticsService scoping (DEC-86)', () => {
  const total = async (actor: typeof ALI, merchantId?: string) => {
    const s = await analyticsService.overview({ days: 90, merchantId }, actor)
    return s.total
  }

  it('Given each role, then the same dashboards with data scoped: admin ≥ owner ≥ one-project admin', async () => {
    const admin = await total(ADMIN)
    const owner = await total(OWNER)
    const hafiz = await total(HAFIZ)
    expect(admin).toBeGreaterThan(owner)
    expect(owner).toBeGreaterThan(hafiz)
    expect(hafiz).toBeGreaterThan(0)
  })

  it('Given a Reviewer, then Billing is available with their projects only', async () => {
    const report = await analyticsService.billing({ period: NOW.toISOString().slice(0, 7) }, ALI)
    expect(report.byMerchant.every((m) => m.merchantId === 'MER-0001')).toBe(true)
  })

  it("Given another merchant's id, then NOT_FOUND for merchant users; Platform Admin may filter any merchant", async () => {
    await expectError(analyticsService.overview({ days: 30, merchantId: 'MER-0002' }, OWNER), 'NOT_FOUND')
    expect(await total(ADMIN, 'MER-0006')).toBe(0)
  })
})

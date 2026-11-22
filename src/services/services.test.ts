// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuditAction } from '@/domain/types'
import { ADMIN, ALI, EMPTY_OWNER, HAFIZ, NOW, NURUL, OTHER_MERCHANT_REVIEWER, OWNER, SITI, minutes } from '@/test/factories'
import { analyticsService } from './analyticsService'
import { auditService } from './auditService'
import { devService } from './devService'
import { flowService } from './flowService'
import { isServiceError } from './errors'
import { merchantService } from './merchantService'
import { verificationService as svc } from './verificationService'
import { fx, caseIdOf } from '@/lib/ids'

const S = (n: number) => `KYC-260901-${900000 + n}` // Reference ID
const C = (n: number) => caseIdOf(S(n)) // case ID (DEC-97)

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
  it('Given a list page, then rows contain no NRIC, passport, address, client metadata, telemetry or duplicate-user result (DEC-40)', async () => {
    const page = await svc.list({ pageSize: 500 }, OWNER)
    expect(page.total).toBeGreaterThan(50)
    for (const row of page.items) {
      expect(Object.keys(row)).not.toEqual(expect.arrayContaining(['pii']))
      const json = JSON.stringify(row)
      for (const leak of ['nric', 'passportNo', 'address', 'clientMetadata', 'ip', 'dob', 'duplicateUser', 'idCapture', 'riskCategories', 'telemetry']) expect(json).not.toContain(`"${leak}"`)
    }
  })

  it("Given a Reviewer, then only their projects are visible, even when another merchant's project is requested (DEC-72)", async () => {
    const own = await svc.list({ pageSize: 500 }, ALI)
    expect(own.items.every((r) => r.merchantId === fx('MER-0001'))).toBe(true)
    expect((await svc.list({ projectIds: [fx('PRJ-0003')] }, ALI)).total).toBe(0)
  })

  it('Given a list row, then it names its project and flow and carries Created (DEC-40)', async () => {
    const row = (await svc.list({ referenceNo: S(16) }, ALI)).items[0]
    expect(row).toMatchObject({ projectId: fx('PRJ-0002'), projectName: 'SME app', flowId: fx('FLW-0004'), flowName: 'SME director check', workflowVersion: 'V3' })
    expect(row.createdAt).toBe((await svc.get(C(16), ALI)).createdAt)
  })

  it('Given project, flow and version filters, then only matching rows', async () => {
    const sme = await svc.list({ projectIds: [fx('PRJ-0002')], pageSize: 500 }, ALI)
    expect(sme.total).toBeGreaterThan(0)
    expect(sme.items.every((r) => r.projectId === fx('PRJ-0002'))).toBe(true)
    const foreigner = await svc.list({ flowId: fx('FLW-0002'), pageSize: 500 }, ALI)
    expect(foreigner.items.every((r) => r.flowId === fx('FLW-0002'))).toBe(true)
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

  it('Given no sort, then oldest Last updated first; Last updated descending reverses it (DEC-43)', async () => {
    const oldest = (await svc.list({ statuses: ['PENDING_REVIEW'], pageSize: 500 }, ALI)).items.map((r) => r.lastUpdatedAt)
    expect(oldest).toEqual([...oldest].sort())
    const newest = (await svc.list({ statuses: ['PENDING_REVIEW'], sort: { by: 'lastUpdatedAt', dir: 'desc' }, pageSize: 500 }, ALI)).items.map((r) => r.lastUpdatedAt)
    expect(newest).toEqual([...oldest].reverse())
  })

  it('Given a column sort, then Reference ID, status (lifecycle order) and risk (Low → High, none last) sort both ways (DEC-100, DEC-107)', async () => {
    const list = async (by: 'referenceNo' | 'status' | 'riskResult', dir: 'asc' | 'desc') => (await svc.list({ sort: { by, dir }, pageSize: 500 }, OWNER)).items
    const refs = (await list('referenceNo', 'asc')).map((r) => r.referenceNo)
    expect(refs).toEqual([...refs].sort())
    expect((await list('referenceNo', 'desc')).map((r) => r.referenceNo)).toEqual([...refs].reverse())
    const order = ['PROCESSING', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'FAILED'] // REQ: DEC-112
    const statuses = (await list('status', 'asc')).map((r) => order.indexOf(r.status))
    expect(statuses).toEqual([...statuses].sort((a, b) => a - b))
    const down = (await list('status', 'desc')).map((r) => order.indexOf(r.status))
    expect(down).toEqual([...down].sort((a, b) => b - a))
    const risk = ['LOW', 'HIGH']
    for (const dir of ['asc', 'desc'] as const) {
      const levels = (await list('riskResult', dir)).map((r) => r.riskResult)
      const rated = levels.filter(Boolean).map((l) => risk.indexOf(l!))
      expect(new Set(levels.slice(rated.length))).toEqual(new Set([undefined])) // no risk result: last either way
      expect(rated).toEqual([...rated].sort((a, b) => (dir === 'asc' ? a - b : b - a)))
      expect(rated.length).toBeGreaterThan(0)
    }
  })

  it('Given filter options, then only projects and flows in the case scope, with whether each flow runs risk', async () => {
    const o = await svc.filterOptions(ALI)
    expect(o.projects.map((p) => p.projectId)).toEqual([fx('PRJ-0001'), fx('PRJ-0002')])
    expect(o.flows.map((f) => f.flowId)).toEqual([fx('FLW-0001'), fx('FLW-0002'), fx('FLW-0014'), fx('FLW-0004')]) // FLW-0003 is Draft
    expect(o.flows.find((f) => f.flowId === fx('FLW-0004'))!.runsRisk).toBe(false)
    expect(o.flows.find((f) => f.flowId === fx('FLW-0001'))!.runsRisk).toBe(true)
    expect((await svc.filterOptions(ADMIN)).projects.length).toBeGreaterThan(2) // every merchant (DEC-75)
  })

  it('filters by status, Last Updated By, claim and name', async () => {
    const manual = await svc.list({ lastUpdatedBy: 'MANUAL', pageSize: 500 }, OWNER)
    expect(manual.items.every((r) => r.lastUpdatedBy.kind === 'USER')).toBe(true)
    const pending = await svc.list({ statuses: ['PENDING_REVIEW'], pageSize: 500 }, OWNER)
    expect(pending.items.every((r) => r.status === 'PENDING_REVIEW')).toBe(true)
    const mine = await svc.list({ claim: 'MINE' }, ALI)
    expect(mine.items.map((r) => r.referenceNo).sort()).toEqual(expect.arrayContaining([S(7), S(8)]))
    const target = (await svc.get(C(3), ALI)).pii.fullName
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
    await expectError(svc.get(C(2), HAFIZ), 'NOT_FOUND', `Verification ${C(2)} not found.`)
    await expectError(svc.claim(C(10), HAFIZ), 'NOT_FOUND')
  })

  it('Given a reviewer from another merchant, then NOT_FOUND', async () => {
    await expectError(svc.get(C(2), OTHER_MERCHANT_REVIEWER), 'NOT_FOUND')
  })

  it('Given the Super admin, then every case is visible, each open is audited, and they can claim and decide (DEC-75)', async () => {
    expect((await svc.list({ pageSize: 500 }, ADMIN)).total).toBeGreaterThan((await svc.list({ pageSize: 500 }, OWNER)).total)
    await svc.get(C(10), ADMIN)
    expect((await auditService.list({ actions: ['SENSITIVE_PII_VIEW'] }, ADMIN)).items[0]).toMatchObject({ referenceNo: S(10), actorRole: 'Super admin' })
    await svc.claim(C(10), ADMIN)
    const v = await svc.decide(C(10), ADMIN, { outcome: 'APPROVE', reasonCodes: ['FACE_CONFIRMED'] })
    expect(v).toMatchObject({ status: 'APPROVED', lastUpdatedBy: { kind: 'USER', userId: ADMIN.userId } })
  })

  it('Given the Owner, then cases from every Atoz project are visible; a one-project admin sees fewer', async () => {
    const owner = (await svc.list({}, OWNER)).total
    expect(owner).toBe((await svc.list({}, ALI)).total) // Ali is a member of both Atoz projects
    expect((await svc.list({}, HAFIZ)).total).toBeLessThan(owner)
    expect((await svc.get(C(16), OWNER)).projectId).toBe(fx('PRJ-0002'))
  })

  it('Given S16 in SME app, when Ali (Viewer) tries to claim, then FORBIDDEN; Nurul (Reviewer) gets the 45-min project timeout (S16, DEC-22)', async () => {
    await expect(svc.get(C(16), ALI)).resolves.toBeTruthy()
    await expectError(svc.claim(C(16), ALI), 'FORBIDDEN', 'You do not have review permission for this project.')
    const v = await svc.claim(C(16), NURUL)
    expect(Date.parse(v.claimExpiresAt!) - Date.parse(v.claimedAt!)).toBe(minutes(45))
  })
})

describe('verificationService.get detail sections (DEC-44)', () => {
  it('Given S03, then project, flow, revision, steps and each check with threshold applied and retries used / allowed', async () => {
    const d = await svc.get(C(3), ALI)
    expect(d).toMatchObject({ projectName: 'Default', flowName: 'Malaysian onboarding', revisionLabel: 'V4-R2', steps: { runsRisk: true, faceMatchMethod: 'ID_VS_LIVENESS' } })
    const fm = d.checks.find((c) => c.check === 'FACE_MATCH')!
    expect(fm).toMatchObject({ state: 'REVIEW', thresholds: { autoReject: 85, autoPass: 95 }, lastScore: 88.5, submissions: 4, retriesUsed: 3, retriesAllowed: 3 })
    expect(d.rulesApplied.checks.FACE_MATCH.threshold).toEqual({ preset: 'STANDARD' })
  })

  it('Given S12 started on R1, then Rules applied are R1 even though R2 is live (DEC-52)', async () => {
    const d = await svc.get(C(12), ALI)
    expect(d.revisionLabel).toBe('V4-R1')
    expect(d.rulesApplied.checks.LIVENESS.threshold).toEqual({ preset: 'LOW' })
  })

  it('Given S18 rejected on a flow with Rejected 120 min and Failed 30 min, then "New session allowed from" is 2 h after the rejection (DEC-26)', async () => {
    const d = await svc.get(C(18), ALI)
    expect(d.status).toBe('REJECTED')
    expect(d.rulesApplied).toMatchObject({ cooldownMin: 120, failedCooldownMin: 30 })
    expect(Date.parse(d.newSessionAllowedAt!) - Date.parse(d.lastUpdatedAt)).toBe(minutes(120)) // the Rejected one
    expect((await svc.get(C(4), ALI)).newSessionAllowedAt).toBeUndefined() // cooldown 0
  })

  it('Given S25 FAILED on a flow whose Cooldown after Failed is 0, then a new session is allowed at once (DEC-26, DEC-112)', async () => {
    const d = await svc.get(C(25), ALI)
    expect(d.status).toBe('FAILED')
    expect(d.newSessionAllowedAt).toBeUndefined()
  })

})

describe('verificationService.get (DEC-41)', () => {
  it('Given a detail open, then full PII is returned and one SENSITIVE_PII_VIEW is written per request id', async () => {
    const before = (await auditFor(S(10), ['SENSITIVE_PII_VIEW'])).length
    const d = await svc.get(C(10), ALI, { requestId: 'r-1' })
    await svc.get(C(10), ALI, { requestId: 'r-1' }) // StrictMode double effect
    expect(d.pii.nric).toMatch(/999\d$/)
    expect(d.clientMetadata.ip).toMatch(/^(192\.0\.2|198\.51\.100|203\.0\.113)\./)
    expect((await auditFor(S(10), ['SENSITIVE_PII_VIEW'])).length).toBe(before + 1)
    await svc.get(C(10), ALI, { requestId: 'r-2' })
    expect((await auditFor(S(10), ['SENSITIVE_PII_VIEW'])).length).toBe(before + 2)
  })

  it('Given the same request id on two different records, then each record gets its own SENSITIVE_PII_VIEW', async () => {
    const a = (await auditFor(S(3), ['SENSITIVE_PII_VIEW'])).length
    const b = (await auditFor(S(4), ['SENSITIVE_PII_VIEW'])).length
    await svc.get(C(3), ALI, { requestId: 'page-1' })
    await svc.get(C(4), ALI, { requestId: 'page-1' })
    expect((await auditFor(S(3), ['SENSITIVE_PII_VIEW'])).length).toBe(a + 1)
    expect((await auditFor(S(4), ['SENSITIVE_PII_VIEW'])).length).toBe(b + 1)
  })

  it("Given another merchant's record, then NOT_FOUND", async () => {
    await expectError(svc.get(C(1), ALI), 'NOT_FOUND') // S01 belongs to Vantage
  })
})

describe('claim and release', () => {
  it('Given S10 unclaimed, when Ali then Siti click Assign, then Ali wins and Siti gets ALREADY_CLAIMED (S10)', async () => {
    const d = await svc.claim(C(10), ALI)
    expect(d.claimedBy?.userId).toBe(ALI.userId)
    await expectError(svc.claim(C(10), SITI), 'ALREADY_CLAIMED', 'Already claimed by Ali Bin Ahmad.')
    expect(await auditFor(S(10), ['CASE_CLAIMED'])).toEqual(['CASE_CLAIMED'])
  })

  it('Given a claim, then status, lastUpdatedBy and lastUpdatedAt are unchanged (DEC-03, DEC-20)', async () => {
    const before = await svc.get(C(10), ALI)
    const after = await svc.claim(C(10), ALI)
    expect(after.status).toBe('PENDING_REVIEW')
    expect(after.lastUpdatedBy).toEqual(before.lastUpdatedBy)
    expect(after.lastUpdatedAt).toBe(before.lastUpdatedAt)
  })

  it('Given a PROCESSING record, then it cannot be claimed (S05)', async () => {
    await expectError(svc.claim(C(5), ALI), 'NOT_CLAIMABLE')
  })

  it("Given Siti's claim, when Ali cancels, then NOT_CLAIM_OWNER; when Siti cancels, then CASE_RELEASED", async () => {
    await expectError(svc.release(C(9), ALI), 'NOT_CLAIM_OWNER')
    const d = await svc.release(C(9), SITI)
    expect(d.claimedBy).toBeUndefined()
    expect(await auditFor(S(9), ['CASE_RELEASED'])).toEqual(['CASE_RELEASED'])
  })

  it("Given time passes the claim expiry, then the claim disappears and one CASE_CLAIM_EXPIRED is written", async () => {
    vi.setSystemTime(NOW.getTime() + minutes(3)) // S07 had ~2 min left
    await svc.list({}, ALI)
    await svc.list({}, ALI) // idempotent
    expect((await svc.get(C(7), ALI)).claimedBy).toBeUndefined()
    expect(await auditFor(S(7), ['CASE_CLAIM_EXPIRED'])).toEqual(['CASE_CLAIM_EXPIRED'])
  })
})

describe('decide (DEC-24, DEC-30)', () => {
  const approve = { outcome: 'APPROVE' as const, reasonCodes: ['FACE_CONFIRMED'], note: 'Matches.' }

  it('Given Ali holds the S07 claim, when he approves, then APPROVED by Ali and a CASE_DECISION_APPROVED entry with his project role', async () => {
    vi.setSystemTime(NOW.getTime() + minutes(1))
    const d = await svc.decide(C(7), ALI, approve)
    expect(d).toMatchObject({ status: 'APPROVED', lastUpdatedBy: { kind: 'USER', userId: ALI.userId }, statusReason: 'Face confirmed by reviewer (e.g. old ID photo)', claimedBy: undefined })
    expect(d.lastUpdatedAt).toBe(new Date(NOW.getTime() + minutes(1)).toISOString())
    expect((await auditFor(S(7))).at(-1)).toBe('CASE_DECISION_APPROVED')
    const [entry] = (await auditService.list({ referenceNo: S(7), actions: ['CASE_DECISION_APPROVED'] }, ADMIN)).items
    expect(entry).toMatchObject({ actorRole: 'Reviewer', projectId: fx('PRJ-0001'), details: { fromStatus: 'PENDING_REVIEW', toStatus: 'APPROVED' } })
    await expectError(svc.decide(C(7), ALI, approve), 'OWNERSHIP_CONFLICT', 'This record has already been decided. No changes saved.')
  })

  it("Given Ali's S08 claim expires while he types, when he saves, then nothing is saved and CASE_CLAIM_EXPIRED + CASE_DECISION_BLOCKED are audited (S08, DEC-24)", async () => {
    vi.setSystemTime(NOW.getTime() + minutes(11)) // S08 had ~10 min left
    await expectError(svc.decide(C(8), ALI, approve), 'OWNERSHIP_CONFLICT', 'Your claim expired. No changes saved.')
    const d = await svc.get(C(8), ALI)
    expect(d.status).toBe('PENDING_REVIEW')
    expect(d.lastUpdatedBy.kind).toBe('SYSTEM')
    expect((await auditFor(S(8), ['CASE_CLAIM_EXPIRED', 'CASE_DECISION_BLOCKED']))).toEqual(['CASE_CLAIM_EXPIRED', 'CASE_DECISION_BLOCKED'])
  })

  it('Given Siti holds the claim, when Ali saves, then OWNERSHIP_CONFLICT (S09)', async () => {
    await expectError(svc.decide(C(9), ALI, approve), 'OWNERSHIP_CONFLICT')
  })

  it('Given Reject without a reason, then VALIDATION and nothing is written (DEC-31)', async () => {
    await expectError(svc.decide(C(7), ALI, { outcome: 'REJECT', reasonCodes: [] }), 'VALIDATION', 'Choose at least one reason for the rejection.')
    expect(await auditFor(S(7), ['CASE_DECISION_APPROVED', 'CASE_DECISION_REJECTED', 'CASE_DECISION_BLOCKED'])).toEqual([])
  })

  it('Given S11 manually approved, then any save is refused (decisions are final)', async () => {
    await expectError(svc.decide(C(11), ALI, approve), 'OWNERSHIP_CONFLICT')
  })
})

describe('auditService and merchantService scoping (DEC-70, DEC-72)', () => {
  it('Given the Owner, then audit entries and merchants are limited to their merchant', async () => {
    const log = await auditService.list({ pageSize: 1000 }, OWNER)
    expect(log.items.every((e) => e.merchantId === fx('MER-0001'))).toBe(true)
    expect(log.items.some((e) => e.action === 'API_KEY_ROTATED')).toBe(true) // merchant-wide entries included
    expect((await merchantService.list(ALI)).map((m) => m.merchantId)).toEqual([fx('MER-0001')])
    expect((await merchantService.list(ADMIN)).length).toBe(6)
  })

  it('Given a Project Admin, then only their project entries; merchant-wide entries are not theirs', async () => {
    const log = await auditService.list({ pageSize: 1000 }, HAFIZ)
    expect(log.total).toBeGreaterThan(0)
    expect(log.items.every((e) => e.projectId === fx('PRJ-0002'))).toBe(true)
  })

  it('Given a Reviewer, then the Audit Log is refused', async () => {
    await expectError(auditService.list({}, ALI), 'FORBIDDEN')
  })

  it('Given a project filter, then only that project', async () => {
    const log = await auditService.list({ projectId: fx('PRJ-0002'), pageSize: 1000 }, OWNER)
    expect(log.items.every((e) => e.projectId === fx('PRJ-0002'))).toBe(true)
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
    expect(report.byMerchant.every((m) => m.key === fx('MER-0001'))).toBe(true)
    expect(report.byProject.every((p) => [fx('PRJ-0001'), fx('PRJ-0002')].includes(p.key))).toBe(true)
  })

  it("Given another merchant's id, then NOT_FOUND for merchant users; Super admin may filter any merchant", async () => {
    await expectError(analyticsService.overview({ days: 30, merchantId: fx('MER-0002') }, OWNER), 'NOT_FOUND')
    expect(await total(ADMIN, fx('MER-0006'))).toBe(0)
  })
})

describe('Internal testing is hidden from merchant users (DEC-56)', () => {
  const TRIAL = fx('FLW-0015') // Atoz Default, V6 (Internal testing); S26 is its test session
  const month = NOW.toISOString().slice(0, 7)

  it('Given the Atoz Owner, when listing or opening, then the V6 flow and its session are "not found" everywhere', async () => {
    expect((await flowService.list(fx('PRJ-0001'), OWNER)).map((f) => f.flowId)).not.toContain(TRIAL)
    expect((await flowService.listRows(fx('PRJ-0001'), OWNER)).map((f) => f.flowId)).not.toContain(TRIAL)
    await expectError(flowService.get(TRIAL, OWNER), 'NOT_FOUND')
    expect((await svc.list({ pageSize: 1000, statuses: ['APPROVED'] }, OWNER)).items.map((r) => r.referenceNo)).not.toContain(S(26))
    await expectError(svc.get(C(26), OWNER), 'NOT_FOUND', `Verification ${C(26)} not found.`)
    expect((await svc.filterOptions(OWNER)).flows.map((f) => f.flowId)).not.toContain(TRIAL)
    expect((await analyticsService.filters(OWNER)).flows.map((f) => f.flowId)).not.toContain(TRIAL)
    expect((await analyticsService.billing({ period: month }, OWNER)).lines.map((l) => l.referenceNo)).not.toContain(S(26))
  })

  it('Given the super admin, then he sees both; the test session costs no tokens (DEC-60)', async () => {
    expect((await flowService.list(fx('PRJ-0001'), ADMIN)).map((f) => f.flowId)).toContain(TRIAL)
    expect((await svc.get(C(26), ADMIN)).referenceNo).toBe(S(26))
    expect((await analyticsService.billing({ period: month }, ADMIN)).lines.find((l) => l.referenceNo === S(26))).toMatchObject({ tokens: 0, cost: 0 })
  })

  it('Given the overview, then the Owner’s totals leave the test session out', async () => {
    const owner = await analyticsService.overview({ days: 90, projectIds: [fx('PRJ-0001')] }, OWNER)
    const admin = await analyticsService.overview({ days: 90, projectIds: [fx('PRJ-0001')] }, ADMIN)
    expect(admin.total - owner.total).toBe(1)
  })
})

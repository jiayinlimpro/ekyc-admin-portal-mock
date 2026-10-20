// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Actor, AuditAction, FlowSettings } from '@/domain/types'
import { db } from '@/mocks/mockDb'
import { ADMIN, ALI, HAFIZ, NOW, OWNER, SITI } from '@/test/factories'
import { auditService } from './auditService'
import { devService } from './devService'
import { isServiceError } from './errors'
import { flowService } from './flowService'
import { projectService } from './projectService'
import { roleService } from './roleService'
import { userAdminService } from './userAdminService'
import { verificationService } from './verificationService'

const VANTAGE_OWNER: Actor = { userId: 'USR-2026-0045', fullName: 'Ahmad Faiz Bin Zulkifli' }

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  await devService.resetDemoData()
})

async function expectError(p: Promise<unknown>, code: string, message?: string | RegExp) {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  )
  expect(isServiceError(e), 'expected a ServiceError').toBe(true)
  expect(e).toMatchObject({ code })
  if (message) expect((e as Error).message).toMatch(message)
}

const lastAudit = async (action: AuditAction) => (await auditService.list({ actions: [action] }, ADMIN)).items[0]

describe('projectService (DEC-92, DEC-93, DEC-96)', () => {
  it('Given each user, then "my projects" lists the projects they can reach with their roles in each', async () => {
    expect((await projectService.listMine(ALI)).map((p) => [p.projectId, p.roles])).toEqual([
      ['PRJ-0001', ['Reviewer']],
      ['PRJ-0002', ['Viewer']],
    ])
    expect((await projectService.listMine(HAFIZ)).map((p) => p.projectId)).toEqual(['PRJ-0002'])
    const admin = await projectService.listMine(ADMIN)
    expect(admin).toHaveLength(db.state().projects.length)
    expect(admin.every((p) => p.roles.join() === 'Platform Admin')).toBe(true)
  })

  it('Given the Merchant Owner creates a project, then it starts with a Draft default flow on the registry default (MOCK-12), audited', async () => {
    const p = await projectService.create('MER-0001', { name: 'Branch kiosks' }, OWNER)
    expect(p).toMatchObject({ projectId: 'PRJ-0010', merchantId: 'MER-0001', status: 'ACTIVE', isDefault: false, defaultFlowId: 'FLW-0014', claimTimeoutMin: 30 })
    const flow = db.state().flows.find((f) => f.flowId === 'FLW-0014')!
    expect(flow).toMatchObject({ projectId: 'PRJ-0010', status: 'DRAFT', workflowVersion: 'V1', revision: 0 })
    expect(await lastAudit('PROJECT_CREATED')).toMatchObject({ actorRole: 'Merchant Owner', projectId: 'PRJ-0010', details: { name: 'Branch kiosks' } })
    expect((await projectService.listMine(OWNER)).map((x) => x.projectId)).toContain('PRJ-0010')
  })

  it('Given a duplicate name, a Project Admin, or another merchant, then the create is refused', async () => {
    await expectError(projectService.create('MER-0001', { name: ' sme APP ' }, OWNER), 'VALIDATION', 'A project with this name already exists')
    await expectError(projectService.create('MER-0001', { name: 'Kiosks' }, HAFIZ), 'FORBIDDEN')
    await expectError(projectService.create('MER-0001', { name: 'Kiosks' }, VANTAGE_OWNER), 'NOT_FOUND')
  })

  it('Given a rename, then old and new names are audited; a Project Admin may not rename', async () => {
    await projectService.rename('PRJ-0002', 'SME onboarding', ADMIN)
    expect(await lastAudit('PROJECT_RENAMED')).toMatchObject({ actorRole: 'Platform Admin', details: { changes: [{ field: 'Name', from: 'SME app', to: 'SME onboarding' }] } })
    await expectError(projectService.rename('PRJ-0002', 'Mine now', HAFIZ), 'FORBIDDEN')
    await expectError(projectService.get('PRJ-0001', HAFIZ), 'NOT_FOUND')
  })

  it("Given the merchant's only active project, then it can't be archived; another project can, and stays reviewable", async () => {
    await expectError(projectService.archive('PRJ-0003', VANTAGE_OWNER), 'VALIDATION', /only active project/)
    expect((await projectService.archive('PRJ-0002', OWNER)).status).toBe('ARCHIVED')
    expect((await verificationService.get('KYC-260901-900016', OWNER)).status).toBe('PENDING_REVIEW') // DEC-93
    await expectError(flowService.create('PRJ-0002', { name: 'Late flow', description: '', workflowVersion: 'V3' }, OWNER), 'VALIDATION', /archived/)
  })
})

describe('flowService access (DEC-70, DEC-75)', () => {
  it('Given a Reviewer, then Flows are refused; outside the project they are "not found"', async () => {
    await expectError(flowService.list('PRJ-0001', ALI), 'FORBIDDEN')
    await expectError(flowService.list('PRJ-0001', HAFIZ), 'NOT_FOUND')
    expect((await flowService.list('PRJ-0002', HAFIZ)).map((f) => f.flowId)).toEqual(['FLW-0004'])
  })

  it('Given the Platform Admin, then they manage flows in any merchant; Draft registry versions are never selectable (DEC-56)', async () => {
    const f = await flowService.create('PRJ-0003', { name: 'Students', description: 'University sign-ups', workflowVersion: 'V3' }, ADMIN)
    expect(f).toMatchObject({ projectId: 'PRJ-0003', merchantId: 'MER-0002', status: 'DRAFT', workflowVersion: 'V3' })
    expect(f.settings.checks.LIVENESS.threshold).toEqual({ preset: 'STANDARD' })
    await expectError(flowService.create('PRJ-0003', { name: 'Next gen', description: '', workflowVersion: 'V5' }, ADMIN), 'VALIDATION', 'Choose an active workflow version.')
  })
})

describe('flowService settings and lifecycle (DEC-51 … DEC-53, DEC-94)', () => {
  const withLiveness = (s: FlowSettings, preset: 'LOW' | 'HIGH'): FlowSettings => ({ ...s, checks: { ...s.checks, LIVENESS: { ...s.checks.LIVENESS, threshold: { preset } } } })

  it('Given an Active flow, when saved without a reason, then refused; with a reason, then revision R3 and an audited change; old cases keep their revision', async () => {
    const { flow } = await flowService.get('FLW-0001', OWNER)
    const next = { name: flow.name, description: flow.description, settings: withLiveness(flow.settings, 'HIGH') }
    await expectError(flowService.save('FLW-0001', next, 'short', OWNER), 'VALIDATION', /Reason for change is required/)
    const saved = await flowService.save('FLW-0001', next, 'Raise liveness after review', OWNER)
    expect(saved.revision).toBe(3)
    const detail = await flowService.get('FLW-0001', OWNER)
    expect(detail.revisions.map((r) => r.revision)).toEqual([1, 2, 3])
    expect(detail.revisions[2]).toMatchObject({ reason: 'Raise liveness after review', savedBy: { userId: OWNER.userId } })
    expect(await lastAudit('FLOW_SETTING_CHANGED')).toMatchObject({
      actorRole: 'Merchant Owner',
      details: { flowId: 'FLW-0001', revision: 3, changes: [{ field: 'checks.LIVENESS.threshold', from: 'Standard (reject < 70, approve ≥ 85)', to: 'High (reject < 80, approve ≥ 92)' }] },
    })
    expect((await verificationService.get('KYC-260901-900012', ALI)).configRevision).toBe(1) // DEC-52
  })

  it('Given a Custom role with Manage flows but not Change verification level, then only the other settings save (DEC-70)', async () => {
    const editor = await roleService.create('MER-0001', { name: 'Flow editor', permissions: ['MANAGE_FLOWS'] }, OWNER)
    await userAdminService.addAssignment(SITI.userId, { roleId: editor.roleId, scope: { kind: 'PROJECTS', projectIds: ['PRJ-0001'] } }, OWNER)
    const { flow } = await flowService.get('FLW-0001', SITI)
    const base = { name: flow.name, description: flow.description }
    await expectError(flowService.save('FLW-0001', { ...base, settings: withLiveness(flow.settings, 'HIGH') }, 'Raise liveness after review', SITI), 'FORBIDDEN', /verification level/)
    expect((await flowService.save('FLW-0001', { ...base, settings: { ...flow.settings, cooldownMin: 30 } }, 'Shorter cooldown for retries', SITI)).settings.cooldownMin).toBe(30)
  })

  it('Given Advanced values, then only the Platform Admin may set them (DEC-19)', async () => {
    const { flow } = await flowService.get('FLW-0004', OWNER)
    const settings = { ...flow.settings, checks: { ...flow.settings.checks, FACE_MATCH: { ...flow.settings.checks.FACE_MATCH, threshold: { preset: 'ADVANCED' as const, autoReject: 80, autoPass: 90 } } } }
    const next = { name: flow.name, description: flow.description, settings }
    await expectError(flowService.save('FLW-0004', next, 'Custom band for directors', OWNER), 'VALIDATION', 'Only Platform Admin can set Advanced thresholds')
    expect((await flowService.save('FLW-0004', next, 'Custom band for directors', ADMIN)).settings.checks.FACE_MATCH.threshold).toMatchObject({ preset: 'ADVANCED' })
  })

  it('Given a new Draft, then it saves freely, activates only when complete, and the first activation records R1', async () => {
    const f = await flowService.create('PRJ-0001', { name: 'Students', description: '', workflowVersion: 'V4' }, OWNER)
    await expectError(flowService.activate(f.flowId, OWNER), 'VALIDATION')
    await flowService.save(f.flowId, { name: f.name, description: 'University sign-ups', settings: { ...f.settings, sessionExpiryMin: 30, acceptedDocuments: ['MYKAD'] } }, '', OWNER)
    const active = await flowService.activate(f.flowId, OWNER)
    expect(active).toMatchObject({ status: 'ACTIVE', revision: 1 })
    expect((await flowService.get(f.flowId, OWNER)).revisions).toMatchObject([{ revision: 1, reason: 'Activated' }])
    expect(await lastAudit('FLOW_ACTIVATED')).toMatchObject({ details: { flowId: f.flowId, revision: 1 } })
  })

  it('Given the default flow, then it cannot be retired until another flow is the default', async () => {
    await expectError(flowService.retire('FLW-0001', OWNER), 'VALIDATION', 'Choose a new default flow before retiring this one.')
    expect((await flowService.setDefault('FLW-0002', OWNER)).defaultFlowId).toBe('FLW-0002')
    expect(await lastAudit('FLOW_DEFAULT_CHANGED')).toMatchObject({ details: { changes: [{ field: 'Default flow', from: 'FLW-0001', to: 'FLW-0002' }] } })
    expect((await flowService.retire('FLW-0001', OWNER)).status).toBe('RETIRING') // it has cases in flight
  })

  it('Given a Retiring flow, when its last in-flight case is decided, then it becomes Inactive (SYSTEM, audited)', async () => {
    // Make S10 (pending, unclaimed) the last in-flight case of FLW-0002, a non-default flow.
    const ref = 'KYC-260901-900010'
    db.setState((st) => ({
      verifications: st.verifications.map((v) =>
        v.flowId === 'FLW-0002' && v.referenceNo !== ref ? (v.status === 'PROCESSING' || v.status === 'PENDING_REVIEW' ? { ...v, status: 'APPROVED' as const } : v) : v.referenceNo === ref ? { ...v, flowId: 'FLW-0002' } : v,
      ),
    }))
    expect((await flowService.retire('FLW-0002', OWNER)).status).toBe('RETIRING')
    await verificationService.claim(ref, SITI)
    await verificationService.decide(ref, SITI, { outcome: 'APPROVE', note: 'Same person.' })
    expect(db.state().flows.find((f) => f.flowId === 'FLW-0002')!.status).toBe('INACTIVE')
    expect(await lastAudit('FLOW_RETIRED')).toMatchObject({ actor: { kind: 'SYSTEM' }, details: { changes: [{ field: 'Status', from: 'RETIRING', to: 'INACTIVE' }] } })
  })

  it('Given a what-if with High liveness, then the preview counts finished sessions only and changes nothing (MOCK-10)', async () => {
    const { flow } = await flowService.get('FLW-0001', OWNER)
    const before = JSON.stringify(db.state().verifications)
    const r = await flowService.preview('FLW-0001', withLiveness(flow.settings, 'HIGH'), OWNER)
    expect(r.total).toBeGreaterThan(0)
    expect(r.before.PROCESSING + r.before.APPROVED + r.before.PENDING_REVIEW + r.before.REJECTED).toBe(r.total)
    expect(r.after.APPROVED).toBeLessThanOrEqual(r.before.APPROVED) // stricter liveness never approves more
    expect(JSON.stringify(db.state().verifications)).toBe(before)
  })

  it('Given a Retiring flow, then its settings are read-only', async () => {
    const { flow } = await flowService.get('FLW-0008', ADMIN) // Boring "Express (pilot)", retiring
    await expectError(flowService.save('FLW-0008', { name: 'Renamed', description: flow.description, settings: flow.settings }, 'Rename the pilot flow', ADMIN), 'VALIDATION', 'Retiring and inactive flows are read-only.')
  })
})

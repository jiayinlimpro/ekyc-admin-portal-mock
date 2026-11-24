// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Actor, AuditAction, FlowSettings } from '@/domain/types'
import { db } from '@/mocks/mockDb'
import { ADMIN, ALI, HAFIZ, NOW, OWNER, SITI } from '@/test/factories'
import { auditService } from './auditService'
import { devService } from './devService'
import { isServiceError } from './errors'
import { registryService } from './registryService'
import { flowService } from './flowService'
import { projectService } from './projectService'
import { roleService } from './roleService'
import { userAdminService } from './userAdminService'
import { verificationService } from './verificationService'
import { fx, verificationIdOf } from '@/lib/ids'

const VANTAGE_OWNER: Actor = { userId: fx('USR-2026-0045'), fullName: 'Ahmad Faiz Bin Zulkifli' }

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
      [fx('PRJ-0001'), ['Reviewer']],
      [fx('PRJ-0002'), ['Viewer']],
    ])
    expect((await projectService.listMine(HAFIZ)).map((p) => p.projectId)).toEqual([fx('PRJ-0002')])
    const admin = await projectService.listMine(ADMIN)
    expect(admin).toHaveLength(db.state().projects.length)
    expect(admin.every((p) => p.roles.join() === 'Super admin')).toBe(true)
  })

  it('Given the Owner creates a project, then it starts with one Draft “First flow” on the registry default (MOCK-12), audited', async () => {
    const p = await projectService.create(fx('MER-0001'), { name: 'Branch kiosks' }, OWNER)
    expect(p).toMatchObject({ projectId: expect.stringMatching(/^prj_/), merchantId: fx('MER-0001'), status: 'ACTIVE', isDefault: false, claimTimeoutSec: 1800 })
    expect(db.state().flows.filter((f) => f.projectId === p.projectId)).toMatchObject([{ name: 'First flow', status: 'DRAFT', workflowVersion: 'W1', revision: 0 }])
    expect(await lastAudit('PROJECT_CREATED')).toMatchObject({ actorRole: 'Owner', projectId: p.projectId, details: { name: 'Branch kiosks' } })
    expect((await projectService.listMine(OWNER)).map((x) => x.projectId)).toContain(p.projectId)
  })

  it('Given a duplicate name, a Project Admin, or another merchant, then the create is refused', async () => {
    await expectError(projectService.create(fx('MER-0001'), { name: ' sme APP ' }, OWNER), 'VALIDATION', 'A project with this name already exists')
    await expectError(projectService.create(fx('MER-0001'), { name: 'Kiosks' }, HAFIZ), 'FORBIDDEN')
    await expectError(projectService.create(fx('MER-0001'), { name: 'Kiosks' }, VANTAGE_OWNER), 'NOT_FOUND')
  })

  it('Given a rename, then old and new names are audited; a Project Admin may not rename', async () => {
    await projectService.rename(fx('PRJ-0002'), 'SME onboarding', ADMIN)
    expect(await lastAudit('PROJECT_RENAMED')).toMatchObject({ actorRole: 'Super admin', details: { changes: [{ field: 'Name', from: 'SME app', to: 'SME onboarding' }] } })
    await expectError(projectService.rename(fx('PRJ-0002'), 'Mine now', HAFIZ), 'FORBIDDEN')
    await expectError(projectService.get(fx('PRJ-0001'), HAFIZ), 'NOT_FOUND')
  })

  it("Given the merchant's only active project, then it can't be archived; another project can, and stays reviewable", async () => {
    await expectError(projectService.archive(fx('PRJ-0003'), VANTAGE_OWNER), 'VALIDATION', /only active project/)
    expect((await projectService.archive(fx('PRJ-0002'), OWNER)).status).toBe('ARCHIVED')
    expect((await verificationService.get(verificationIdOf('KYC-260901-900016'), OWNER)).status).toBe('PENDING_REVIEW') // DEC-93
    await expectError(flowService.create(fx('PRJ-0002'), { name: 'Late flow', description: '', workflowVersion: 'W3' }, OWNER), 'VALIDATION', /archived/)
  })
})

describe('flowService access (DEC-70, DEC-75)', () => {
  it('Given a Reviewer, then Flows are read-only (DEC-104: Flows View); outside the project they are "not found"', async () => {
    expect((await flowService.list(fx('PRJ-0001'), ALI)).length).toBeGreaterThan(0)
    await expectError(flowService.create(fx('PRJ-0001'), { name: 'Not mine', description: '', workflowVersion: 'W3' }, ALI), 'FORBIDDEN')
    await expectError(flowService.list(fx('PRJ-0001'), HAFIZ), 'NOT_FOUND')
    expect((await flowService.list(fx('PRJ-0002'), HAFIZ)).map((f) => f.flowId)).toEqual([fx('FLW-0004')])
  })

  it('Given the Super admin, then they manage flows in any merchant; Draft registry versions are never selectable (DEC-56)', async () => {
    const f = await flowService.create(fx('PRJ-0003'), { name: 'Students', description: 'University sign-ups', workflowVersion: 'W3' }, ADMIN)
    expect(f).toMatchObject({ projectId: fx('PRJ-0003'), merchantId: fx('MER-0002'), status: 'DRAFT', workflowVersion: 'W3' })
    expect(f.settings.checks.LIVENESS.threshold).toEqual({ preset: 'STANDARD' })
    const v5 = db.state().registry.find((e) => e.code === 'W5')!
    await registryService.register({ code: 'W7', name: 'Next gen', definition: v5.definition.replace('"W5"', '"W7"'), accessMerchantIds: [] }, ADMIN)
    await expectError(flowService.create(fx('PRJ-0003'), { name: 'Next gen', description: '', workflowVersion: 'W7' }, ADMIN), 'VALIDATION', 'Choose a workflow version available to this merchant.')
    // REQ: DEC-56 — Internal testing (W6): internal users anywhere, never a merchant; Limited release (W5): Atoz, besides internal users.
    expect(await flowService.create(fx('PRJ-0003'), { name: 'Engine trial', description: '', workflowVersion: 'W6' }, ADMIN)).toMatchObject({ workflowVersion: 'W6' })
    await expectError(flowService.create(fx('PRJ-0001'), { name: 'Sneak peek', description: '', workflowVersion: 'W6' }, OWNER), 'VALIDATION', 'Choose a workflow version available to this merchant.')
    expect(await flowService.create(fx('PRJ-0001'), { name: 'Premium two', description: '', workflowVersion: 'W5' }, OWNER)).toMatchObject({ workflowVersion: 'W5' })
  })
})

describe('flowService settings and lifecycle (DEC-51 … DEC-53, DEC-94)', () => {
  const withLiveness = (s: FlowSettings, preset: 'LOW' | 'HIGH'): FlowSettings => ({ ...s, checks: { ...s.checks, LIVENESS: { ...s.checks.LIVENESS, threshold: { preset } } } })

  it('Given an Active flow, when saved without a reason, then refused; with a reason, then revision R3 and an audited change; old cases keep their revision', async () => {
    const { flow } = await flowService.get(fx('FLW-0001'), OWNER)
    const next = { name: flow.name, description: flow.description, settings: withLiveness(flow.settings, 'HIGH') }
    await expectError(flowService.save(fx('FLW-0001'), next, 'short', OWNER), 'VALIDATION', /Reason for change is required/)
    const saved = await flowService.save(fx('FLW-0001'), next, 'Raise liveness after review', OWNER)
    expect(saved.revision).toBe(3)
    const detail = await flowService.get(fx('FLW-0001'), OWNER)
    expect(detail.revisions.map((r) => r.revision)).toEqual([1, 2, 3])
    expect(detail.revisions[2]).toMatchObject({ reason: 'Raise liveness after review', savedBy: { userId: OWNER.userId } })
    expect(await lastAudit('FLOW_SETTING_CHANGED')).toMatchObject({
      actorRole: 'Owner',
      details: { flowId: fx('FLW-0001'), revision: 3, changes: [{ field: 'checks.LIVENESS.threshold', from: 'Standard (reject < 70, approve ≥ 85)', to: 'High (reject < 80, approve ≥ 92)' }] },
    })
    expect((await verificationService.get(verificationIdOf('KYC-260901-900012'), ALI)).configRevision).toBe(1) // DEC-52
  })

  it('Given a Custom role with Flows Edit but not Change verification level, then only the other settings save (DEC-70)', async () => {
    const editor = await roleService.create(fx('MER-0001'), { name: 'Flow editor', permissions: ['EDIT_FLOWS'], projectId: fx('PRJ-0001') }, OWNER)
    await userAdminService.addMember(fx('PRJ-0001'), SITI.userId, editor.roleId, OWNER)
    const { flow } = await flowService.get(fx('FLW-0001'), SITI)
    const base = { name: flow.name, description: flow.description }
    await expectError(flowService.save(fx('FLW-0001'), { ...base, settings: withLiveness(flow.settings, 'HIGH') }, 'Raise liveness after review', SITI), 'FORBIDDEN', /verification level/)
    expect((await flowService.save(fx('FLW-0001'), { ...base, settings: { ...flow.settings, cooldownMin: 30 } }, 'Shorter cooldown for retries', SITI)).settings.cooldownMin).toBe(30)
  })

  it('Given Advanced values, then only the Super admin may set them (DEC-19)', async () => {
    const { flow } = await flowService.get(fx('FLW-0004'), OWNER)
    const settings = { ...flow.settings, checks: { ...flow.settings.checks, FACE_MATCH: { ...flow.settings.checks.FACE_MATCH, threshold: { preset: 'ADVANCED' as const, autoReject: 80, autoPass: 90 } } } }
    const next = { name: flow.name, description: flow.description, settings }
    await expectError(flowService.save(fx('FLW-0004'), next, 'Custom band for directors', OWNER), 'VALIDATION', 'Only Super admin can set Advanced thresholds')
    expect((await flowService.save(fx('FLW-0004'), next, 'Custom band for directors', ADMIN)).settings.checks.FACE_MATCH.threshold).toMatchObject({ preset: 'ADVANCED' })
  })

  it('Given a new Draft, then it saves freely, activates only when complete, and the first activation records R1', async () => {
    const f = await flowService.create(fx('PRJ-0001'), { name: 'Students', description: '', workflowVersion: 'W4' }, OWNER)
    await expectError(flowService.activate(f.flowId, OWNER), 'VALIDATION')
    await flowService.save(f.flowId, { name: f.name, description: 'University sign-ups', settings: { ...f.settings, sessionExpiryMin: 30, acceptedDocuments: ['MYKAD'] } }, '', OWNER)
    const active = await flowService.activate(f.flowId, OWNER)
    expect(active).toMatchObject({ status: 'ACTIVE', revision: 1 })
    expect((await flowService.get(f.flowId, OWNER)).revisions).toMatchObject([{ revision: 1, reason: 'Activated' }])
    expect(await lastAudit('FLOW_ACTIVATED')).toMatchObject({ details: { flowId: f.flowId, revision: 1 } })
  })

  it('Given any Active flow, when retired, then allowed with no default to change first (DEC-95); with cases in flight it goes Retiring', async () => {
    expect((await flowService.retire(fx('FLW-0001'), OWNER)).status).toBe('RETIRING')
    expect(await lastAudit('FLOW_RETIRED')).toMatchObject({ details: { flowId: fx('FLW-0001'), changes: [{ field: 'Status', from: 'ACTIVE', to: 'RETIRING' }] } })
  })

  it('Given a Retiring flow, when its last in-flight case is decided, then it becomes Inactive (SYSTEM, audited)', async () => {
    // Make S10 (pending, unclaimed) the last in-flight case of FLW-0002.
    const ref = verificationIdOf('KYC-260901-900010')
    db.setState((st) => ({
      verifications: st.verifications.map((v) =>
        v.flowId === fx('FLW-0002') && v.verificationId !== ref ? (v.status === 'PROCESSING' || v.status === 'PENDING_REVIEW' ? { ...v, status: 'APPROVED' as const } : v) : v.verificationId === ref ? { ...v, flowId: fx('FLW-0002') } : v,
      ),
    }))
    expect((await flowService.retire(fx('FLW-0002'), OWNER)).status).toBe('RETIRING')
    await verificationService.claim(ref, SITI)
    await verificationService.decide(ref, SITI, { outcome: 'APPROVE', reasonCodes: ['FACE_CONFIRMED'], note: 'Same person.' })
    expect(db.state().flows.find((f) => f.flowId === fx('FLW-0002'))!.status).toBe('INACTIVE')
    expect(await lastAudit('FLOW_RETIRED')).toMatchObject({ actor: { kind: 'SYSTEM' }, details: { changes: [{ field: 'Status', from: 'RETIRING', to: 'INACTIVE' }] } })
  })

  it('Given a Retiring flow, then its settings are read-only', async () => {
    const { flow } = await flowService.get(fx('FLW-0008'), ADMIN) // Boring "Express (pilot)", retiring
    await expectError(flowService.save(fx('FLW-0008'), { name: 'Renamed', description: flow.description, settings: flow.settings }, 'Rename the pilot flow', ADMIN), 'VALIDATION', 'Retiring and inactive flows are read-only.')
  })
})

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RegistryInput } from '@/domain/registryRules'
import type { RegistryEntry } from '@/domain/types'
import { db } from '@/mocks/mockDb'
import { ADMIN, ALI, NOW, OWNER } from '@/test/factories'
import { auditService } from './auditService'
import { devService } from './devService'
import { isServiceError } from './errors'
import { flowService } from './flowService'
import { registryService } from './registryService'
import { fx } from '@/lib/ids'

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

const entry = (code: string) => db.state().registry.find((e) => e.code === code)!
const inputOf = (e: RegistryEntry, over: Partial<RegistryInput> = {}): RegistryInput => ({ code: e.code, name: e.name, definition: e.definition, accessMerchantIds: e.accessMerchantIds, ...over })
// REQ: DEC-115 — a workflow JSON as the backend hands it over.
const def = (code: string, steps: string[], tunable = ['FACE_MATCH', 'LIVENESS']) => JSON.stringify({ workflowCode: code, steps, tunable })

describe('registryService access (DEC-70)', () => {
  it('Given the Super admin, then every version with the number of flows using it; anyone else is refused', async () => {
    const rows = await registryService.list(ADMIN)
    expect(rows.map((r) => r.code)).toEqual(['V1', 'V3', 'V4', 'V5', 'V6'])
    expect(rows.find((r) => r.code === 'V4')!.flowsUsing).toBe(db.state().flows.filter((f) => f.workflowVersion === 'V4').length)
    await expectError(registryService.list(OWNER), 'FORBIDDEN')
  })

  it('Given a flow creator, then only Active versions are offered, with what the portal read but not the JSON itself (DEC-56, DEC-115)', async () => {
    const versions = await registryService.listSelectable(OWNER)
    expect(versions.map((v) => v.code)).toEqual(['V1', 'V3', 'V4', 'V5'])
    expect(versions[0]).toEqual({ code: 'V1', name: 'ID + Selfie + Liveness', phases: ['ID_CAPTURE', 'SELFIE_CAPTURE', 'LIVENESS_CHECK'], faceMatchMethod: 'ID_VS_SELFIE', configurableChecks: ['FACE_MATCH', 'LIVENESS'], riskMinimumsPerFlow: false, isDefault: true })
    expect(JSON.stringify(versions)).not.toContain('workflowCode')
    await expectError(registryService.listSelectable(ALI), 'FORBIDDEN') // Reviewer and Viewer only
  })
})

describe('registryService flows using a version (DEC-85)', () => {
  it('Given V3, then the flows on it with their project and merchant', async () => {
    const flows = await registryService.flowsUsing('V3', ADMIN)
    expect(flows.map((f) => f.flowId).sort()).toEqual(db.state().flows.filter((f) => f.workflowVersion === 'V3').map((f) => f.flowId).sort())
    expect(flows.find((f) => f.flowId === fx('FLW-0004'))).toMatchObject({ projectName: 'SME app', merchantName: 'Atoz Software Tech' })
  })
})

describe('registryService lifecycle (DEC-56, DEC-57)', () => {
  it('Given a new code, a name and its JSON, then it is registered as Draft with what the portal read; a used code is refused; the event is Super admin only (DEC-115)', async () => {
    const v7 = await registryService.register({ code: 'V7', name: 'V4 + document liveness', definition: def('V7', ['DOCUMENT', 'LIVENESS', 'RISK']), accessMerchantIds: [] }, ADMIN)
    expect(v7).toMatchObject({ code: 'V7', status: 'DRAFT', isDefault: false, phases: ['ID_CAPTURE', 'LIVENESS_CHECK', 'RISK_ASSESSMENT'], faceMatchMethod: 'ID_VS_LIVENESS', riskMinimumsPerFlow: false })
    expect(v7.definition).toBe(JSON.stringify(JSON.parse(def('V7', ['DOCUMENT', 'LIVENESS', 'RISK'])), null, 2)) // stored pretty-printed
    await expectError(registryService.register(inputOf(entry('V4'), { name: 'Copy' }), ADMIN), 'VALIDATION', 'Workflow code already exists')
    await expectError(registryService.register({ code: 'V8', name: 'Pasted the wrong one', definition: entry('V4').definition, accessMerchantIds: [] }, ADMIN), 'VALIDATION', 'This JSON is for V4, not V8.')
    expect((await auditService.list({ actions: ['WORKFLOW_REGISTERED'] }, ADMIN)).items[0]).toMatchObject({ actorRole: 'Super admin', details: { code: 'V7' } })
    expect((await auditService.list({ actions: ['WORKFLOW_REGISTERED'] }, OWNER)).total).toBe(0)
  })

  it('Given a version that has been Active, then only the name can change; its JSON is locked (DEC-115)', async () => {
    await expectError(registryService.update('V4', inputOf(entry('V4'), { definition: def('V4', ['DOCUMENT', 'LIVENESS']) }), ADMIN), 'VALIDATION', 'The definition (JSON) is locked: flows may be built on this version. Register a new version code instead.')
    const renamed = await registryService.update('V4', inputOf(entry('V4'), { name: 'ID + Liveness + Risk', definition: JSON.stringify(JSON.parse(entry('V4').definition)) }), ADMIN) // the same JSON, compact: no change
    expect(renamed.name).toBe('ID + Liveness + Risk')
    expect((await auditService.list({ actions: ['WORKFLOW_UPDATED'] }, ADMIN)).items[0].details.changes).toEqual([
      { field: 'name', from: 'ID + Liveness + Risk Assessment', to: 'ID + Liveness + Risk' },
    ])
  })

  it('Given a Draft V7, then any status with a reason; its JSON can be replaced in Internal testing, and locks once Active (DEC-56, DEC-115)', async () => {
    await registryService.register({ code: 'V7', name: 'Next', definition: def('V7', ['DOCUMENT', 'LIVENESS']), accessMerchantIds: [] }, ADMIN)
    expect(await registryService.changeStatus('V7', 'INTERNAL_TESTING', 'Engine build ready', ADMIN)).toMatchObject({ status: 'INTERNAL_TESTING' })
    expect(entry('V7').activatedAt).toBeUndefined() // Internal testing keeps the JSON editable
    await registryService.update('V7', inputOf(entry('V7'), { definition: def('V7', ['DOCUMENT', 'SELFIE', 'LIVENESS']) }), ADMIN)
    expect(entry('V7')).toMatchObject({ phases: ['ID_CAPTURE', 'SELFIE_CAPTURE', 'LIVENESS_CHECK'], faceMatchMethod: 'ID_VS_SELFIE' })
    expect((await auditService.list({ actions: ['WORKFLOW_UPDATED'] }, ADMIN)).items[0].details.changes).toEqual([
      { field: 'definition', from: def('V7', ['DOCUMENT', 'LIVENESS']), to: def('V7', ['DOCUMENT', 'SELFIE', 'LIVENESS']) },
    ])
    expect((await registryService.listSelectable(OWNER)).map((v) => v.code)).not.toContain('V7') // merchants never see Internal testing
    expect((await registryService.listSelectable(ADMIN, fx('MER-0002'))).map((v) => v.code)).toContain('V7')
    const v7 = await registryService.changeStatus('V7', 'ACTIVE', 'Ready for everyone', ADMIN)
    expect(v7).toMatchObject({ status: 'ACTIVE', activatedAt: NOW.toISOString() })
    expect((await registryService.listSelectable(OWNER)).map((v) => v.code)).toContain('V7')
    await expectError(registryService.update('V7', inputOf(entry('V7'), { definition: def('V7', ['DOCUMENT', 'LIVENESS']) }), ADMIN), 'VALIDATION', /locked/)
    expect(await registryService.changeStatus('V7', 'DRAFT', 'Pulled back', ADMIN)).toMatchObject({ status: 'DRAFT' })
  })

  it('Given V5 in Limited release for Atoz, then Atoz users may choose it, internal users too, and ticking Vantage gives Vantage access (DEC-56)', async () => {
    expect(entry('V5')).toMatchObject({ status: 'LIMITED_RELEASE', accessMerchantIds: [fx('MER-0001')] })
    expect((await registryService.listSelectable(OWNER)).map((v) => v.code)).toContain('V5')
    expect((await registryService.listSelectable(ADMIN, fx('MER-0002'))).map((v) => v.code)).toContain('V5')
    await registryService.update('V5', inputOf(entry('V5'), { accessMerchantIds: [fx('MER-0001'), fx('MER-0002')] }), ADMIN)
    expect(entry('V5').accessMerchantIds).toEqual([fx('MER-0001'), fx('MER-0002')]) // editable although other fields are locked
  })

  it('Given the default moves to V3, then V1 can be deprecated and is no longer offered for new flows; V3 cannot be deprecated', async () => {
    await registryService.setDefault('V3', ADMIN)
    expect(db.state().registry.filter((e) => e.isDefault).map((e) => e.code)).toEqual(['V3'])
    await expectError(registryService.changeStatus('V3', 'DEPRECATED', 'Replaced', ADMIN), 'VALIDATION', 'Set another version as default first: the default for new merchants must stay Active.')
    await registryService.changeStatus('V1', 'DEPRECATED', 'Replaced by V3', ADMIN)
    await expectError(flowService.create(fx('PRJ-0001'), { name: 'Old style', description: '', workflowVersion: 'V1' }, OWNER), 'VALIDATION', 'Choose a workflow version available to this merchant.')
    expect((await auditService.list({ actions: ['WORKFLOW_DEFAULT_CHANGED'] }, ADMIN)).items[0].details.changes).toEqual([{ field: 'Default for new merchants', from: 'V1', to: 'V3' }])
  })
})

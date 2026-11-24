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
import { DEFAULT_RISK_MINIMUMS } from '@/domain/openQuestions'

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
    expect(rows.map((r) => r.code)).toEqual(['W1', 'W3', 'W4', 'W5', 'W6'])
    expect(rows.find((r) => r.code === 'W4')!.flowsUsing).toBe(db.state().flows.filter((f) => f.workflowVersion === 'W4').length)
    await expectError(registryService.list(OWNER), 'FORBIDDEN')
  })

  it('Given a flow creator, then only Active versions are offered, with what the portal read but not the JSON itself (DEC-56, DEC-115)', async () => {
    const versions = await registryService.listSelectable(OWNER)
    expect(versions.map((v) => v.code)).toEqual(['W1', 'W3', 'W4', 'W5'])
    expect(versions[0]).toEqual({ code: 'W1', name: 'ID + Selfie + Liveness', phases: ['ID_CAPTURE', 'SELFIE_CAPTURE', 'LIVENESS_CHECK'], faceMatchMethod: 'ID_VS_SELFIE', configurableChecks: ['FACE_MATCH', 'LIVENESS'], riskMinimumsPerFlow: false, isDefault: true })
    expect(JSON.stringify(versions)).not.toContain('workflowCode')
    await expectError(registryService.listSelectable(ALI), 'FORBIDDEN') // Reviewer and Viewer only
  })
})

describe('registryService flows using a version (DEC-85)', () => {
  it('Given W3, then the flows on it with their project and merchant', async () => {
    const flows = await registryService.flowsUsing('W3', ADMIN)
    expect(flows.map((f) => f.flowId).sort()).toEqual(db.state().flows.filter((f) => f.workflowVersion === 'W3').map((f) => f.flowId).sort())
    expect(flows.find((f) => f.flowId === fx('FLW-0004'))).toMatchObject({ projectName: 'SME app', merchantName: 'Atoz Software Tech' })
  })
})

describe('registryService lifecycle (DEC-56, DEC-57)', () => {
  it('Given a new code, a name and its JSON, then it is registered as Draft with what the portal read; a used code is refused; the event is Super admin only (DEC-115)', async () => {
    const v7 = await registryService.register({ code: 'W7', name: 'W4 + document liveness', definition: def('W7', ['DOCUMENT', 'LIVENESS', 'RISK']), accessMerchantIds: [] }, ADMIN)
    expect(v7).toMatchObject({ code: 'W7', status: 'DRAFT', isDefault: false, phases: ['ID_CAPTURE', 'LIVENESS_CHECK', 'RISK_ASSESSMENT'], faceMatchMethod: 'ID_VS_LIVENESS', riskMinimumsPerFlow: false })
    expect(v7.definition).toBe(JSON.stringify(JSON.parse(def('W7', ['DOCUMENT', 'LIVENESS', 'RISK'])), null, 2)) // stored pretty-printed
    await expectError(registryService.register(inputOf(entry('W4'), { name: 'Copy' }), ADMIN), 'VALIDATION', 'Workflow code already exists')
    await expectError(registryService.register({ code: 'W8', name: 'Pasted the wrong one', definition: entry('W4').definition, accessMerchantIds: [] }, ADMIN), 'VALIDATION', 'This JSON is for W4, not W8.')
    expect((await auditService.list({ actions: ['WORKFLOW_REGISTERED'] }, ADMIN)).items[0]).toMatchObject({ actorRole: 'Super admin', details: { code: 'W7' } })
    expect((await auditService.list({ actions: ['WORKFLOW_REGISTERED'] }, OWNER)).total).toBe(0)
  })

  it('Given Active W4 used by flows, then its definition can change with a reason, audited with the old and new JSON; its flows get the risk default if they lacked it (DEC-115)', async () => {
    await expectError(registryService.update('W4', inputOf(entry('W4'), { definition: def('W4', ['DOCUMENT', 'LIVENESS']) }), ADMIN), 'VALIDATION', /Reason for change is required: \d+ flow\(s\) use this version\./)
    await registryService.update('W4', inputOf(entry('W4'), { definition: def('W4', ['DOCUMENT', 'SELFIE', 'LIVENESS', 'RISK']), reason: 'Engine adds a selfie step' }), ADMIN)
    expect(entry('W4')).toMatchObject({ status: 'ACTIVE', phases: ['ID_CAPTURE', 'SELFIE_CAPTURE', 'LIVENESS_CHECK', 'RISK_ASSESSMENT'], faceMatchMethod: 'ID_VS_SELFIE' })
    expect((await auditService.list({ actions: ['WORKFLOW_UPDATED'] }, ADMIN)).items[0].details).toMatchObject({ reason: 'Engine adds a selfie step', changes: [{ field: 'definition' }] })
    // REQ: DEC-115 — W3 gains a risk step: its flows show (and run on) the default minimums until saved.
    await registryService.update('W3', inputOf(entry('W3'), { definition: def('W3', ['DOCUMENT', 'LIVENESS', 'RISK']), reason: 'Risk for everyone' }), ADMIN)
    expect((await flowService.get(fx('FLW-0004'), ADMIN)).flow.settings.risk).toEqual({ enabled: true, minimums: DEFAULT_RISK_MINIMUMS })
  })

  it('Given a rename, then no reason is needed', async () => {
    const renamed = await registryService.update('W4', inputOf(entry('W4'), { name: 'ID + Liveness + Risk', definition: JSON.stringify(JSON.parse(entry('W4').definition)) }), ADMIN) // the same JSON, compact: no change
    expect(renamed.name).toBe('ID + Liveness + Risk')
    expect((await auditService.list({ actions: ['WORKFLOW_UPDATED'] }, ADMIN)).items[0].details.changes).toEqual([
      { field: 'name', from: 'ID + Liveness + Risk Assessment', to: 'ID + Liveness + Risk' },
    ])
  })

  it('Given a Draft W7, then any status with a reason; its definition can be replaced at any status (DEC-56, DEC-115)', async () => {
    await registryService.register({ code: 'W7', name: 'Next', definition: def('W7', ['DOCUMENT', 'LIVENESS']), accessMerchantIds: [] }, ADMIN)
    expect(await registryService.changeStatus('W7', 'INTERNAL_TESTING', 'Engine build ready', ADMIN)).toMatchObject({ status: 'INTERNAL_TESTING' })
    expect(entry('W7').activatedAt).toBeUndefined() // Internal testing keeps the JSON editable
    await registryService.update('W7', inputOf(entry('W7'), { definition: def('W7', ['DOCUMENT', 'SELFIE', 'LIVENESS']) }), ADMIN)
    expect(entry('W7')).toMatchObject({ phases: ['ID_CAPTURE', 'SELFIE_CAPTURE', 'LIVENESS_CHECK'], faceMatchMethod: 'ID_VS_SELFIE' })
    expect((await auditService.list({ actions: ['WORKFLOW_UPDATED'] }, ADMIN)).items[0].details.changes).toEqual([
      { field: 'definition', from: def('W7', ['DOCUMENT', 'LIVENESS']), to: def('W7', ['DOCUMENT', 'SELFIE', 'LIVENESS']) },
    ])
    expect((await registryService.listSelectable(OWNER)).map((v) => v.code)).not.toContain('W7') // merchants never see Internal testing
    expect((await registryService.listSelectable(ADMIN, fx('MER-0002'))).map((v) => v.code)).toContain('W7')
    const v7 = await registryService.changeStatus('W7', 'ACTIVE', 'Ready for everyone', ADMIN)
    expect(v7).toMatchObject({ status: 'ACTIVE', activatedAt: NOW.toISOString() })
    expect((await registryService.listSelectable(OWNER)).map((v) => v.code)).toContain('W7')
    await registryService.update('W7', inputOf(entry('W7'), { definition: def('W7', ['DOCUMENT', 'LIVENESS']) }), ADMIN) // Active, no flows yet: no reason needed
    expect(await registryService.changeStatus('W7', 'DRAFT', 'Pulled back', ADMIN)).toMatchObject({ status: 'DRAFT' })
  })

  it('Given W5 in Limited release for Atoz, then Atoz users may choose it, internal users too, and ticking Vantage gives Vantage access (DEC-56)', async () => {
    expect(entry('W5')).toMatchObject({ status: 'LIMITED_RELEASE', accessMerchantIds: [fx('MER-0001')] })
    expect((await registryService.listSelectable(OWNER)).map((v) => v.code)).toContain('W5')
    expect((await registryService.listSelectable(ADMIN, fx('MER-0002'))).map((v) => v.code)).toContain('W5')
    await registryService.update('W5', inputOf(entry('W5'), { accessMerchantIds: [fx('MER-0001'), fx('MER-0002')] }), ADMIN)
    expect(entry('W5').accessMerchantIds).toEqual([fx('MER-0001'), fx('MER-0002')]) // editable although other fields are locked
  })

  it('Given the default moves to W3, then W1 can be deprecated and is no longer offered for new flows; W3 cannot be deprecated', async () => {
    await registryService.setDefault('W3', ADMIN)
    expect(db.state().registry.filter((e) => e.isDefault).map((e) => e.code)).toEqual(['W3'])
    await expectError(registryService.changeStatus('W3', 'DEPRECATED', 'Replaced', ADMIN), 'VALIDATION', 'Set another version as default first: the default for new merchants must stay Active.')
    await registryService.changeStatus('W1', 'DEPRECATED', 'Replaced by W3', ADMIN)
    await expectError(flowService.create(fx('PRJ-0001'), { name: 'Old style', description: '', workflowVersion: 'W1' }, OWNER), 'VALIDATION', 'Choose a workflow version available to this merchant.')
    expect((await auditService.list({ actions: ['WORKFLOW_DEFAULT_CHANGED'] }, ADMIN)).items[0].details.changes).toEqual([{ field: 'Default for new merchants', from: 'W1', to: 'W3' }])
  })
})

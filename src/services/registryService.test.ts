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
const inputOf = (e: RegistryEntry, over: Partial<RegistryInput> = {}): RegistryInput => ({
  code: e.code,
  name: e.name,
  description: e.description,
  phases: e.phases,
  faceMatchMethod: e.faceMatchMethod,
  requiredInputs: e.requiredInputs,
  configurableChecks: e.configurableChecks,
  riskMinimumsPerFlow: e.riskMinimumsPerFlow,
  accessMerchantIds: e.accessMerchantIds,
  stateMachineSandbox: e.stateMachineSandbox,
  stateMachineProduction: e.stateMachineProduction,
  releaseNote: 'Test change',
  ...over,
})
const ARN = (env: string) => `arn:aws:states:ap-southeast-1:123456789012:stateMachine:ekyc_${env}_onboard_v5`

describe('registryService access (DEC-70)', () => {
  it('Given the Super admin, then every version with the number of flows using it; anyone else is refused', async () => {
    const rows = await registryService.list(ADMIN)
    expect(rows.map((r) => r.code)).toEqual(['V1', 'V3', 'V4', 'V5', 'V6'])
    expect(rows.find((r) => r.code === 'V4')!.flowsUsing).toBe(db.state().flows.filter((f) => f.workflowVersion === 'V4').length)
    await expectError(registryService.list(OWNER), 'FORBIDDEN')
  })

  it('Given a flow creator, then only Active versions are offered, without state machine references (DEC-56)', async () => {
    const versions = await registryService.listSelectable(OWNER)
    expect(versions.map((v) => v.code)).toEqual(['V1', 'V3', 'V4', 'V5'])
    expect(JSON.stringify(versions)).not.toContain('stateMachine')
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
  it('Given a new code, then it is registered as Draft; a used code is refused; the event is Super admin only', async () => {
    const v7 = await registryService.register(inputOf(entry('V4'), { code: 'V7', name: 'V4 + document liveness', releaseNote: 'First draft' }), ADMIN)
    expect(v7).toMatchObject({ code: 'V7', status: 'DRAFT', isDefault: false, releaseNotes: [{ text: 'First draft', by: 'Lim Wei Jie' }] })
    await expectError(registryService.register(inputOf(entry('V4'), { name: 'Copy' }), ADMIN), 'VALIDATION', 'Workflow code already exists')
    expect((await auditService.list({ actions: ['WORKFLOW_REGISTERED'] }, ADMIN)).items[0]).toMatchObject({ actorRole: 'Super admin', details: { code: 'V7' } })
    expect((await auditService.list({ actions: ['WORKFLOW_REGISTERED'] }, OWNER)).total).toBe(0)
  })

  it('Given a version that has been Active, then only name, description and state machines can change', async () => {
    await expectError(registryService.update('V4', inputOf(entry('V4'), { phases: ['ID_CAPTURE', 'LIVENESS_CHECK'] }), ADMIN), 'VALIDATION', /locked/)
    const renamed = await registryService.update('V4', inputOf(entry('V4'), { name: 'ID + Liveness + Risk', releaseNote: 'Shorter name' }), ADMIN)
    expect(renamed.name).toBe('ID + Liveness + Risk')
    expect(renamed.releaseNotes.at(-1)!.text).toBe('Shorter name')
    expect((await auditService.list({ actions: ['WORKFLOW_UPDATED'] }, ADMIN)).items[0].details.changes).toEqual([
      { field: 'name', from: 'ID + Liveness + Risk Assessment', to: 'ID + Liveness + Risk' },
    ])
  })

  it('Given a Draft V7, then a running status needs both state machine refs; any status after that, even back to Draft (DEC-56)', async () => {
    await registryService.register(inputOf(entry('V5'), { code: 'V7', name: 'Next', accessMerchantIds: [], stateMachineSandbox: undefined, stateMachineProduction: undefined, releaseNote: 'Draft' }), ADMIN)
    await expectError(registryService.changeStatus('V7', 'INTERNAL_TESTING', 'Engine build ready', ADMIN), 'VALIDATION', 'Add both state machine references first.')
    await registryService.update('V7', inputOf(entry('V7'), { stateMachineSandbox: ARN('sand'), stateMachineProduction: ARN('prod') }), ADMIN)
    expect(await registryService.changeStatus('V7', 'INTERNAL_TESTING', 'Engine build ready', ADMIN)).toMatchObject({ status: 'INTERNAL_TESTING' })
    expect(entry('V7').activatedAt).toBeUndefined() // Internal testing keeps the fields editable
    expect((await registryService.listSelectable(OWNER)).map((v) => v.code)).not.toContain('V7') // merchants never see Internal testing
    expect((await registryService.listSelectable(ADMIN, fx('MER-0002'))).map((v) => v.code)).toContain('V7')
    const v7 = await registryService.changeStatus('V7', 'ACTIVE', 'Ready for everyone', ADMIN)
    expect(v7).toMatchObject({ status: 'ACTIVE', activatedAt: NOW.toISOString() })
    expect((await registryService.listSelectable(OWNER)).map((v) => v.code)).toContain('V7')
    expect(await registryService.changeStatus('V7', 'DRAFT', 'Pulled back', ADMIN)).toMatchObject({ status: 'DRAFT' })
  })

  it('Given V5 in Limited release for Atoz, then Atoz users may choose it, internal users too, and ticking Vantage gives Vantage access (DEC-56)', async () => {
    expect(entry('V5')).toMatchObject({ status: 'LIMITED_RELEASE', accessMerchantIds: [fx('MER-0001')] })
    expect((await registryService.listSelectable(OWNER)).map((v) => v.code)).toContain('V5')
    expect((await registryService.listSelectable(ADMIN, fx('MER-0002'))).map((v) => v.code)).toContain('V5')
    await registryService.update('V5', inputOf(entry('V5'), { accessMerchantIds: [fx('MER-0001'), fx('MER-0002')], releaseNote: 'Pilot with Vantage' }), ADMIN)
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

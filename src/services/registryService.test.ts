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
  stateMachineSandbox: e.stateMachineSandbox,
  stateMachineProduction: e.stateMachineProduction,
  releaseNote: 'Test change',
  ...over,
})
const ARN = (env: string) => `arn:aws:states:ap-southeast-1:123456789012:stateMachine:ekyc_${env}_onboard_v5`

describe('registryService access (DEC-70)', () => {
  it('Given the Platform Admin, then every version with the number of flows using it; anyone else is refused', async () => {
    const rows = await registryService.list(ADMIN)
    expect(rows.map((r) => r.code)).toEqual(['V1', 'V3', 'V4', 'V5'])
    expect(rows.find((r) => r.code === 'V4')!.flowsUsing).toBe(db.state().flows.filter((f) => f.workflowVersion === 'V4').length)
    await expectError(registryService.list(OWNER), 'FORBIDDEN')
  })

  it('Given a flow creator, then only Active versions are offered, without state machine references (DEC-56)', async () => {
    const versions = await registryService.listSelectable(OWNER)
    expect(versions.map((v) => v.code)).toEqual(['V1', 'V3', 'V4'])
    expect(JSON.stringify(versions)).not.toContain('stateMachine')
    await expectError(registryService.listSelectable(ALI), 'FORBIDDEN') // Reviewer and Viewer only
  })
})

describe('registryService flows using a version (DEC-85)', () => {
  it('Given V3, then the flows on it with their project and merchant', async () => {
    const flows = await registryService.flowsUsing('V3', ADMIN)
    expect(flows.map((f) => f.flowId).sort()).toEqual(db.state().flows.filter((f) => f.workflowVersion === 'V3').map((f) => f.flowId).sort())
    expect(flows.find((f) => f.flowId === 'FLW-0004')).toMatchObject({ projectName: 'SME app', merchantName: 'Atoz Software Tech' })
  })
})

describe('registryService lifecycle (DEC-56, DEC-57)', () => {
  it('Given a new code, then it is registered as Draft; a used code is refused; the event is Platform Admin only', async () => {
    const v6 = await registryService.register(inputOf(entry('V4'), { code: 'V6', name: 'V4 + document liveness', releaseNote: 'First draft' }), ADMIN)
    expect(v6).toMatchObject({ code: 'V6', status: 'DRAFT', isDefault: false, releaseNotes: [{ text: 'First draft', by: 'Lim Wei Jie' }] })
    await expectError(registryService.register(inputOf(entry('V4'), { name: 'Copy' }), ADMIN), 'VALIDATION', 'Workflow code already exists')
    expect((await auditService.list({ actions: ['WORKFLOW_REGISTERED'] }, ADMIN)).items[0]).toMatchObject({ actorRole: 'Platform Admin', details: { code: 'V6' } })
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

  it('Given Draft V5, then it activates only with both state machine references, and never goes back to Draft', async () => {
    await expectError(registryService.changeStatus('V5', 'ACTIVE', 'Ready for pilots', ADMIN), 'VALIDATION', 'Add both state machine references before activating.')
    await registryService.update('V5', inputOf(entry('V5'), { stateMachineSandbox: ARN('sand'), stateMachineProduction: ARN('prod') }), ADMIN)
    const v5 = await registryService.changeStatus('V5', 'ACTIVE', 'Ready for pilots', ADMIN)
    expect(v5).toMatchObject({ status: 'ACTIVE', activatedAt: NOW.toISOString() })
    await expectError(registryService.changeStatus('V5', 'DRAFT', 'Undo', ADMIN), 'VALIDATION', 'A version cannot go back to Draft.')
    expect((await registryService.listSelectable(OWNER)).map((v) => v.code)).toContain('V5')
  })

  it('Given the default moves to V3, then V1 can be deprecated and is no longer offered for new flows; V3 cannot be deprecated', async () => {
    await registryService.setDefault('V3', ADMIN)
    expect(db.state().registry.filter((e) => e.isDefault).map((e) => e.code)).toEqual(['V3'])
    await expectError(registryService.changeStatus('V3', 'DEPRECATED', 'Replaced', ADMIN), 'VALIDATION', 'Set another version as default before deprecating this version')
    await registryService.changeStatus('V1', 'DEPRECATED', 'Replaced by V3', ADMIN)
    await expectError(flowService.create('PRJ-0001', { name: 'Old style', description: '', workflowVersion: 'V1' }, OWNER), 'VALIDATION', 'Choose an active workflow version.')
    expect((await auditService.list({ actions: ['WORKFLOW_DEFAULT_CHANGED'] }, ADMIN)).items[0].details.changes).toEqual([{ field: 'Default for new merchants', from: 'V1', to: 'V3' }])
  })
})

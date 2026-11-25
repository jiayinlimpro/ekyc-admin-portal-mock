// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/mocks/mockDb'
import { ADMIN, ALI, HAFIZ, NOW, OWNER } from '@/test/factories'
import { auditService } from './auditService'
import { devService } from './devService'
import { integrationService as svc } from './integrationService'
import { projectService } from './projectService'
import { verificationService } from './verificationService'
import { fx, verificationIdOf } from '@/lib/ids'

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  await devService.resetDemoData()
})

const last = async (action: Parameters<typeof auditService.list>[0]['actions'] & {}) => (await auditService.list({ actions: action }, ADMIN)).items[0]

describe('Project Settings › General and Review operations', () => {
  it('Given the Project Admin, then branding and language save with old and new values audited', async () => {
    const p = await projectService.updateGeneral(fx('PRJ-0002'), { branding: { primaryColor: '#0F766E' }, language: 'ms' }, HAFIZ)
    expect(p).toMatchObject({ branding: { primaryColor: '#0F766E' }, language: 'ms' })
    expect(await last(['PROJECT_SETTING_CHANGED'])).toMatchObject({ actorRole: 'Project Admin', projectId: fx('PRJ-0002'), details: { changes: [{ field: 'Primary colour', from: '—', to: '#0F766E' }, { field: 'Language', from: '—', to: 'Bahasa Melayu' }] } })
  })

  it('Given a new claim timeout in seconds, then new claims use it (DEC-22) and less than 60 s is refused (DEC-53)', async () => {
    await expect(projectService.updateClaimTimeout(fx('PRJ-0001'), 59, OWNER)).rejects.toMatchObject({ code: 'VALIDATION' })
    await projectService.updateClaimTimeout(fx('PRJ-0001'), 600, OWNER)
    const v = await verificationService.claim(verificationIdOf('KYC-260901-900010'), ALI)
    expect(Date.parse(v.claimExpiresAt!) - Date.parse(v.claimedAt!)).toBe(10 * 60_000)
  })

  it('Given a Reviewer, then settings are refused', async () => {
    await expect(projectService.updateClaimTimeout(fx('PRJ-0001'), 1200, ALI)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('Flow Detail › Integration: API keys and webhook per flow (DEC-117, DEC-75)', () => {
  it('Given the Super admin, then integration is open to them too (DEC-75)', async () => {
    expect((await svc.get(fx('FLW-0001'), ADMIN)).keys.length).toBeGreaterThan(0)
  })

  it('Given two flows of one project, then each lists only its own keys and webhook (DEC-117)', async () => {
    const malaysian = await svc.get(fx('FLW-0001'), OWNER)
    const premium = await svc.get(fx('FLW-0014'), OWNER)
    expect(malaysian.keys.every((k) => k.flowId === fx('FLW-0001'))).toBe(true)
    expect(premium.keys.every((k) => k.flowId === fx('FLW-0014'))).toBe(true)
    expect(malaysian.keys.map((k) => k.keyId)).not.toEqual(premium.keys.map((k) => k.keyId))
    expect(malaysian.webhook?.flowId).toBe(fx('FLW-0001'))
    expect(premium.webhook).toBeUndefined()
  })

  it('Given a Draft flow, then a key can be created before it is activated (DEC-117)', async () => {
    expect((await svc.get(fx('FLW-0003'), OWNER)).keys).toEqual([])
    const { value } = await svc.createKey(fx('FLW-0003'), 'Integration build', OWNER)
    expect(value).toMatchObject({ flowId: fx('FLW-0003'), status: 'ACTIVE' })
  })

  it('Given a flow outside the user\'s projects, then not found', async () => {
    await expect(svc.get(fx('FLW-0001'), HAFIZ)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('Given a new key, then the secret is returned once and only a hint is stored; rotate and revoke are audited with the flow', async () => {
    const { value: key, secret } = await svc.createKey(fx('FLW-0001'), 'Staging', OWNER)
    expect(secret).toMatch(/^sk_mock_[0-9a-f]{32}$/)
    expect(JSON.stringify(db.state().apiKeys)).not.toContain(secret)
    expect(key.secretHint).toBe(`${secret.slice(0, 8)}…${secret.slice(-4)}`)
    const rotated = await svc.rotateKey(key.keyId, OWNER)
    expect(rotated.secret).not.toBe(secret)
    expect((await svc.revokeKey(key.keyId, OWNER)).status).toBe('REVOKED')
    await expect(svc.rotateKey(key.keyId, OWNER)).rejects.toMatchObject({ code: 'VALIDATION' })
    const actions = (await auditService.list({ projectId: fx('PRJ-0001'), actions: ['API_KEY_CREATED', 'API_KEY_ROTATED', 'API_KEY_REVOKED'] }, ADMIN)).items.map((e) => e.action)
    expect(actions.reverse().slice(-3)).toEqual(['API_KEY_CREATED', 'API_KEY_ROTATED', 'API_KEY_REVOKED']) // after the seeded rotation
    expect((await last(['API_KEY_REVOKED'])).details).toMatchObject({ flowId: fx('FLW-0001'), flowName: 'Malaysian onboarding', name: 'Staging' }) // REQ: DEC-117
  })

  it('Given a webhook, then HTTPS only; a new one returns its signing secret once; changes are audited with the flow', async () => {
    await expect(svc.setWebhook(fx('FLW-0004'), { url: 'http://hooks.example' }, HAFIZ)).rejects.toMatchObject({ code: 'VALIDATION' })
    const created = await svc.setWebhook(fx('FLW-0004'), { url: 'https://hooks.atoz.example/sme' }, HAFIZ)
    expect(created.secret).toMatch(/^whsec_/)
    expect(created.webhook.flowId).toBe(fx('FLW-0004'))
    const changed = await svc.setWebhook(fx('FLW-0004'), { url: 'https://hooks.atoz.example/sme-v2' }, HAFIZ)
    expect(changed.secret).toBeUndefined()
    expect(await last(['WEBHOOK_CHANGED'])).toMatchObject({ projectId: fx('PRJ-0002'), details: { flowId: fx('FLW-0004'), flowName: 'SME director check', changes: [{ field: 'URL', from: 'https://hooks.atoz.example/sme', to: 'https://hooks.atoz.example/sme-v2' }] } })
  })

  it('Given a key or webhook change on an Active flow, then no reason is asked and no revision is created (DEC-117, DEC-51)', async () => {
    const before = db.state().flows.find((f) => f.flowId === fx('FLW-0001'))!.revision
    await svc.createKey(fx('FLW-0001'), 'Second server', OWNER)
    await svc.setWebhook(fx('FLW-0001'), { url: 'https://hooks.atoz.example/ekyc-v2' }, OWNER)
    expect(db.state().flows.find((f) => f.flowId === fx('FLW-0001'))!.revision).toBe(before)
  })
})

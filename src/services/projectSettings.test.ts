// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/mocks/mockDb'
import { ADMIN, ALI, HAFIZ, NOW, OWNER } from '@/test/factories'
import { auditService } from './auditService'
import { devService } from './devService'
import { integrationService as svc } from './integrationService'
import { projectService } from './projectService'
import { verificationService } from './verificationService'
import { fx, caseIdOf } from '@/lib/ids'

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

  it('Given a new claim timeout, then new claims use it (DEC-22) and a timeout below 1 is refused (DEC-53)', async () => {
    await expect(projectService.updateClaimTimeout(fx('PRJ-0001'), 0, OWNER)).rejects.toMatchObject({ code: 'VALIDATION' })
    await projectService.updateClaimTimeout(fx('PRJ-0001'), 10, OWNER)
    const v = await verificationService.claim(caseIdOf('KYC-260901-900010'), ALI)
    expect(Date.parse(v.claimExpiresAt!) - Date.parse(v.claimedAt!)).toBe(10 * 60_000)
  })

  it('Given a Reviewer, then settings are refused', async () => {
    await expect(projectService.updateClaimTimeout(fx('PRJ-0001'), 20, ALI)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('Project Settings › Integration (DEC-54, DEC-75)', () => {
  it('Given the Super admin, then integration is open to them too (DEC-75)', async () => {
    expect((await svc.get(fx('PRJ-0001'), ADMIN)).keys.length).toBeGreaterThan(0)
  })

  it('Given a new key, then the secret is returned once and only a hint is stored; rotate and revoke are audited', async () => {
    const { value: key, secret } = await svc.createKey(fx('PRJ-0001'), 'Staging', OWNER)
    expect(secret).toMatch(/^sk_mock_[0-9a-f]{32}$/)
    expect(JSON.stringify(db.state().projectKeys)).not.toContain(secret)
    expect(key.secretHint).toBe(`${secret.slice(0, 8)}…${secret.slice(-4)}`)
    const rotated = await svc.rotateKey(key.keyId, OWNER)
    expect(rotated.secret).not.toBe(secret)
    expect((await svc.revokeKey(key.keyId, OWNER)).status).toBe('REVOKED')
    await expect(svc.rotateKey(key.keyId, OWNER)).rejects.toMatchObject({ code: 'VALIDATION' })
    const actions = (await auditService.list({ projectId: fx('PRJ-0001'), actions: ['API_KEY_CREATED', 'API_KEY_ROTATED', 'API_KEY_REVOKED'] }, ADMIN)).items.map((e) => e.action)
    expect(actions.reverse().slice(-3)).toEqual(['API_KEY_CREATED', 'API_KEY_ROTATED', 'API_KEY_REVOKED']) // after the seeded rotation
  })

  it('Given a webhook, then HTTPS only; a new one returns its signing secret once; changes are audited', async () => {
    await expect(svc.setWebhook(fx('PRJ-0002'), { url: 'http://hooks.example' }, HAFIZ)).rejects.toMatchObject({ code: 'VALIDATION' })
    const created = await svc.setWebhook(fx('PRJ-0002'), { url: 'https://hooks.atoz.example/sme' }, HAFIZ)
    expect(created.secret).toMatch(/^whsec_/)
    const changed = await svc.setWebhook(fx('PRJ-0002'), { url: 'https://hooks.atoz.example/sme-v2' }, HAFIZ)
    expect(changed.secret).toBeUndefined()
    expect(await last(['WEBHOOK_CHANGED'])).toMatchObject({ details: { changes: [{ field: 'URL', from: 'https://hooks.atoz.example/sme', to: 'https://hooks.atoz.example/sme-v2' }] } })
  })

  it('Given access lists, then they are cleaned, validated and saved', async () => {
    const lists = await svc.updateLists(fx('PRJ-0001'), { redirectUrls: [' https://app.atoz.example/kyc/done '], allowedOrigins: ['https://app.atoz.example/'], ipAllowlist: ['203.0.113.0/24', '198.51.100.9'] }, OWNER)
    expect(lists).toEqual({ redirectUrls: ['https://app.atoz.example/kyc/done'], allowedOrigins: ['https://app.atoz.example'], ipAllowlist: ['203.0.113.0/24', '198.51.100.9'] })
    await expect(svc.updateLists(fx('PRJ-0001'), { ...lists, ipAllowlist: ['nope'] }, OWNER)).rejects.toMatchObject({ code: 'VALIDATION' })
  })
})

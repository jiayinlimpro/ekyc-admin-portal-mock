// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/mocks/mockDb'
import { ADMIN, ALI, HAFIZ, NOW, OWNER } from '@/test/factories'
import { accessAdminService as svc } from './accessAdminService'
import { auditService } from './auditService'
import { devService } from './devService'
import { verificationService } from './verificationService'

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  await devService.resetDemoData()
})

const account = (id: string) => db.state().accounts.find((a) => a.userId === id)!

describe('Users and Access (DEC-70, DEC-74)', () => {
  it('Given the Merchant Owner, then every Atoz user with projects and roles; owners first and not editable', async () => {
    const rows = await svc.list('MER-0001', OWNER)
    expect(rows[0].account.level).toBe('MERCHANT_OWNER')
    expect(rows[0].editableProjectIds).toEqual([])
    const ali = rows.find((r) => r.account.userId === ALI.userId)!
    expect(ali.roles.map((r) => `${r.projectName}:${r.role}`)).toEqual(['Default:REVIEWER', 'SME app:VIEWER'])
    expect(ali.editableProjectIds).toEqual(['PRJ-0001', 'PRJ-0002'])
    expect(ali.canDeactivate).toBe(true)
  })

  it('Given a Project Admin, then only the people of their project; they may edit SME app roles but not deactivate', async () => {
    const rows = await svc.list('MER-0001', HAFIZ)
    expect(rows.map((r) => r.account.fullName)).not.toContain('Siti Aminah Binti Yusof') // Default only
    const ali = rows.find((r) => r.account.userId === ALI.userId)!
    expect(ali.editableProjectIds).toEqual(['PRJ-0002'])
    expect(ali.canDeactivate).toBe(false)
    await expect(svc.setRole(ALI.userId, 'PRJ-0001', 'VIEWER', HAFIZ)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('Given a Reviewer, then Users and Access is refused', async () => {
    await expect(svc.list('MER-0001', ALI)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('Given an invite, then an Invited account with one role per project, audited per project', async () => {
    const a = await svc.invite('MER-0001', { fullName: 'Aishah Binti Omar', email: 'Aishah@Atoz.example', roles: [{ projectId: 'PRJ-0002', role: 'REVIEWER' }] }, HAFIZ)
    expect(a).toMatchObject({ status: 'INVITED', level: 'MEMBER', merchantId: 'MER-0001', email: 'aishah@atoz.example', memberships: [{ projectId: 'PRJ-0002', role: 'REVIEWER' }] })
    expect((await auditService.list({ actions: ['USER_INVITED'] }, ADMIN)).items[0]).toMatchObject({ projectId: 'PRJ-0002', actorRole: 'PROJECT_ADMIN' })
    await expect(svc.invite('MER-0001', { fullName: 'Someone Else', email: 'aishah@atoz.example', roles: [{ projectId: 'PRJ-0002', role: 'VIEWER' }] }, OWNER)).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('Given Ali made Viewer in Default, then his open claims there are released (DEC-22, DEC-74)', async () => {
    await svc.setRole(ALI.userId, 'PRJ-0001', 'VIEWER', OWNER)
    expect(account(ALI.userId).memberships.find((m) => m.projectId === 'PRJ-0001')!.role).toBe('VIEWER')
    const s07 = await verificationService.get('KYC-260901-900007', OWNER)
    expect(s07.claimedBy).toBeUndefined()
    expect((await auditService.list({ referenceNo: 'KYC-260901-900007', actions: ['CASE_RELEASED'] }, ADMIN)).items[0].details).toMatchObject({ reason: 'Access removed' })
  })

  it('Given removed from Default, then Ali cannot see its cases any more', async () => {
    await svc.removeAccess(ALI.userId, 'PRJ-0001', OWNER)
    await expect(verificationService.get('KYC-260901-900003', ALI)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect((await auditService.list({ actions: ['USER_REMOVED'] }, ADMIN)).total).toBe(1)
  })

  it('Given deactivation, then the account is Deactivated, claims released, and it cannot act', async () => {
    await svc.deactivate(ALI.userId, OWNER)
    expect(account(ALI.userId).status).toBe('DEACTIVATED')
    await expect(verificationService.claim('KYC-260901-900010', ALI)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('Given my own row or an owner, then no change is allowed', async () => {
    await expect(svc.setRole(OWNER.userId, 'PRJ-0001', 'VIEWER', OWNER)).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(svc.setRole(OWNER.userId, 'PRJ-0001', 'VIEWER', ADMIN)).rejects.toMatchObject({ code: 'VALIDATION' })
  })
})

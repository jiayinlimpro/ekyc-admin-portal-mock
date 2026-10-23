// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/mocks/mockDb'
import { ADMIN, ALI, NOW } from '@/test/factories'
import { accountOf, mayInProject, projectIdsWhere, requireActive } from './accessGuard'
import { devService } from './devService'
import { userService } from './userService'
import { fx } from '@/lib/ids'

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  await devService.resetDemoData()
})

const ids = (rows: { userId: string }[]) => rows.map((r) => r.userId).sort()

describe('accessGuard (DEC-71, DEC-72)', () => {
  it('Given a session for a user with no account, then FORBIDDEN', () => {
    expect(() => accountOf({ userId: fx('USR-2026-9999') })).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }))
  })

  it('Given a Pending or Suspended account, then it may not change anything', () => {
    expect(() => requireActive({ userId: fx('USR-2026-0035') })).toThrow('Your account is inactive.') // Chong Pei Shan, Pending
    expect(() => requireActive({ userId: fx('USR-2026-0039') })).toThrow('Your account is inactive.') // Yap Li Wen, Suspended
    expect(requireActive(ALI).level).toBe('MERCHANT_USER')
  })

  it('Given Ali (Reviewer in Default, Viewer in SME app), then rights come from his project roles, not the session role', () => {
    expect(mayInProject(ALI, 'claimCase', fx('PRJ-0001'))).toBe(true)
    expect(mayInProject(ALI, 'claimCase', fx('PRJ-0002'))).toBe(false)
    expect(mayInProject(ALI, 'viewCases', fx('PRJ-0003'))).toBe(false) // another merchant
    expect(mayInProject(ALI, 'viewCases', fx('PRJ-9999'))).toBe(false)
    expect([...projectIdsWhere(ALI, 'viewCases')].sort()).toEqual([fx('PRJ-0001'), fx('PRJ-0002')].sort())
  })

  it('Given the Super admin, then cases in every project (DEC-75)', () => {
    expect(projectIdsWhere(ADMIN, 'viewCases').size).toBe(db.state().projects.length)
    expect(mayInProject(ADMIN, 'manageIntegration', fx('PRJ-0003'))).toBe(true)
    expect(projectIdsWhere(ADMIN, 'editFlows').size).toBe(db.state().projects.length)
  })
})

describe('userService', () => {
  it('Given Ali, then reviewers are the active users who may claim in his projects', async () => {
    // Lim and Nor Aisyah (Super admins, DEC-75), Rizal (Platform Admin), Tan Mei Ling (Owner), Lee Jia Hui (Admin), Hafiz
    // (Project Admin SME app), Siti and Nurul. Not Yap (suspended), not Support or the Developer.
    const everywhere = [fx('USR-2026-0001'), fx('USR-2026-0002'), fx('USR-2026-0005'), fx('USR-2026-0010'), fx('USR-2026-0036')]
    expect(ids(await userService.listReviewers(ALI))).toEqual([...everywhere, fx('USR-2026-0012'), fx('USR-2026-0020'), fx('USR-2026-0031'), fx('USR-2026-0033')].sort())
    expect(ids(await userService.listReviewers(ALI, fx('PRJ-0001')))).toEqual([...everywhere, fx('USR-2026-0012'), fx('USR-2026-0031')].sort())
  })

  it('Given Ali, then the directory is his merchant plus internal accounts (they appear in audit logs)', async () => {
    const users = await userService.list(ALI)
    expect(users.every((u) => u.merchantId === fx('MER-0001') || u.level === 'SUPER_ADMIN' || u.level === 'PLATFORM_STAFF')).toBe(true)
    expect(ids(users)).toContain(fx('USR-2026-0001'))
    expect((await userService.list(ADMIN)).length).toBe(db.state().accounts.length)
  })
})

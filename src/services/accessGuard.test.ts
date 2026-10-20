// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/mocks/mockDb'
import { ADMIN, ALI, NOW } from '@/test/factories'
import { accountOf, mayInProject, projectIdsWhere, requireActive } from './accessGuard'
import { devService } from './devService'
import { userService } from './userService'

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  await devService.resetDemoData()
})

const ids = (rows: { userId: string }[]) => rows.map((r) => r.userId).sort()

describe('accessGuard (DEC-71, DEC-72)', () => {
  it('Given a session for a user with no account, then FORBIDDEN', () => {
    expect(() => accountOf({ userId: 'USR-2026-9999' })).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }))
  })

  it('Given an Invited or Deactivated account, then it may not change anything', () => {
    expect(() => requireActive({ userId: 'USR-2026-0035' })).toThrow('Your account is inactive.') // Chong Pei Shan, Invited
    expect(() => requireActive({ userId: 'USR-2026-0039' })).toThrow('Your account is inactive.') // Yap Li Wen, Deactivated
    expect(requireActive(ALI).level).toBe('MEMBER')
  })

  it('Given Ali (Reviewer in Default, Viewer in SME app), then rights come from his project roles, not the session role', () => {
    expect(mayInProject(ALI, 'claimCase', 'PRJ-0001')).toBe(true)
    expect(mayInProject(ALI, 'claimCase', 'PRJ-0002')).toBe(false)
    expect(mayInProject(ALI, 'viewCases', 'PRJ-0003')).toBe(false) // another merchant
    expect(mayInProject(ALI, 'viewCases', 'PRJ-9999')).toBe(false)
    expect([...projectIdsWhere(ALI, 'viewCases')].sort()).toEqual(['PRJ-0001', 'PRJ-0002'])
  })

  it('Given the Platform Admin, then no case access by default (OQ-20)', () => {
    expect(projectIdsWhere(ADMIN, 'viewCases').size).toBe(0)
    expect(projectIdsWhere(ADMIN, 'manageFlows').size).toBe(db.state().projects.length)
  })
})

describe('userService', () => {
  it('Given Ali, then reviewers are the active users who may claim in his projects', async () => {
    // Tan Mei Ling (owner), Hafiz (Project Admin SME app), Siti and Nurul (Reviewers). Not Yap (deactivated), not Lim (admin).
    expect(ids(await userService.listReviewers(ALI))).toEqual(['USR-2026-0002', 'USR-2026-0012', 'USR-2026-0020', 'USR-2026-0031', 'USR-2026-0033'])
    expect(ids(await userService.listReviewers(ALI, 'PRJ-0001'))).toEqual(['USR-2026-0002', 'USR-2026-0012', 'USR-2026-0031'])
  })

  it('Given Ali, then the directory is his merchant plus Platform Admins', async () => {
    const users = await userService.list(ALI)
    expect(users.every((u) => u.merchantId === 'MER-0001' || u.level === 'PLATFORM_ADMIN')).toBe(true)
    expect(ids(users)).toContain('USR-2026-0001')
    expect((await userService.list(ADMIN)).length).toBe(db.state().accounts.length)
  })
})

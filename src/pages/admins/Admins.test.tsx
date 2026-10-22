// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { routes } from '@/app/routes'
import { adminService, LAST_ADMIN, NOT_YOURSELF } from '@/services/adminService'
import { auditService } from '@/services/auditService'
import { devService } from '@/services/devService'
import { userAdminService } from '@/services/userAdminService'
import { DEFAULT_DEV_FLAGS, useDevFlags } from '@/stores/devFlagsStore'
import { useSession } from '@/stores/sessionStore'
import { ADMIN, OWNER } from '@/test/factories'
import { fx } from '@/lib/ids'

const AISYAH = { userId: fx('USR-2026-0005'), fullName: 'Nor Aisyah Binti Hamid' }
const renderAt = (path: string) => render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />)

beforeEach(async () => {
  useDevFlags.setState({ ...DEFAULT_DEV_FLAGS, simulateLatency: false })
  await devService.resetDemoData()
  useSession.getState().switchUser(ADMIN)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('adminService (DEC-79)', () => {
  it('Given Super admin, then only Super admin accounts; the Users screen has none of them', async () => {
    expect((await adminService.list(ADMIN)).map((r) => r.userId)).toEqual([AISYAH.userId, ADMIN.userId])
    expect((await userAdminService.list(ADMIN)).some((r) => r.userId === AISYAH.userId)).toBe(false)
    await expect(adminService.list(OWNER)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('Given a new admin, then Pending with no roles, audited', async () => {
    const r = await adminService.invite({ fullName: 'Daniel Tan', email: 'daniel.tan@ekyc-platform.example' }, ADMIN)
    expect(r).toMatchObject({ status: 'PENDING' })
    expect((await auditService.list({ actions: ['USER_INVITED'] }, ADMIN)).items[0]).toMatchObject({ actorRole: 'Super admin', details: { access: 'Super admin' } })
    await expect(adminService.invite({ fullName: 'Daniel Again', email: 'daniel.tan@ekyc-platform.example' }, ADMIN)).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('Given two active admins, then one can suspend the other but not themselves; the last active one stays', async () => {
    expect((await adminService.list(ADMIN)).find((r) => r.userId === ADMIN.userId)!.suspendBlocked).toBe(NOT_YOURSELF)
    expect((await adminService.suspend(AISYAH.userId, ADMIN)).status).toBe('SUSPENDED')
    await expect(adminService.suspend(ADMIN.userId, ADMIN)).rejects.toMatchObject({ code: 'VALIDATION' })
    const other = await adminService.invite({ fullName: 'Daniel Tan', email: 'daniel.tan@ekyc-platform.example' }, ADMIN)
    expect(other.suspendBlocked).toBeUndefined() // Pending: suspending them leaves Lim active
    expect((await adminService.reactivate(AISYAH.userId, ADMIN)).status).toBe('ACTIVE')
  })

  it('Given only one active admin, then they are the last one', async () => {
    await adminService.suspend(AISYAH.userId, ADMIN)
    useSession.getState().switchUser(ADMIN)
    expect((await adminService.list(AISYAH)).find((r) => r.userId === ADMIN.userId)!.suspendBlocked).toBe(LAST_ADMIN)
  })
})

describe('Super admins screen (DEC-79, DEC-99)', () => {
  it('Given Super admin, then the list under Platform, with Suspend disabled on their own row', async () => {
    renderAt('/admins')
    const me = (await screen.findByRole('rowheader', { name: /Lim Wei Jie/ })).closest('tr')!
    const suspend = within(me).getByRole('button', { name: 'Suspend Lim Wei Jie' }) as HTMLButtonElement
    expect(suspend.disabled).toBe(true)
    expect(suspend.parentElement!.getAttribute('title')).toBe(NOT_YOURSELF)
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Super admins' })).toBeTruthy()
  })

  it('Given a new admin from the screen, then the row is Pending with Resend invitation', async () => {
    renderAt('/admins')
    await screen.findByRole('rowheader', { name: /Lim Wei Jie/ })
    fireEvent.click(screen.getByRole('button', { name: /New super admin/ }))
    const id = (await screen.findByLabelText('User ID')) as HTMLInputElement
    await waitFor(() => expect(id.value).toMatch(/^usr_[a-z0-9]{24}$/))
    expect(id.disabled).toBe(true)
    const drafted = id.value
    fireEvent.change(await screen.findByLabelText('Full name'), { target: { value: 'Daniel Tan' } })
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'daniel.tan@ekyc-platform.example' } })
    fireEvent.click(screen.getByRole('button', { name: 'Invite super admin' }))
    const row = (await screen.findByRole('rowheader', { name: 'Daniel Tan' })).closest('tr')!
    expect((await adminService.list(ADMIN)).find((r) => r.fullName === 'Daniel Tan')!.userId).toBe(drafted)
    expect(row.textContent).toContain('Pending')
    expect(within(row).getByRole('button', { name: 'Resend invitation' })).toBeTruthy()
  })

  it('Given a Merchant Owner, then Admins is "No access"', async () => {
    useSession.getState().switchUser(OWNER)
    renderAt('/admins')
    await screen.findByRole('heading', { name: 'No access' })
  })
})

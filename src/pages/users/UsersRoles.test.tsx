// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { routes } from '@/app/routes'
import { ROLE_NEEDS_PERMISSION } from '@/domain/roles'
import { devService } from '@/services/devService'
import { DEFAULT_DEV_FLAGS, useDevFlags } from '@/stores/devFlagsStore'
import { useSession } from '@/stores/sessionStore'
import { ADMIN, ALI, OWNER } from '@/test/factories'

function renderAt(path: string) {
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />)
}
const row = async (name: string) => (await screen.findByRole('rowheader', { name })).closest('tr')!

beforeEach(async () => {
  useDevFlags.setState({ ...DEFAULT_DEV_FLAGS, simulateLatency: false })
  await devService.resetDemoData()
  useSession.getState().switchUser(OWNER)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Users (DEC-74)', () => {
  it('Given the Merchant Owner, then the FRS columns with Access; no Merchant column; status filter applies on Search', async () => {
    renderAt('/users')
    expect((await row('Ali Bin Ahmad')).textContent).toContain('Reviewer · DefaultViewer · SME app')
    const headers = within(screen.getByRole('region', { name: 'User list' })).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual(['User ID', 'Full Name', 'Email', 'Access', 'Status', 'Created At'])
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'PENDING' } })
    fireEvent.click(screen.getByRole('button', { name: /Search/ }))
    await waitFor(() => expect(screen.queryByRole('rowheader', { name: 'Ali Bin Ahmad' })).toBeNull())
    expect(screen.getByRole('rowheader', { name: 'Chong Pei Shan' })).toBeTruthy()
  })

  it('Given a new user for selected projects, then they appear as Pending with that access', async () => {
    renderAt('/users')
    await row('Ali Bin Ahmad')
    fireEvent.click(screen.getByRole('button', { name: /New user/ }))
    fireEvent.change(await screen.findByLabelText('Full name'), { target: { value: 'Aishah Binti Omar' } })
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'aishah@atoz.example' } })
    const role = screen.getByLabelText('Role')
    await waitFor(() => expect(within(role).getAllByRole('option').length).toBeGreaterThan(1))
    fireEvent.change(role, { target: { value: 'ROL-2026-0003' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'SME app' }))
    fireEvent.click(screen.getByRole('button', { name: 'Invite user' }))
    const r = await row('Aishah Binti Omar')
    expect(r.textContent).toContain('Reviewer · SME app')
    expect(r.textContent).toContain('Pending')
  })

  it('Given Merchant Owner is chosen, then Selected projects is not available', async () => {
    renderAt('/users')
    await row('Ali Bin Ahmad')
    fireEvent.click(screen.getByRole('button', { name: /New user/ }))
    const role = await screen.findByLabelText('Role')
    await waitFor(() => expect(within(role).getAllByRole('option').length).toBeGreaterThan(1))
    fireEvent.change(role, { target: { value: 'ROL-2026-0001' } })
    expect((screen.getByRole('radio', { name: /Selected projects/ }) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('radio', { name: /^All projects/ }) as HTMLInputElement).checked).toBe(true)
  })

  it('Given Ali’s details, then his Access table; removing Viewer (SME app) updates it', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderAt('/users')
    fireEvent.click(within(await row('Ali Bin Ahmad')).getByRole('button', { name: 'Ali Bin Ahmad' }))
    const access = await screen.findByRole('region', { name: 'Access' })
    await within(access).findByRole('rowheader', { name: 'Reviewer' })
    fireEvent.click(within(access).getByRole('button', { name: 'Remove Viewer · SME app' }))
    await waitFor(() => expect(within(access).queryByRole('rowheader', { name: 'Viewer' })).toBeNull())
  })

  it('Given a Reviewer, then Users is "No access"', async () => {
    useSession.getState().switchUser(ALI)
    renderAt('/users')
    await screen.findByRole('heading', { name: 'No access' })
  })
})

describe('Roles (DEC-76)', () => {
  it('Given the Merchant Owner, then the System Default roles, read-only', async () => {
    renderAt('/roles')
    expect((await row('Reviewer')).textContent).toContain('System Default')
    fireEvent.click(within(await row('Reviewer')).getByRole('button', { name: 'Reviewer' }))
    await screen.findByText(/can’t be changed/)
    expect(screen.getByRole('checkbox', { name: 'Claim cases' }).matches(':disabled')).toBe(true) // inside a disabled fieldset
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('Given a new role, then Claim ticks View cases, and no permission shows the FRS message', async () => {
    renderAt('/roles')
    await row('Reviewer')
    fireEvent.click(screen.getByRole('button', { name: /New role/ }))
    fireEvent.change(await screen.findByLabelText('Role name'), { target: { value: 'Claimer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create role' }))
    expect(await screen.findByText(ROLE_NEEDS_PERMISSION)).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Claim cases' }))
    const view = screen.getByRole('checkbox', { name: /View cases/ }) as HTMLInputElement
    expect(view.checked && view.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Create role' }))
    expect((await row('Claimer')).textContent).toContain('Custom')
  })

  it('Given Platform Admin, then the Merchant column and the Custom role with "Affects N users"', async () => {
    useSession.getState().switchUser(ADMIN)
    renderAt('/roles')
    const r = await row('Compliance Auditor')
    expect(r.textContent).toContain('Vantage')
    fireEvent.click(within(r).getByRole('button', { name: 'Compliance Auditor' }))
    expect((await screen.findByRole('status')).textContent).toContain('Affects 1 user')
  })
})

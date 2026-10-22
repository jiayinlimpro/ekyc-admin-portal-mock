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
import { fx } from '@/lib/ids'

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
    expect(headers).toEqual(['Full Name', 'Email', 'Access', 'Status', 'Created At'])
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'PENDING' } })
    fireEvent.click(screen.getByRole('button', { name: /Search/ }))
    await waitFor(() => expect(screen.queryByRole('rowheader', { name: 'Ali Bin Ahmad' })).toBeNull())
    expect(screen.getByRole('rowheader', { name: 'Chong Pei Shan' })).toBeTruthy()
  })

  it('Given a new user for selected projects, then they appear as Pending with that access', async () => {
    renderAt('/users')
    await row('Ali Bin Ahmad')
    fireEvent.click(screen.getByRole('button', { name: /New user/ }))
    const id = (await screen.findByLabelText('User ID')) as HTMLInputElement
    await waitFor(() => expect(id.value).toMatch(/^usr_[a-z0-9]{24}$/))
    expect(id.disabled && id.readOnly).toBe(true)
    const [type, second] = within(id.closest('form')!).getAllByRole('textbox') as HTMLInputElement[]
    expect(type.value).toMatch(/^Merchant · /) // Type first, locked for a merchant admin (DEC-99)
    expect(second).toBe(id)
    fireEvent.change(await screen.findByLabelText('Full name'), { target: { value: 'Aishah Binti Omar' } })
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'aishah@atoz.example' } })
    const role = screen.getByLabelText('Role')
    await waitFor(() => expect(within(role).getAllByRole('option').length).toBeGreaterThan(1))
    fireEvent.change(role, { target: { value: fx('ROL-2026-0003') } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'SME app' }))
    expect(screen.getByRole('status').textContent).toBe('Aishah Binti Omar will be able to view cases, claim cases, approve / reject cases, view project reports in SME app.')
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
    fireEvent.change(role, { target: { value: fx('ROL-2026-0001') } })
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

  it('Given Ali’s details, when SME app is chosen under Effective access, then only Viewer permissions, from Viewer · SME app', async () => {
    renderAt(`/users?user=${fx('USR-2026-0012')}`)
    const ea = await screen.findByRole('region', { name: 'Effective access' })
    expect(within(ea).getByRole('rowheader', { name: 'Claim cases' }).closest('tr')!.textContent).toContain('Reviewer · Default')
    fireEvent.change(within(ea).getByLabelText('Project'), { target: { value: fx('PRJ-0002') } })
    expect(within(ea).queryByRole('rowheader', { name: 'Claim cases' })).toBeNull()
    expect(within(ea).getByRole('rowheader', { name: 'View cases' }).closest('tr')!.textContent).toContain('Viewer · SME app')
  })

  it('Given a Merchant Owner, then no platform staff in the list', async () => {
    renderAt('/users')
    await row('Ali Bin Ahmad')
    expect(screen.queryByRole('rowheader', { name: 'Daniel Tan' })).toBeNull()
    expect(screen.queryByLabelText('Type', { selector: 'select' })).toBeNull()
  })

  it('Given a super admin, when New user is Platform, then name, company email, staff role and merchant access, no Access ends; listed as Platform (DEC-99)', async () => {
    useSession.getState().switchUser(ADMIN)
    renderAt('/users')
    expect((await row('Daniel Tan')).textContent).toContain('Platform (internal)')
    fireEvent.click(screen.getByRole('button', { name: /New user/ }))
    const dialog = within(await screen.findByRole('dialog'))
    fireEvent.change(dialog.getByLabelText('Type'), { target: { value: 'PLATFORM' } })
    expect(dialog.queryByLabelText('Merchant')).toBeNull()
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Mira Chen' } })
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'mira.chen@ekyc-platform.example' } })
    const role = screen.getByLabelText('Staff role')
    await waitFor(() => expect(within(role).getAllByRole('option').map((o) => o.textContent)).toContain('Finance (System Default)'))
    fireEvent.change(role, { target: { value: fx('ROL-2026-0104') } }) // Finance: no merchant access
    expect(screen.getByText('This role has no merchant access permissions.')).toBeTruthy()
    fireEvent.change(role, { target: { value: fx('ROL-2026-0102') } }) // Support
    expect((screen.getByRole('radio', { name: 'All merchants, including future merchants' }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: 'Selected merchants' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Vantage' }))
    expect(dialog.queryByText('Access ends')).toBeNull() // not on New user for platform staff
    fireEvent.click(screen.getByRole('button', { name: 'Invite user' }))
    const r = await row('Mira Chen')
    expect(r.textContent).toContain('Support · Vantage')
    expect(r.textContent).toContain('Platform (internal)')
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

  it('Given New role as a Merchant Owner, then Type is locked to their merchant, then the generated Role ID, read-only (DEC-76, DEC-99)', async () => {
    renderAt('/roles')
    await row('Reviewer')
    fireEvent.click(screen.getByRole('button', { name: /New role/ }))
    const id = (await screen.findByLabelText('Role ID')) as HTMLInputElement
    await waitFor(() => expect(id.value).toMatch(/^rol_[a-z0-9]{24}$/))
    expect(id.disabled && id.readOnly).toBe(true)
    const form = id.closest('form')!
    const [type, second] = within(form).getAllByRole('textbox') as HTMLInputElement[]
    expect(type.value).toBe('Merchant · Atoz Software Tech') // Type first, locked for a merchant admin
    expect(type.disabled).toBe(true)
    expect(second).toBe(id)
    fireEvent.change(screen.getByLabelText('Role name'), { target: { value: 'Night shift' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'View cases' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Inactive' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create role' }))
    expect((await row('Night shift')).textContent).toContain('Inactive')
  })

  it('Given the Actions menu, then Fraud Analyst (unassigned) can be deactivated; Reviewer can’t, with the reason', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderAt('/roles')
    fireEvent.click(within(await row('Reviewer')).getByRole('button', { name: 'Actions for Reviewer' }))
    const item = await screen.findByRole('menuitem', { name: /Deactivate/ })
    expect(item.getAttribute('aria-disabled') ?? item.getAttribute('data-disabled')).toBeTruthy()
    expect(item.textContent).toContain('can’t be deactivated')
    fireEvent.keyDown(item, { key: 'Escape' })
    cleanup()
    renderAt('/roles')
    fireEvent.click(within(await row('Fraud Analyst')).getByRole('button', { name: 'Actions for Fraud Analyst' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Deactivate' }))
    await waitFor(async () => expect((await row('Fraud Analyst')).textContent).toContain('Inactive'))
  })

  it('Given a super admin, when New role is Platform, then no Merchant field and platform permissions by module; it lists as Platform (DEC-99)', async () => {
    useSession.getState().switchUser(ADMIN)
    renderAt('/roles')
    expect((await row('Support')).textContent).toContain('Platform (internal)')
    fireEvent.click(screen.getByRole('button', { name: /New role/ }))
    const type = (await screen.findByLabelText('Type')) as HTMLSelectElement
    fireEvent.change(type, { target: { value: 'PLATFORM' } })
    expect(screen.queryByLabelText('Merchant')).toBeNull()
    fireEvent.change(screen.getByLabelText('Role name'), { target: { value: 'Night reviewer' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Verifications · Claim / approve / reject' }))
    const unmasked = screen.getByRole('checkbox', { name: 'Verifications · See unmasked ID data' }) as HTMLInputElement
    expect(unmasked.checked && unmasked.disabled).toBe(true) // a reviewer must see the documents
    fireEvent.click(screen.getByRole('button', { name: 'Create role' }))
    expect((await row('Night reviewer')).textContent).toContain('Platform (internal)')
  })

  it('Given Super admin, then the Merchant column and the Custom role with "Affects N users"', async () => {
    useSession.getState().switchUser(ADMIN)
    renderAt('/roles')
    const r = await row('Compliance Auditor')
    expect(r.textContent).toContain('Vantage')
    fireEvent.click(within(r).getByRole('button', { name: 'Compliance Auditor' }))
    expect((await screen.findByRole('status')).textContent).toContain('Affects 1 user in 1 project')
  })

  it('Given a System Default role, when duplicated, then a Custom copy with its permissions is created', async () => {
    renderAt('/roles')
    fireEvent.click(within(await row('Reviewer')).getByRole('button', { name: 'Reviewer' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate' }))
    expect(((await screen.findByLabelText('Role name')) as HTMLInputElement).value).toBe('Copy of Reviewer')
    expect((screen.getByRole('checkbox', { name: 'Claim cases' }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Create role' }))
    expect((await row('Copy of Reviewer')).textContent).toContain('Custom')
  })

  it('Given the only Merchant Owner, then Remove and Suspend are shown disabled with the reason (DEC-78)', async () => {
    useSession.getState().switchUser(ADMIN)
    renderAt(`/users?user=${fx('USR-2026-0002')}`)
    const remove = await screen.findByRole('button', { name: 'Remove Merchant Owner · All projects' })
    expect((remove as HTMLButtonElement).disabled).toBe(true)
    expect(remove.parentElement!.getAttribute('title')).toBe('At least one Merchant Owner (All projects) is required.')
    expect((screen.getByRole('button', { name: 'Suspend' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

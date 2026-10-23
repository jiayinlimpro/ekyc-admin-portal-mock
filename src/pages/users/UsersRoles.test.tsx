// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { routes } from '@/app/routes'
import { LAST_OWNER, ROLE_NEEDS_PERMISSION, SYSTEM_ROLE_IDS } from '@/domain/roles'
import { roleService } from '@/services/roleService'
import { userAdminService } from '@/services/userAdminService'
import { devService } from '@/services/devService'
import { DEFAULT_DEV_FLAGS, useDevFlags } from '@/stores/devFlagsStore'
import { useSession } from '@/stores/sessionStore'
import { ADMIN, ALI, OWNER, SITI } from '@/test/factories'
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

describe('Users (DEC-74, DEC-104)', () => {
  it('Given the Owner, then the FRS columns with Access (merchant role first); no Merchant column; status filter applies on Search', async () => {
    renderAt('/users')
    expect((await row('Ali Bin Ahmad')).textContent).toContain('MemberReviewer · DefaultViewer · SME app')
    const headers = within(screen.getByRole('region', { name: 'User list' })).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual(['Full Name', 'Email', 'Access', 'Status', 'Created At'])
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'PENDING' } })
    fireEvent.click(screen.getByRole('button', { name: /Search/ }))
    await waitFor(() => expect(screen.queryByRole('rowheader', { name: 'Ali Bin Ahmad' })).toBeNull())
    expect(screen.getByRole('rowheader', { name: 'Chong Pei Shan' })).toBeTruthy()
  })

  it('Given New user, then Type, User ID, then the merchant role with Member by default and the help text; Reviewer applies to all projects', async () => {
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
    const role = screen.getByLabelText('Role') as HTMLSelectElement
    await waitFor(() => expect(within(role).getAllByRole('option').length).toBeGreaterThan(1))
    expect(role.value).toBe(SYSTEM_ROLE_IDS.MEMBER)
    expect(screen.getByText(/To limit access to some projects, choose Member and add the user in each project\./)).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Aishah Binti Omar will have no access until they are added to a project in Project › Members.')
    expect(screen.queryByRole('radio', { name: /Selected projects/ })).toBeNull() // no scope on New user (DEC-104)
    fireEvent.change(role, { target: { value: SYSTEM_ROLE_IDS.REVIEWER } })
    expect(screen.getByRole('status').textContent).toBe('Aishah Binti Omar will be able to view the case list, view case details, claim / release cases, approve / reject cases, view flows, view project reports, export project reports in every project (including new ones).')
    fireEvent.click(screen.getByRole('button', { name: 'Invite user' }))
    const r = await row('Aishah Binti Omar')
    expect(r.textContent).toContain('Reviewer · All projects')
    expect(r.textContent).toContain('Pending')
  })

  it('Given Ali’s details, then his merchant role with Change role, and his project roles from Members (read-only)', async () => {
    renderAt('/users')
    fireEvent.click(within(await row('Ali Bin Ahmad')).getByRole('button', { name: 'Ali Bin Ahmad' }))
    const mine = await screen.findByRole('region', { name: 'Merchant role' })
    expect(mine.textContent).toContain('Member')
    const projects = screen.getByRole('region', { name: 'Project access' })
    expect(within(projects).getAllByRole('row').slice(1).map((r) => r.textContent?.slice(0, 20))).toEqual([expect.stringMatching(/^DefaultReviewer/), expect.stringMatching(/^SME appViewer/)])
    expect(within(projects).queryByRole('button')).toBeNull() // managed in Project › Members
    fireEvent.click(within(mine).getByRole('button', { name: /Change role/ }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Change role for Ali Bin Ahmad' }))
    const picker = dialog.getByLabelText('Merchant role') as HTMLSelectElement
    await waitFor(() => expect(within(picker).getAllByRole('option').length).toBeGreaterThan(2))
    fireEvent.change(picker, { target: { value: SYSTEM_ROLE_IDS.VIEWER } })
    fireEvent.click(dialog.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByRole('region', { name: 'Merchant role' }).textContent).toContain('Viewer'))
  })

  it('Given Ali’s details, when SME app is chosen under Effective access, then only Viewer permissions, from Viewer · SME app', async () => {
    renderAt(`/users?user=${fx('USR-2026-0012')}`)
    const ea = await screen.findByRole('region', { name: 'Effective access' })
    expect(within(ea).getByRole('rowheader', { name: 'Claim / release cases' }).closest('tr')!.textContent).toContain('Reviewer · Default')
    fireEvent.change(within(ea).getByLabelText('Project'), { target: { value: fx('PRJ-0002') } })
    expect(within(ea).queryByRole('rowheader', { name: 'Claim / release cases' })).toBeNull()
    expect(within(ea).getByRole('rowheader', { name: 'View case details' }).closest('tr')!.textContent).toContain('Viewer · SME app')
  })

  it('Given an Owner, then no platform staff in the list', async () => {
    renderAt('/users')
    await row('Ali Bin Ahmad')
    expect(screen.queryByRole('rowheader', { name: 'Daniel Tan' })).toBeNull()
    expect(screen.queryByLabelText('Type', { selector: 'select' })).toBeNull()
  })

  it('Given a super admin, when New user is Platform, then name, company email and one staff role (no merchant scope); listed as Platform (DEC-104)', async () => {
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
    await waitFor(() => expect(within(role).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose a role', 'Platform Admin (System Default)', 'Support (System Default)', 'Implementation (System Default)', 'Finance (System Default)']))
    expect(dialog.queryByText(/Merchant access|Selected merchants/)).toBeNull()
    fireEvent.change(role, { target: { value: fx('ROL-2026-0102') } }) // Support
    fireEvent.click(screen.getByRole('button', { name: 'Invite user' }))
    const r = await row('Mira Chen')
    expect(r.textContent).toContain('Support')
    expect(r.textContent).toContain('Platform (internal)')
  })

  it('Given a Reviewer, then Users is "No access"', async () => {
    useSession.getState().switchUser(ALI)
    renderAt('/users')
    await screen.findByRole('heading', { name: 'No access' })
  })

  it('Given the only Owner, then Change role and Suspend are shown disabled with the reason (DEC-78)', async () => {
    useSession.getState().switchUser(ADMIN)
    renderAt(`/users?user=${fx('USR-2026-0002')}`)
    const change = await screen.findByRole('button', { name: /Change role/ })
    expect((change as HTMLButtonElement).disabled).toBe(true)
    expect(change.parentElement!.getAttribute('title')).toBe(LAST_OWNER)
    expect((screen.getByRole('button', { name: 'Suspend' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('Roles (DEC-76, DEC-104)', () => {
  it('Given the Owner, then the System Default roles, read-only', async () => {
    renderAt('/roles')
    expect((await row('Reviewer')).textContent).toContain('System Default')
    fireEvent.click(within(await row('Reviewer')).getByRole('button', { name: 'Reviewer' }))
    await screen.findByText(/can’t be changed/)
    expect(screen.getByRole('checkbox', { name: 'Claim / release cases' }).matches(':disabled')).toBe(true) // inside a disabled fieldset
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('Given a new role, then Approve ticks Claim, View details and View list; unticking View list clears them; no permission shows the FRS message', async () => {
    renderAt('/roles')
    await row('Reviewer')
    fireEvent.click(screen.getByRole('button', { name: /New role/ }))
    fireEvent.change(await screen.findByLabelText('Role name'), { target: { value: 'Claimer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create role' }))
    expect(await screen.findByText(ROLE_NEEDS_PERMISSION)).toBeTruthy()
    const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement
    fireEvent.click(box('Approve / reject cases'))
    for (const p of ['View the case list', 'View case details', 'Claim / release cases']) expect(box(p).checked && !box(p).disabled).toBe(true)
    fireEvent.click(box('View the case list'))
    for (const p of ['View the case list', 'View case details', 'Claim / release cases', 'Approve / reject cases']) expect(box(p).checked).toBe(false)
    fireEvent.click(box('Claim / release cases'))
    fireEvent.click(screen.getByRole('button', { name: 'Create role' }))
    expect((await row('Claimer')).textContent).toContain('Custom')
  })

  it('Given the permission matrix, then Merchant-wide and Project-level rows with View and Actions; the module box ticks the whole row and shows "mixed" (DEC-102, DEC-104)', async () => {
    renderAt('/roles')
    await row('Reviewer')
    fireEvent.click(screen.getByRole('button', { name: /New role/ }))
    await screen.findByLabelText('Role name')
    expect(screen.getAllByRole('group').map((g) => g.querySelector('legend')?.textContent).filter(Boolean)).toEqual(expect.arrayContaining(['Merchant-wide', 'Project-level']))
    const users = screen.getByRole('rowheader', { name: /Users/ }).closest('tr')!
    expect(users.textContent).toBe('UsersViewInviteChange roleSuspend')
    expect(screen.getByRole('rowheader', { name: /Projects/ }).closest('tr')!.textContent).toBe('Projects—CreateRenameArchive') // no View
    expect(screen.getByRole('rowheader', { name: /Verifications/ }).closest('tr')!.textContent).toBe('VerificationsView listView detailsClaim / releaseApprove / reject')
    const all = screen.getByRole('checkbox', { name: 'All Users permissions' }) as HTMLInputElement
    fireEvent.click(all)
    for (const p of ['View users', 'Invite users', 'Change user role', 'Suspend users']) expect((screen.getByRole('checkbox', { name: p }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Suspend users' }))
    expect(all.checked).toBe(false)
    expect(all.indeterminate).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: 'View users' })) // unticking View clears what needs it
    expect(within(users).getAllByRole('checkbox').every((c) => !(c as HTMLInputElement).checked)).toBe(true)
  })

  it('Given New role as an Owner, then Type is locked to their merchant, then the generated Role ID, read-only (DEC-76, DEC-99)', async () => {
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
    fireEvent.click(screen.getByRole('checkbox', { name: 'View the case list' }))
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

  it('Given a super admin, when New role is Platform, then Platform-wide and Merchant data; Approve ticks Claim and View details; it lists as Platform', async () => {
    useSession.getState().switchUser(ADMIN)
    renderAt('/roles')
    expect((await row('Support')).textContent).toContain('Platform (internal)')
    fireEvent.click(screen.getByRole('button', { name: /New role/ }))
    const type = (await screen.findByLabelText('Type')) as HTMLSelectElement
    fireEvent.change(type, { target: { value: 'PLATFORM' } })
    expect(screen.queryByLabelText('Merchant')).toBeNull()
    expect(screen.getAllByRole('group').map((g) => g.querySelector('legend')?.textContent).filter(Boolean)).toEqual(expect.arrayContaining(['Platform-wide', 'Merchant data']))
    fireEvent.change(screen.getByLabelText('Role name'), { target: { value: 'Night reviewer' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Verifications · Approve / reject' }))
    for (const p of ['Verifications · View list', 'Verifications · View details', 'Verifications · Claim / release']) expect((screen.getByRole('checkbox', { name: p }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Create role' }))
    expect((await row('Night reviewer')).textContent).toContain('Platform (internal)')
  })

  it('Given a Custom role held by a user, then the Merchant column (super admin) and "Affects N users" before saving', async () => {
    const desk = await roleService.create(fx('MER-0001'), { name: 'Desk', permissions: ['VIEW_CASE_LIST'] }, OWNER)
    await userAdminService.addMember(fx('PRJ-0001'), SITI.userId, desk.roleId, OWNER)
    useSession.getState().switchUser(ADMIN)
    renderAt('/roles')
    const r = await row('Desk')
    expect(r.textContent).toContain('Atoz Software Tech')
    fireEvent.click(within(r).getByRole('button', { name: 'Desk' }))
    expect((await screen.findByRole('status')).textContent).toContain('Affects 1 user in 1 project')
  })

  it('Given a System Default role, when duplicated, then a Custom copy with its permissions is created', async () => {
    renderAt('/roles')
    fireEvent.click(within(await row('Reviewer')).getByRole('button', { name: 'Reviewer' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate' }))
    expect(((await screen.findByLabelText('Role name')) as HTMLInputElement).value).toBe('Copy of Reviewer')
    expect((screen.getByRole('checkbox', { name: 'Claim / release cases' }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Create role' }))
    expect((await row('Copy of Reviewer')).textContent).toContain('Custom')
  })
})

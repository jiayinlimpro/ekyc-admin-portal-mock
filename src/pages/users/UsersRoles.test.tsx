// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { routes } from '@/app/routes'
import { LAST_OWNER, ROLE_NEEDS_PERMISSION, SYSTEM_ROLE_IDS } from '@/domain/roles'
import { roleService } from '@/services/roleService'
import { devService } from '@/services/devService'
import { DEFAULT_DEV_FLAGS, useDevFlags } from '@/stores/devFlagsStore'
import { useSession } from '@/stores/sessionStore'
import { ADMIN, ALI, HAFIZ, OWNER, SITI } from '@/test/factories'
import { fx } from '@/lib/ids'

function renderAt(path: string) {
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />)
}
// REQ: DEC-109 — a merchant's Users and Roles are tabs of its Merchant settings; staff and platform roles are on Platform staff.
const atoz = (tab: 'users' | 'roles', query = '') => `/merchants/${fx('MER-0001')}?tab=${tab}${query}`
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
    renderAt(atoz('users', '&q=Ali'))
    expect((await row('Ali Bin Ahmad')).textContent).toContain('MemberReviewer · DefaultViewer · SME app')
    const headers = within(screen.getByRole('region', { name: 'User list' })).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual(['Full Name', 'Email', 'Access', 'Status', 'Created At'])
    cleanup()
    renderAt(atoz('users', '&status=PENDING'))
    expect(await screen.findByRole('rowheader', { name: 'Chong Pei Shan' })).toBeTruthy()
    expect(screen.queryByRole('rowheader', { name: 'Ali Bin Ahmad' })).toBeNull()
  })

  it('Given New user, then Type, User ID, then the merchant role (merchant roles only, Member by default) with the help text', async () => {
    renderAt(atoz('users'))
    fireEvent.click(await screen.findByRole('button', { name: /New user/ }))
    const id = (await screen.findByLabelText('User ID')) as HTMLInputElement
    await waitFor(() => expect(id.value).toMatch(/^usr_[a-z0-9]{24}$/))
    expect(id.disabled && id.readOnly).toBe(true)
    const [type, second] = within(id.closest('form')!).getAllByRole('textbox') as HTMLInputElement[]
    expect(type.value).toMatch(/^Merchant · /) // Type first, locked for a merchant admin (DEC-99)
    expect(second).toBe(id)
    fireEvent.change(await screen.findByLabelText('Full name'), { target: { value: 'Aishah Binti Omar' } })
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'aishah@atoz.example' } })
    const role = screen.getByLabelText('Merchant role') as HTMLSelectElement
    await waitFor(() => expect(within(role).getAllByRole('option').length).toBeGreaterThan(1))
    expect(within(role).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose a role', 'Owner (System Default)', 'Admin (System Default)', 'Billing (System Default)', 'Auditor (System Default)', 'Member (System Default)', 'User Coordinator'])
    expect(role.value).toBe(SYSTEM_ROLE_IDS.MEMBER)
    expect(screen.getByText(/For selected projects only, keep Member and add the user in Project › Members\./)).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Aishah Binti Omar will have no access until they are added to a project in Project › Members.')
    fireEvent.change(role, { target: { value: SYSTEM_ROLE_IDS.AUDITOR } })
    expect(screen.getByRole('status').textContent).toBe('Aishah Binti Omar will be able to view the case list, view audit log in every project (including new ones); and view merchant-wide reports, export merchant-wide reports for the whole merchant.')
    fireEvent.click(screen.getByRole('button', { name: 'Invite user' }))
    cleanup()
    renderAt(atoz('users', '&q=Aishah'))
    const r = await row('Aishah Binti Omar')
    expect(r.textContent).toContain('Auditor · All projects')
    expect(r.textContent).toContain('Pending')
  })

  it('Given Ali’s details, then his merchant role with Change role (merchant roles only), and his project roles from Members (read-only)', async () => {
    renderAt(atoz('users', `&user=${fx('USR-2026-0012')}`))
    const mine = await screen.findByRole('region', { name: 'Merchant role' })
    expect(mine.textContent).toContain('Member')
    const projects = screen.getByRole('region', { name: 'Project access' })
    expect(within(projects).getAllByRole('row').slice(1).map((r) => r.textContent?.slice(0, 20))).toEqual([expect.stringMatching(/^DefaultReviewer/), expect.stringMatching(/^SME appViewer/)])
    expect(within(projects).queryByRole('button')).toBeNull() // managed in Project › Members
    fireEvent.click(within(mine).getByRole('button', { name: /Change role/ }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Change role for Ali Bin Ahmad' }))
    const picker = dialog.getByLabelText('Merchant role') as HTMLSelectElement
    await waitFor(() => expect(within(picker).getAllByRole('option').length).toBeGreaterThan(2))
    expect(within(picker).queryByRole('option', { name: /Reviewer/ })).toBeNull() // project roles are given in Members
    fireEvent.change(picker, { target: { value: SYSTEM_ROLE_IDS.AUDITOR } })
    fireEvent.click(dialog.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByRole('region', { name: 'Merchant role' }).textContent).toContain('Auditor'))
  })

  it('Given Ali’s details, when SME app is chosen under Effective access, then only Viewer permissions, from Viewer · SME app', async () => {
    renderAt(atoz('users', `&user=${fx('USR-2026-0012')}`))
    const ea = await screen.findByRole('region', { name: 'Effective access' })
    expect(within(ea).getByRole('rowheader', { name: 'Claim / release cases' }).closest('tr')!.textContent).toContain('Reviewer · Default')
    fireEvent.change(within(ea).getByLabelText('Project'), { target: { value: fx('PRJ-0002') } })
    expect(within(ea).queryByRole('rowheader', { name: 'Claim / release cases' })).toBeNull()
    expect(within(ea).getByRole('rowheader', { name: 'View case details' }).closest('tr')!.textContent).toContain('Viewer · SME app')
  })

  it('Given an Owner, then no platform staff in the list', async () => {
    renderAt(atoz('users', '&q=Tan'))
    await row('Tan Mei Ling')
    expect(screen.queryByRole('rowheader', { name: 'Daniel Tan' })).toBeNull()
    expect(screen.queryByLabelText('Type', { selector: 'select' })).toBeNull()
  })

  it('Given a super admin on Platform staff, when New staff member, then Type is Platform, name, company email and one staff role (no merchant scope) (DEC-104, DEC-109)', async () => {
    useSession.getState().switchUser(ADMIN)
    renderAt('/platform-staff?q=Daniel')
    expect((await row('Daniel Tan')).textContent).toContain('Support')
    expect(screen.queryByRole('rowheader', { name: 'Tan Mei Ling' })).toBeNull() // merchant users are in Merchant settings
    fireEvent.click(screen.getByRole('button', { name: /New staff member/ }))
    const dialog = within(await screen.findByRole('dialog'))
    expect((dialog.getByLabelText('Type') as HTMLInputElement).value).toBe('Platform (internal)')
    expect(dialog.queryByLabelText('Merchant')).toBeNull()
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Mira Chen' } })
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'mira.chen@ekyc-platform.example' } })
    const role = screen.getByLabelText('Staff role')
    await waitFor(() => expect(within(role).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose a role', 'Platform Admin (System Default)', 'Support (System Default)', 'Implementation (System Default)', 'Finance (System Default)']))
    expect(dialog.queryByText(/Merchant access|Selected merchants/)).toBeNull()
    fireEvent.change(role, { target: { value: fx('ROL-2026-0102') } }) // Support
    fireEvent.click(screen.getByRole('button', { name: 'Invite user' }))
    cleanup()
    renderAt('/platform-staff?q=Mira')
    expect((await row('Mira Chen')).textContent).toContain('Support')
  })

  it('Given a Reviewer, then Platform staff is "No access" and Merchant settings has no Users tab', async () => {
    useSession.getState().switchUser(ALI)
    renderAt('/platform-staff')
    await screen.findByRole('heading', { name: 'No access' })
    cleanup()
    renderAt(atoz('users'))
    await screen.findByRole('region', { name: 'General' })
    expect(screen.queryByRole('tab', { name: 'Users' })).toBeNull()
  })

  it('Given the only Owner, then Change role and Suspend are shown disabled with the reason (DEC-78)', async () => {
    useSession.getState().switchUser(ADMIN)
    renderAt(atoz('users', `&user=${fx('USR-2026-0002')}`))
    const change = await screen.findByRole('button', { name: /Change role/ })
    expect((change as HTMLButtonElement).disabled).toBe(true)
    expect(change.parentElement!.getAttribute('title')).toBe(LAST_OWNER)
    expect((screen.getByRole('button', { name: 'Suspend' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('Roles: the merchant role table (DEC-76, DEC-104)', () => {
  it('Given the Owner, then merchant roles only (System Default read-only) and their Custom merchant role', async () => {
    renderAt(atoz('roles'))
    const list = await screen.findByRole('region', { name: 'Role list' })
    await within(list).findByRole('rowheader', { name: 'Owner' })
    expect(within(list).getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['Owner', 'Admin', 'Billing', 'Auditor', 'Member', 'User Coordinator'])
    fireEvent.click(within(await row('Auditor')).getByRole('button', { name: 'Auditor' }))
    await screen.findByText(/can’t be changed/)
    expect(screen.getByRole('checkbox', { name: 'View the case list' }).matches(':disabled')).toBe(true) // inside a disabled fieldset
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('Given a new merchant role, then every module; Approve ticks Claim, View details and View list; unticking View list clears them; no permission shows the FRS message', async () => {
    renderAt(atoz('roles'))
    await row('Owner')
    fireEvent.click(screen.getByRole('button', { name: /New role/ }))
    fireEvent.change(await screen.findByLabelText('Role name'), { target: { value: 'Claimer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create role' }))
    expect(await screen.findByText(ROLE_NEEDS_PERMISSION)).toBeTruthy()
    expect(screen.getByRole('rowheader', { name: /Users/ })).toBeTruthy() // merchant-wide modules are here
    const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement
    fireEvent.click(box('Approve / reject cases'))
    for (const p of ['View the case list', 'View case details', 'Claim / release cases']) expect(box(p).checked && !box(p).disabled).toBe(true)
    fireEvent.click(box('View the case list'))
    for (const p of ['View the case list', 'View case details', 'Claim / release cases', 'Approve / reject cases']) expect(box(p).checked).toBe(false)
    fireEvent.click(box('Claim / release cases'))
    fireEvent.click(screen.getByRole('button', { name: 'Create role' }))
    expect((await row('Claimer')).textContent).toContain('Custom')
  })

  it('Given the permission matrix, then one table of modules with View and Actions (no sections); the module box ticks the whole row and shows "mixed" (DEC-102, DEC-104)', async () => {
    renderAt(atoz('roles'))
    await row('Owner')
    fireEvent.click(screen.getByRole('button', { name: /New role/ }))
    await screen.findByLabelText('Role name')
    for (const old of ['Merchant-wide', 'Project-level', 'Platform-wide', 'Merchant data']) expect(screen.queryByText(old)).toBeNull()
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
    renderAt(atoz('roles'))
    await row('Owner')
    fireEvent.click(screen.getByRole('button', { name: /New role/ }))
    const id = (await screen.findByLabelText('Role ID')) as HTMLInputElement
    await waitFor(() => expect(id.value).toMatch(/^rol_[a-z0-9]{24}$/))
    expect(id.disabled && id.readOnly).toBe(true)
    const form = id.closest('form')!
    const [type, second] = within(form).getAllByRole('textbox') as HTMLInputElement[]
    expect(type.value).toBe('Merchant role · Atoz Software Tech') // Type first, locked for a merchant admin
    expect(type.disabled).toBe(true)
    expect(second).toBe(id)
    fireEvent.change(screen.getByLabelText('Role name'), { target: { value: 'Night shift' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'View the case list' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Inactive' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create role' }))
    expect((await row('Night shift')).textContent).toContain('Inactive')
  })

  it('Given the Actions menu, then a Custom role nobody holds can be deactivated; Owner can’t, with the reason', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await roleService.create(fx('MER-0001'), { name: 'Spare desk', permissions: ['VIEW_USERS'] }, OWNER)
    renderAt(atoz('roles'))
    fireEvent.click(within(await row('Owner')).getByRole('button', { name: 'Actions for Owner' }))
    const item = await screen.findByRole('menuitem', { name: /Deactivate/ })
    expect(item.getAttribute('aria-disabled') ?? item.getAttribute('data-disabled')).toBeTruthy()
    expect(item.textContent).toContain('can’t be deactivated')
    fireEvent.keyDown(item, { key: 'Escape' })
    cleanup()
    renderAt(atoz('roles'))
    fireEvent.click(within(await row('Spare desk')).getByRole('button', { name: 'Actions for Spare desk' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Deactivate' }))
    await waitFor(async () => expect((await row('Spare desk')).textContent).toContain('Inactive'))
  })

  it('Given a super admin on Platform staff › Platform roles, when New role, then Type is Platform, one table (no sections); Approve ticks Claim and View details (DEC-109)', async () => {
    useSession.getState().switchUser(ADMIN)
    renderAt('/platform-staff?tab=roles')
    await row('Support')
    expect(screen.queryByRole('rowheader', { name: 'Owner' })).toBeNull() // merchant roles are in Merchant settings
    fireEvent.click(screen.getByRole('button', { name: /New role/ }))
    expect(((await screen.findByLabelText('Type')) as HTMLInputElement).value).toBe('Platform (internal)')
    expect(screen.queryByLabelText('Merchant')).toBeNull()
    expect(screen.getByRole('rowheader', { name: /Merchants/ })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Role name'), { target: { value: 'Night reviewer' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Verifications · Approve / reject' }))
    for (const p of ['Verifications · View list', 'Verifications · View details', 'Verifications · Claim / release']) expect((screen.getByRole('checkbox', { name: p }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Create role' }))
    expect((await row('Night reviewer')).textContent).toContain('Custom')
  })

  it('Given a Custom merchant role held by a user, then the super admin sees it in Atoz’s roles and "Affects N users" before saving', async () => {
    useSession.getState().switchUser(ADMIN)
    renderAt(atoz('roles'))
    const r = await row('User Coordinator')
    expect(screen.queryByRole('rowheader', { name: 'Support' })).toBeNull() // platform roles are on Platform staff
    fireEvent.click(within(r).getByRole('button', { name: 'User Coordinator' }))
    expect((await screen.findByRole('status')).textContent).toContain('Affects 1 user in 2 projects')
  })

  it('Given a System Default role, when duplicated, then a Custom copy with its permissions is created', async () => {
    renderAt(atoz('roles'))
    fireEvent.click(within(await row('Auditor')).getByRole('button', { name: 'Auditor' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate' }))
    expect(((await screen.findByLabelText('Role name')) as HTMLInputElement).value).toBe('Copy of Auditor')
    expect((screen.getByRole('checkbox', { name: 'View the case list' }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Create role' }))
    expect((await row('Copy of Auditor')).textContent).toContain('Custom')
  })
})

describe('Project Settings › Roles: a project’s role table (DEC-104)', () => {
  it('Given SME app, then the System Default project roles and its own Custom role; New role shows project modules only', async () => {
    useSession.getState().selectProject(fx('PRJ-0002'))
    renderAt('/project-settings?tab=roles')
    const list = await screen.findByRole('region', { name: 'Project roles' })
    await within(list).findByRole('rowheader', { name: 'Reviewer' })
    expect(within(list).getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['Project Admin', 'Reviewer', 'Developer', 'Viewer', 'Release Tester'])
    fireEvent.click(screen.getByRole('button', { name: /New role/ }))
    const type = (await screen.findByLabelText('Type')) as HTMLInputElement
    expect(type.value).toBe('Project role · SME app')
    expect(screen.queryByRole('rowheader', { name: /^All Users permissions/ })).toBeNull()
    expect(screen.getByRole('rowheader', { name: /Project roles/ })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Role name'), { target: { value: 'Night reviewer' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Claim / release cases' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create role' }))
    expect((await row('Night reviewer')).textContent).toContain('Custom')
  })

  it('Given Duplicate from another project, then Default’s Fraud Checker is copied into SME app', async () => {
    useSession.getState().selectProject(fx('PRJ-0002'))
    renderAt('/project-settings?tab=roles')
    await screen.findByRole('rowheader', { name: 'Release Tester' })
    fireEvent.click(screen.getByRole('button', { name: /Duplicate from another project/ }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Duplicate from another project' }))
    expect((dialog.getByLabelText('Project') as HTMLSelectElement).value).toBe(fx('PRJ-0001'))
    const role = dialog.getByLabelText('Role') as HTMLSelectElement
    await waitFor(() => expect(within(role).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose a role', 'Fraud Checker']))
    fireEvent.change(role, { target: { value: fx('ROL-2026-0021') } })
    fireEvent.click(dialog.getByRole('button', { name: 'Continue' }))
    expect(((await screen.findByLabelText('Role name')) as HTMLInputElement).value).toBe('Copy of Fraud Checker')
    fireEvent.click(screen.getByRole('button', { name: 'Create role' }))
    expect((await row('Copy of Fraud Checker')).textContent).toContain('Custom')
  })

  it('Given Hafiz (Project Admin of SME app), then he manages SME app’s roles; a Reviewer has no Roles tab content', async () => {
    useSession.getState().switchUser(HAFIZ)
    renderAt('/project-settings?tab=roles')
    expect(await screen.findByRole('button', { name: /New role/ })).toBeTruthy()
    cleanup()
    useSession.getState().switchUser(SITI)
    renderAt('/project-settings?tab=roles')
    expect(await screen.findByText(/Project roles need the View project roles permission/)).toBeTruthy()
  })
})

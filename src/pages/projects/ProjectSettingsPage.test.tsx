// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { routes } from '@/app/routes'
import { db } from '@/mocks/mockDb'
import { devService } from '@/services/devService'
import { DEFAULT_DEV_FLAGS, useDevFlags } from '@/stores/devFlagsStore'
import { useSession } from '@/stores/sessionStore'
import { ADMIN, HAFIZ, OWNER } from '@/test/factories'
import { fx } from '@/lib/ids'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}
const panel = async () => within(await screen.findByRole('tabpanel'))
const tab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }))

beforeEach(async () => {
  useDevFlags.setState({ ...DEFAULT_DEV_FLAGS, simulateLatency: false })
  await devService.resetDemoData()
  useSession.getState().switchUser(OWNER)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Project Settings (DEC-54, DEC-96)', () => {
  it('Given the Owner on SME app, when renamed, then the header follows; when archived, then back to the Merchants page (DEC-109)', async () => {
    useSession.getState().selectProject(fx('PRJ-0002'))
    const router = renderAt('/project-settings')
    const project = within(await screen.findByRole('region', { name: 'Project' }))
    fireEvent.click(project.getByRole('button', { name: /Rename/ }))
    fireEvent.change(await screen.findByLabelText(/^Project name/, { selector: '#p-name' }), { target: { value: 'SME portal' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('button', { name: 'Switch project. Current: SME portal' })).toBeTruthy()
    fireEvent.click(within(screen.getByRole('region', { name: 'Project' })).getByRole('button', { name: /Archive/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Archive project' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(db.state().projects.find((p) => p.projectId === fx('PRJ-0002'))!.status).toBe('ARCHIVED')
  })

  it('Given the Project Admin changes the language, then it saves and is audited', async () => {
    useSession.getState().switchUser(HAFIZ) // one project: no picker
    renderAt('/project-settings')
    fireEvent.change((await panel()).getByLabelText('Language'), { target: { value: 'ms' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save general settings' }))
    await waitFor(() => expect(db.state().projects.find((p) => p.projectId === fx('PRJ-0002'))!.language).toBe('ms'))
    expect(db.state().audit.at(-1)).toMatchObject({ action: 'PROJECT_SETTING_CHANGED', projectId: fx('PRJ-0002') })
  })

  it('Given the Super admin, then General is open to them (DEC-75)', async () => {
    useSession.getState().switchUser(ADMIN)
    useSession.getState().selectProject(fx('PRJ-0003'))
    renderAt('/project-settings')
    expect(await (await panel()).findByRole('button', { name: 'Save general settings' })).toBeTruthy()
    tab('Review operations')
    expect(await (await panel()).findByLabelText(/claim timeout/i)).toBeTruthy()
  })

  it('Given Review operations, then minutes are typed, the seconds show beside them in brackets; 0 is refused and 20 min saves as 1,200 s (DEC-53)', async () => {
    useSession.getState().selectProject(fx('PRJ-0001'))
    renderAt('/project-settings?tab=review')
    const p = await panel()
    expect((p.getByLabelText(/claim timeout/i) as HTMLInputElement).value).toBe('30')
    expect(p.getByText('(1,800 seconds)')).toBeTruthy()
    fireEvent.change(p.getByLabelText(/claim timeout/i), { target: { value: '0' } })
    fireEvent.click(p.getByRole('button', { name: 'Save' }))
    expect((await p.findByRole('alert')).textContent).toMatch(/at least 1/)
    fireEvent.change(p.getByLabelText(/claim timeout/i), { target: { value: '20' } })
    expect(p.getByText('(1,200 seconds)')).toBeTruthy()
    fireEvent.click(p.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(db.state().projects.find((x) => x.projectId === fx('PRJ-0001'))!.claimTimeoutSec).toBe(1200))
  })

  it('Given Decision reasons, then System Default reasons only turn off, "Other" stays on, and a Custom reason can be added and edited (DEC-106)', async () => {
    useSession.getState().selectProject(fx('PRJ-0001'))
    renderAt('/project-settings?tab=review')
    const p = await panel()
    const reject = within(p.getByRole('table', { name: 'Reject reasons' }))
    const row = (t: typeof reject, name: string) => within(t.getByRole('rowheader', { name }).closest('tr')!)
    expect(row(reject, 'Customer on internal watchlist').getByText('Custom')).toBeTruthy()
    expect(row(reject, 'Below minimum age').queryByRole('button', { name: /Edit/ })).toBeNull() // System Default: locked
    expect((row(reject, 'Other').getByRole('switch') as HTMLButtonElement).disabled).toBe(true)
    expect(row(reject, 'Other').getByText('Always on')).toBeTruthy()

    fireEvent.click(row(reject, 'Below minimum age').getByRole('switch'))
    await waitFor(() => expect(db.state().projects.find((x) => x.projectId === fx('PRJ-0001'))!.decisionReasons.disabledSystemCodes).toEqual(['UNDERAGE']))

    fireEvent.click(p.getByRole('button', { name: /New reason/ }))
    const dialog = within(await screen.findByRole('dialog'))
    fireEvent.click(dialog.getByLabelText('Approve'))
    fireEvent.change(dialog.getByLabelText('Name'), { target: { value: 'Branch staff met the customer' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Add reason' }))
    const approve = within((await panel()).getByRole('table', { name: 'Approve reasons' }))
    expect(await approve.findByRole('rowheader', { name: 'Branch staff met the customer' })).toBeTruthy()

    fireEvent.click(approve.getByRole('button', { name: 'Edit Identity confirmed by video call' }))
    const edit = within(await screen.findByRole('dialog'))
    fireEvent.change(edit.getByLabelText('Name'), { target: { value: 'Branch staff met the customer' } })
    fireEvent.click(edit.getByRole('button', { name: 'Save' }))
    expect(await edit.findByText('An Approve reason with this name already exists.')).toBeTruthy()
  })

  it('Given an old ?tab=routing link, then General opens; there is no Routing tab (DEC-95: every session names its flow)', async () => {
    useSession.getState().selectProject(fx('PRJ-0001'))
    renderAt('/project-settings?tab=routing')
    await panel()
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['General', 'Review operations'])
  })

  it('Given an old ?tab=integration link, then General opens: API keys and the webhook are on each flow (DEC-117)', async () => {
    useSession.getState().selectProject(fx('PRJ-0001'))
    renderAt('/project-settings?tab=integration')
    expect(await (await panel()).findByRole('button', { name: 'Save general settings' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Integration' })).toBeNull()
    expect(screen.queryByText(/Redirect URLs|IP allowlist|web origins/)).toBeNull()
  })
})

describe('Members, in the project sidebar (DEC-77, DEC-109)', () => {
  it('Given Hafiz (Project Admin of SME app), when he types Siti’s email, then she is recognised as a user of the merchant (no Full name, Add member) and added as Reviewer (DEC-77)', async () => {
    useSession.getState().switchUser(HAFIZ)
    renderAt('/members')
    const p = within(await screen.findByRole('region', { name: 'Members' }))
    const owner = (await p.findByRole('rowheader', { name: 'Tan Mei Ling' })).closest('tr')!
    expect(owner.textContent).toContain('Owner · All projectsinherited')
    expect(within(owner).queryByRole('button')).toBeNull()
    expect(p.getByRole('button', { name: 'Remove Viewer for Ali Bin Ahmad' })).toBeTruthy()
    expect(p.queryByRole('radio')).toBeNull() // one field, no Existing / New tabs
    const email = p.getByLabelText('Email')
    await waitFor(() => expect(document.querySelectorAll('#mb-users option').length).toBeGreaterThan(1)) // suggestions
    fireEvent.change(email, { target: { value: 'Siti.Yusof@atoz.example' } })
    expect(p.getByText('· already a user of this merchant')).toBeTruthy()
    expect(p.queryByLabelText('Full name')).toBeNull()
    const role = p.getByLabelText('Project role')
    await waitFor(() => expect(within(role).getAllByRole('option').map((o) => o.textContent)).not.toContain('Owner'))
    fireEvent.change(role, { target: { value: fx('ROL-2026-0003') } })
    fireEvent.click(p.getByRole('button', { name: 'Add' }))
    expect((await p.findByRole('rowheader', { name: 'Siti Aminah Binti Yusof' })).closest('tr')!.textContent).toContain('Reviewer')
    expect(screen.queryByRole('dialog')).toBeNull() // an existing user is added at once
  })

  it('Given an email that is not a user yet, when Add, then the invitation dialog asks for the name and says what happens; Send invitation lists them as Reviewer, Pending, and a Member of the merchant (DEC-77, OQ-27)', async () => {
    useSession.getState().switchUser(HAFIZ)
    renderAt('/members')
    const p = within(await screen.findByRole('region', { name: 'Members' }))
    expect(p.queryByLabelText('Full name')).toBeNull()
    fireEvent.change(await p.findByLabelText('Email'), { target: { value: 'farah.ismail@atoz.example' } })
    const role = p.getByLabelText('Project role')
    await waitFor(() => expect(within(role).getAllByRole('option').length).toBeGreaterThan(1))
    fireEvent.change(role, { target: { value: fx('ROL-2026-0003') } })
    fireEvent.click(p.getByRole('button', { name: 'Add' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Invite a new person to Atoz Software Tech?' }))
    expect(dialog.getByText('farah.ismail@atoz.example')).toBeTruthy()
    expect(dialog.getByText(/: no access in other projects\./)).toBeTruthy()
    expect(dialog.getByText(/stays Pending until they accept/)).toBeTruthy()
    fireEvent.click(dialog.getByRole('button', { name: 'Send invitation' }))
    expect(await dialog.findByText('Enter a full name.')).toBeTruthy()
    fireEvent.change(dialog.getByLabelText('Full name'), { target: { value: 'Farah Binti Ismail' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Send invitation' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const row = (await p.findByRole('rowheader', { name: 'Farah Binti Ismail' })).closest('tr')!
    expect(row.textContent).toContain('Reviewer')
    expect(row.textContent).toContain('Pending')
    const farah = db.state().accounts.find((a) => a.email === 'farah.ismail@atoz.example')!
    expect(farah.assignments.map((x) => x.scope.kind)).toEqual(['ALL_PROJECTS', 'PROJECTS']) // Member + the project role
  })

  it('Given a mistyped email, when Add, then the dialog says it is not a user yet, and Back returns to the form with the email kept (DEC-77)', async () => {
    useSession.getState().switchUser(HAFIZ)
    renderAt('/members')
    const p = within(await screen.findByRole('region', { name: 'Members' }))
    const email = (await p.findByLabelText('Email')) as HTMLInputElement
    fireEvent.change(email, { target: { value: 'siti.yusuf@atoz.example' } }) // a typo of siti.yusof
    const role = p.getByLabelText('Project role')
    await waitFor(() => expect(within(role).getAllByRole('option').length).toBeGreaterThan(1))
    fireEvent.change(role, { target: { value: fx('ROL-2026-0003') } })
    fireEvent.click(p.getByRole('button', { name: 'Add' }))
    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByText(/isn’t a user of Atoz Software Tech yet/)).toBeTruthy()
    fireEvent.click(dialog.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(email.value).toBe('siti.yusuf@atoz.example')
    expect(db.state().accounts.some((a) => a.email === 'siti.yusuf@atoz.example')).toBe(false) // nothing saved
  })

  it('Given the email of another merchant’s user, when Add, then refused under the field, and no dialog opens (DEC-104)', async () => {
    useSession.getState().switchUser(HAFIZ)
    renderAt('/members')
    const p = within(await screen.findByRole('region', { name: 'Members' }))
    fireEvent.change(await p.findByLabelText('Email'), { target: { value: 'kavitha.s@vantage.example' } })
    const role = p.getByLabelText('Project role')
    await waitFor(() => expect(within(role).getAllByRole('option').length).toBeGreaterThan(1))
    fireEvent.change(role, { target: { value: fx('ROL-2026-0003') } })
    fireEvent.click(p.getByRole('button', { name: 'Add' }))
    expect((await p.findByRole('alert')).textContent).toBe('This email belongs to a user of another merchant. A user belongs to one merchant only.')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Given Aaron (Users › Invite only), then Members opens for inviting new people only (no suggestions), and no project role he could give (DEC-74, DEC-77)', async () => {
    useSession.getState().switchUser({ userId: fx('USR-2026-0022'), fullName: 'Aaron Teoh' })
    useSession.getState().selectProject(fx('PRJ-0001'))
    renderAt('/members')
    const p = within(await screen.findByRole('region', { name: 'Members' }))
    await waitFor(() => expect(p.getByLabelText('Project role')).toHaveProperty('disabled', true))
    expect(p.getByLabelText('Email').getAttribute('list')).toBeNull()
    expect(p.getByText(/Adding an existing user to a project needs Members › Add \/ remove/)).toBeTruthy()
    expect(p.getByText(/You hold no project permissions/)).toBeTruthy()
    expect(p.queryByRole('button', { name: /^Remove / })).toBeNull()
  })
})

describe('No access yet (DEC-73)', () => {
  it('Given a user whose only assignment was removed, then they see "You don’t have access to any project yet"', async () => {
    const pei = db.state().accounts.find((a) => a.userId === fx('USR-2026-0035'))!
    db.setState((st) => ({ accounts: st.accounts.map((a) => (a.userId === pei.userId ? { ...a, status: 'ACTIVE' as const, assignments: [] } : a)) }))
    useSession.getState().switchUser({ userId: pei.userId, fullName: pei.fullName })
    renderAt('/')
    expect(await screen.findByText('You don’t have access to any project yet')).toBeTruthy()
  })
})

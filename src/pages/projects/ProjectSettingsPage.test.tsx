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
  it('Given "All my projects", then it asks for a project; picking one sets the header and opens General', async () => {
    renderAt('/project-settings')
    fireEvent.click(within(await screen.findByRole('list', { name: 'Choose a project' })).getByRole('button', { name: /SME app/ }))
    expect(((await panel()).getByLabelText('Project name') as HTMLInputElement).value).toBe('SME app')
    expect(useSession.getState().projectId).toBe(fx('PRJ-0002'))
  })

  it('Given the Project Admin changes the language, then it saves and is audited', async () => {
    useSession.getState().switchUser(HAFIZ) // one project: no picker
    renderAt('/project-settings')
    fireEvent.change((await panel()).getByLabelText('Language'), { target: { value: 'ms' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save general settings' }))
    await waitFor(() => expect(db.state().projects.find((p) => p.projectId === fx('PRJ-0002'))!.language).toBe('ms'))
    expect(db.state().audit.at(-1)).toMatchObject({ action: 'PROJECT_SETTING_CHANGED', projectId: fx('PRJ-0002') })
  })

  it('Given Integration, when the Owner creates a key, then its secret is shown once and the key is listed', async () => {
    useSession.getState().selectProject(fx('PRJ-0001'))
    renderAt('/project-settings?tab=integration')
    fireEvent.click((await panel()).getByRole('button', { name: /Create key/ }))
    fireEvent.change(await screen.findByLabelText('Key name'), { target: { value: 'Staging' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create key' }))
    expect((await screen.findByLabelText('Secret')).textContent).toMatch(/^sk_mock_[0-9a-f]{32}$/)
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.getByRole('rowheader', { name: 'Staging' })).toBeTruthy())
  })

  it('Given an http:// webhook, then the field error shows', async () => {
    useSession.getState().selectProject(fx('PRJ-0001'))
    renderAt('/project-settings?tab=integration')
    const p = await panel()
    fireEvent.change(await p.findByLabelText('Endpoint URL (HTTPS)'), { target: { value: 'http://hooks.example' } })
    fireEvent.click(p.getByRole('button', { name: 'Save webhook' }))
    expect((await p.findByRole('alert')).textContent).toBe('Webhook URL must start with https://')
  })

  it('Given the Super admin, then Integration and General are open to them (DEC-75)', async () => {
    useSession.getState().switchUser(ADMIN)
    useSession.getState().selectProject(fx('PRJ-0003'))
    renderAt('/project-settings?tab=integration')
    expect(await (await panel()).findByRole('button', { name: /Create key/ })).toBeTruthy()
    tab('General')
    expect((await panel()).getByRole('button', { name: 'Save general settings' })).toBeTruthy()
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

  it('Given Routing, then the default flow and the passport rule are shown read-only (DEC-95)', async () => {
    useSession.getState().selectProject(fx('PRJ-0001'))
    renderAt('/project-settings?tab=routing')
    const p = await panel()
    expect(await p.findByText('Rule · priority 1 · Document type is Passport')).toBeTruthy()
    expect(p.getByText(/^Default:/)).toBeTruthy()
    expect(p.queryByRole('button')).toBeNull()
  })
})

describe('Project Settings › Members (DEC-77)', () => {
  it('Given Hafiz (Project Admin of SME app), then inherited All projects users are marked and he adds Siti as Reviewer', async () => {
    useSession.getState().switchUser(HAFIZ)
    renderAt('/project-settings?tab=members')
    const p = await panel()
    const owner = (await p.findByRole('rowheader', { name: 'Tan Mei Ling' })).closest('tr')!
    expect(owner.textContent).toContain('Owner · All projectsinherited')
    expect(within(owner).queryByRole('button')).toBeNull()
    expect(p.getByRole('button', { name: 'Remove Viewer for Ali Bin Ahmad' })).toBeTruthy()
    const user = p.getByLabelText('User')
    await waitFor(() => expect(within(user).getAllByRole('option').length).toBeGreaterThan(1))
    fireEvent.change(user, { target: { value: fx('USR-2026-0031') } })
    const role = p.getByLabelText('Project role')
    await waitFor(() => expect(within(role).getAllByRole('option').map((o) => o.textContent)).not.toContain('Owner'))
    fireEvent.change(role, { target: { value: fx('ROL-2026-0003') } })
    fireEvent.click(p.getByRole('button', { name: /Add member/ }))
    expect((await p.findByRole('rowheader', { name: 'Siti Aminah Binti Yusof' })).closest('tr')!.textContent).toContain('Reviewer')
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

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { LANDING_TAB } from '@/app/tabs'
import { ADMIN, ALI, HAFIZ, OWNER } from '@/test/factories'
import { devService } from '@/services/devService'
import { useSession } from '@/stores/sessionStore'
import { useTabs } from '@/stores/tabsStore'
import { useUi } from '@/stores/uiStore'
import { routes } from './routes'
import { caseIdOf, fx } from '@/lib/ids'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}

const mainNav = () => within(screen.getByRole('navigation', { name: 'Main' }))
const tabs = () => within(screen.getByRole('navigation', { name: 'Open pages' }))

beforeEach(async () => {
  await devService.resetDemoData()
  useSession.getState().switchUser(ALI)
  useTabs.setState({ tabs: [LANDING_TAB] })
  useUi.setState({ closedGroups: [], sidebarCollapsed: false })
})
afterEach(cleanup)

describe('AppShell', () => {
  it('Given a Reviewer, then the menu has the dashboards, Billing and Verifications, but no Audit Log, admin screens or Manual Review Queue (DEC-70, DEC-73, DEC-80)', async () => {
    renderAt('/')
    await mainNav().findByRole('link', { name: 'Verifications' })
    for (const shown of ['Overview', 'System Intelligence', 'Billing']) expect(mainNav().getByRole('link', { name: shown })).toBeTruthy()
    for (const hidden of [/Audit Logs/, /eKYC Workflow/, /Users/, /Developers/, /Merchants/, /Manual Review/]) {
      expect(mainNav().queryByRole('link', { name: hidden })).toBeNull()
    }
  })

  it('Given a group header, then it is not a link: it opens and closes its screens, and the choice is kept', async () => {
    renderAt('/verifications')
    const header = await mainNav().findByRole('button', { name: 'Dashboards' })
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(mainNav().queryByRole('link', { name: 'Dashboards' })).toBeNull()
    fireEvent.click(header)
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(mainNav().queryByRole('link', { name: 'Overview' })).toBeNull()
    expect(useUi.getState().closedGroups).toEqual(['Dashboards'])
    fireEvent.click(header)
    expect(mainNav().getByRole('link', { name: 'Overview' })).toBeTruthy()
  })

  it('Given the current screen’s group was closed, then opening the screen opens its group', async () => {
    useUi.setState({ closedGroups: ['eKYC'] })
    renderAt('/verifications')
    await mainNav().findByRole('link', { name: 'Verifications' })
    expect(useUi.getState().closedGroups).toEqual([])
  })

  it('Given the Owner, then the Audit Log is in the menu', async () => {
    useSession.getState().switchUser(OWNER)
    renderAt('/')
    await mainNav().findByRole('link', { name: /Audit Logs/ })
  })

  it('Given a Super admin, then admin screens and Verifications are in the menu (DEC-75)', async () => {
    useSession.getState().switchUser(ADMIN)
    renderAt('/')
    await mainNav().findByRole('link', { name: /Merchants/ })
    for (const shown of ['Users', 'Roles', /Billing/, /Audit Logs/, 'Workflow Registry', 'Projects', 'Merchants', 'Super admins', 'Verifications']) expect(mainNav().getByRole('link', { name: shown })).toBeTruthy()
    for (const retired of [/eKYC Workflow/, /Developers/, 'Users and Access', /Merchant Workflow Directory/]) expect(mainNav().queryByRole('link', { name: retired })).toBeNull()
  })

  it('Given a Super admin, then the groups in order, Users and Roles under User Management, Audit Logs under Governance, Projects in eKYC, and no Flows or Project Settings entries (DEC-103)', async () => {
    useSession.getState().switchUser(ADMIN)
    renderAt('/')
    await mainNav().findByRole('link', { name: /Merchants/ })
    expect(mainNav().getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Dashboards', 'eKYC', 'User Management', 'Governance', 'Platform'])
    const group = (name: string) => within(screen.getByRole('region', { name })).getAllByRole('link').map((l) => l.textContent)
    expect(group('eKYC')).toEqual(['Verifications', 'Projects'])
    expect(group('User Management')).toEqual(['Users', 'Roles'])
    expect(group('Governance')).toEqual(['Audit Logs'])
    for (const gone of ['Flows', 'Project Settings']) expect(mainNav().queryByRole('link', { name: gone })).toBeNull()
  })

  it('Given Flows (opened from a project), then the breadcrumb reads eKYC › Projects › Flows and Projects stays highlighted in the menu (DEC-103)', async () => {
    useSession.getState().switchUser(OWNER)
    useSession.getState().selectProject(fx('PRJ-0001'))
    renderAt('/flows')
    const crumbs = await screen.findByRole('navigation', { name: 'Breadcrumb' })
    await waitFor(() => expect(within(crumbs).getAllByRole('listitem').map((l) => l.textContent)).toEqual(['eKYC', 'Projects', 'Flows']))
    expect(within(crumbs).getByRole('link', { name: 'Projects' }).getAttribute('href')).toBe('/projects')
    expect(mainNav().getByRole('link', { name: 'Projects' }).className).toContain('font-medium')
  })

  it('Given a collapsed sidebar, then only group icons; opening one shows a flyout with the group name and its screens (DEC-103)', async () => {
    useSession.getState().switchUser(OWNER)
    useUi.setState({ sidebarCollapsed: true })
    const router = renderAt('/dashboard')
    const group = await mainNav().findByRole('button', { name: 'User Management' })
    expect(mainNav().queryByRole('link', { name: 'Users' })).toBeNull() // no item links in the narrow sidebar
    expect(mainNav().getByRole('button', { name: 'Dashboards' }).className).toContain('font-medium') // the current group
    fireEvent.click(group)
    const flyout = await screen.findByRole('menu')
    expect(within(flyout).getByText('User Management')).toBeTruthy()
    expect(within(flyout).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Users', 'Roles'])
    fireEvent.click(within(flyout).getByRole('menuitem', { name: 'Roles' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/roles'))
  })

  it('Given a Billing user opens the portal, then Billing (no Overview for this role, no Overview tab), and no cases or projects (DEC-104)', async () => {
    useSession.getState().switchUser({ userId: fx('USR-2026-0037'), fullName: 'Muthu A/L Rajan' })
    const router = renderAt('/')
    await waitFor(() => expect(router.state.location.pathname).toBe('/billing'))
    expect(tabs().queryByRole('link', { name: 'Overview' })).toBeNull()
    for (const hidden of ['Verifications', 'Projects', 'Users']) expect(mainNav().queryByRole('link', { name: hidden })).toBeNull()
  })

  it('Given a Reviewer opens the Audit Log URL directly, then "No access" (DEC-72)', async () => {
    renderAt('/audit')
    await screen.findByRole('heading', { name: 'No access' })
  })

  it('Given Ali (two projects), then the switcher offers "All my projects" and his projects with his role in each; picking one shows it and his role there (DEC-73)', async () => {
    renderAt('/dashboard')
    fireEvent.click(await screen.findByRole('button', { name: 'Switch project. Current: All my projects' }))
    const options = await screen.findAllByRole('menuitemradio')
    expect(options.map((o) => o.textContent)).toEqual(['All my projects', 'DefaultReviewer', 'SME appViewer'])
    fireEvent.click(options[2])
    await screen.findByRole('button', { name: 'Switch project. Current: SME app' })
    expect(useSession.getState()).toMatchObject({ projectId: fx('PRJ-0002') })
    fireEvent.click(screen.getByRole('button', { name: 'Account: Ali Bin Ahmad' }))
    expect((await screen.findByLabelText('Your role')).textContent).toBe('Viewer · SME app')
    expect(screen.getByText('ali.ahmad@atoz.example')).toBeTruthy()
  })

  it('Given a user with one project, then it is shown without a switcher', async () => {
    useSession.getState().switchUser(HAFIZ)
    renderAt('/dashboard')
    await screen.findByLabelText('Current project: SME app')
    expect(screen.queryByRole('button', { name: /Switch project/ })).toBeNull()
  })

  it('Given the Super admin, then projects are grouped by merchant and picking one selects it', async () => {
    useSession.getState().switchUser(ADMIN)
    renderAt('/dashboard')
    fireEvent.click(await screen.findByRole('button', { name: /Switch project/ }))
    const vantage = within((await screen.findByText('Vantage')).closest('[role="group"]') as HTMLElement)
    fireEvent.click(vantage.getByRole('menuitemradio', { name: /Default/ }))
    await waitFor(() => expect(useSession.getState()).toMatchObject({ projectId: fx('PRJ-0003') }))
  })

  it('Given I open the portal root, then I land on Overview and there is no Home page, tab or menu item', async () => {
    const router = renderAt('/')
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
    expect(tabs().getByRole('link', { name: 'Overview' })).toBeTruthy()
    expect(tabs().queryByRole('button', { name: 'Close Overview' })).toBeNull()
    expect(mainNav().queryByRole('link', { name: 'Home' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'UAT scenarios' })).toBeNull()
  })

  it('Given a page visit, then a tab opens; the case tab is renamed to its Reference ID; closing the active tab goes left', async () => {
    const router = renderAt('/billing')
    expect(tabs().getByRole('link', { name: 'Billing' })).toBeTruthy()
    await act(() => router.navigate(`/verifications/${caseIdOf('KYC-260901-900003')}`))
    expect(await tabs().findByRole('link', { name: 'KYC-260901-900003' })).toBeTruthy()
    fireEvent.click(tabs().getByRole('button', { name: 'Close KYC-260901-900003' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/billing'))
    expect(tabs().queryByRole('button', { name: 'Close Overview' })).toBeNull()
  })

  it('Given ?as=<email>, then the session switches to Siti and the parameter is removed', async () => {
    const router = renderAt(`/verifications/${caseIdOf('KYC-260901-900010')}?as=siti.yusof@atoz.example`)
    await waitFor(() => expect(useSession.getState().actor.userId).toBe(fx('USR-2026-0031')))
    await waitFor(() => expect(router.state.location.search).toBe(''))
  })

  it('Given a reviewer opens an admin URL directly, then "No access"', async () => {
    renderAt('/registry')
    await screen.findByRole('heading', { name: 'No access' })
  })

  it('Given a retired screen URL (eKYC Workflow), then "Page not found" (DEC-85)', () => {
    renderAt('/workflow')
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeTruthy()
  })

  it('Given an unknown URL, then "Page not found"', () => {
    renderAt('/manual-review-queue')
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeTruthy()
  })
})

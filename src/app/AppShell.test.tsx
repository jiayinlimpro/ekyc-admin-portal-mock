// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { ADMIN, ALI, OWNER } from '@/test/factories'
import { devService } from '@/services/devService'
import { useSession } from '@/stores/sessionStore'
import { useUi } from '@/stores/uiStore'
import { routes } from './routes'
import { caseIdOf, fx } from '@/lib/ids'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}

const mainNav = () => within(screen.getByRole('navigation', { name: 'Main' }))

beforeEach(async () => {
  await devService.resetDemoData()
  useSession.getState().switchUser(ALI)
  useUi.setState({ closedGroups: [], sidebarCollapsed: false })
})
afterEach(cleanup)

describe('AppShell', () => {
  // REQ: DEC-109 — inner screens work on one project; outer screens (Merchants, platform modules) don't.
  const inProject = (projectId = fx('PRJ-0001')) => useSession.getState().selectProject(projectId)

  it('Given a Reviewer in a project, then the menu has the dashboards, Billing and Verifications, but no Audit Log, platform modules or Manual Review Queue (DEC-70, DEC-80)', async () => {
    inProject()
    renderAt('/dashboard')
    await mainNav().findByRole('link', { name: 'Verifications' })
    for (const shown of ['Overview', 'System Intelligence', 'Billing']) expect(mainNav().getByRole('link', { name: shown })).toBeTruthy()
    for (const hidden of [/Audit Logs/, /eKYC Workflow/, /Users/, /Developers/, /Merchants/, /Super admins/, /Workflow Registry/, /Manual Review/]) {
      expect(mainNav().queryByRole('link', { name: hidden })).toBeNull()
    }
  })

  it('Given a group header, then it is not a link: it opens and closes its screens, and the choice is kept', async () => {
    inProject()
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
    inProject()
    useUi.setState({ closedGroups: ['eKYC'] })
    renderAt('/verifications')
    await mainNav().findByRole('link', { name: 'Verifications' })
    expect(useUi.getState().closedGroups).toEqual([])
  })

  it('Given the Owner in a project, then the Audit Log is in the menu', async () => {
    useSession.getState().switchUser(OWNER)
    inProject()
    renderAt('/dashboard')
    await mainNav().findByRole('link', { name: /Audit Logs/ })
  })

  it('Given a Super admin on the Merchants page, then only the outer menu: Merchants and the platform modules (DEC-109)', async () => {
    useSession.getState().switchUser(ADMIN)
    renderAt('/')
    await mainNav().findByRole('link', { name: 'Merchants' })
    expect(mainNav().getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Platform'])
    expect(within(screen.getByRole('region', { name: 'Platform' })).getAllByRole('link').map((l) => l.textContent)).toEqual(['Super admins', 'Platform staff', 'Workflow Registry'])
    for (const inner of ['Overview', 'Verifications', 'Flows', 'Billing', 'Audit Logs', 'Project Settings', 'Users', 'Roles', 'Projects']) expect(mainNav().queryByRole('link', { name: inner })).toBeNull()
    for (const retired of [/eKYC Workflow/, /Developers/, 'Users and Access', /Merchant Workflow Directory/]) expect(mainNav().queryByRole('link', { name: retired })).toBeNull()
  })

  it('Given a Super admin in a project, then Project Settings, then the groups in order with Flows in eKYC and Members, Roles in User Management, and no platform modules (DEC-103, DEC-109)', async () => {
    useSession.getState().switchUser(ADMIN)
    inProject()
    renderAt('/dashboard')
    await mainNav().findByRole('link', { name: 'Verifications' })
    expect(mainNav().getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Dashboards', 'eKYC', 'User Management', 'Governance'])
    const group = (name: string) => within(screen.getByRole('region', { name })).getAllByRole('link').map((l) => l.textContent)
    expect(group('Dashboards')).toEqual(['Overview', 'System Intelligence', 'Billing'])
    expect(group('eKYC')).toEqual(['Verifications', 'Flows'])
    expect(group('User Management')).toEqual(['Members', 'Roles'])
    expect(group('Governance')).toEqual(['Audit Logs'])
    expect(mainNav().getByRole('link', { name: 'Project Settings' })).toBeTruthy()
    for (const outer of ['Merchants', 'Super admins', 'Platform staff', 'Workflow Registry']) expect(mainNav().queryByRole('link', { name: outer })).toBeNull()
  })

  it('Given a flow, then the breadcrumb reads Merchant / Project › eKYC › Flows › the flow, and Flows stays highlighted in the menu (DEC-103, DEC-109)', async () => {
    useSession.getState().switchUser(OWNER)
    inProject()
    renderAt(`/flows/${fx('FLW-0001')}`)
    const crumbs = await screen.findByRole('navigation', { name: 'Breadcrumb' })
    await waitFor(() => expect(within(crumbs).getAllByRole('listitem').map((l) => l.textContent)).toEqual(['Atoz Software Tech', '/Default', 'eKYC', 'Flows', 'Flow Detail']))
    expect(within(crumbs).getByRole('link', { name: 'Flows' }).getAttribute('href')).toBe('/flows')
    expect(mainNav().getByRole('link', { name: 'Flows' }).className).toContain('font-medium')
  })

  it('Given a collapsed sidebar, then only group icons; opening one shows a flyout with the group name and its screens (DEC-103)', async () => {
    useSession.getState().switchUser(OWNER)
    inProject()
    useUi.setState({ sidebarCollapsed: true })
    const router = renderAt('/dashboard')
    const group = await mainNav().findByRole('button', { name: 'eKYC' })
    expect(mainNav().queryByRole('link', { name: 'Verifications' })).toBeNull() // no item links in the narrow sidebar
    expect(mainNav().getByRole('button', { name: 'Dashboards' }).className).toContain('font-medium') // the current group
    fireEvent.click(group)
    const flyout = await screen.findByRole('menu')
    expect(within(flyout).getByText('eKYC')).toBeTruthy()
    expect(within(flyout).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Verifications', 'Flows'])
    fireEvent.click(within(flyout).getByRole('menuitem', { name: 'Flows' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/flows'))
  })

  it('Given a Billing user goes to a project, then Billing (no Overview for this role), and no cases or flows (DEC-104, DEC-109)', async () => {
    useSession.getState().switchUser({ userId: fx('USR-2026-0037'), fullName: 'Muthu A/L Rajan' })
    const router = renderAt('/')
    fireEvent.click(await screen.findByRole('button', { name: 'Go to project Default' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/billing'))
    for (const hidden of ['Overview', 'Verifications', 'Flows', 'Users']) expect(mainNav().queryByRole('link', { name: hidden })).toBeNull()
  })

  it('Given a Reviewer opens the Audit Log URL directly, then "No access" (DEC-72)', async () => {
    inProject()
    renderAt('/audit')
    await screen.findByRole('heading', { name: 'No access' })
  })

  it('Given Ali in Default, then the project switcher offers his Atoz projects with his role in each (no "All my projects"); picking one shows it and his role there (DEC-73, DEC-109)', async () => {
    inProject()
    renderAt('/dashboard')
    fireEvent.click(await screen.findByRole('button', { name: 'Switch project. Current: Default' }))
    const options = await screen.findAllByRole('menuitemradio')
    expect(options.map((o) => o.textContent)).toEqual(['DefaultReviewer', 'SME appViewer'])
    fireEvent.click(options[1])
    await screen.findByRole('button', { name: 'Switch project. Current: SME app' })
    expect(useSession.getState()).toMatchObject({ projectId: fx('PRJ-0002') })
    fireEvent.click(screen.getByRole('button', { name: 'Account: Ali Bin Ahmad' }))
    expect((await screen.findByLabelText('Your role')).textContent).toBe('Viewer · SME app')
    expect(screen.getByText('ali.ahmad@atoz.example')).toBeTruthy()
  })

  it('Given the merchant switcher, when All merchants, then back to the Merchants page', async () => {
    inProject()
    const router = renderAt('/verifications')
    fireEvent.click(await screen.findByRole('button', { name: 'Switch merchant. Current: Atoz Software Tech' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'All merchants' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(await screen.findByRole('heading', { name: 'Merchants', level: 1 })).toBeTruthy()
  })

  it('Given the Super admin, when Vantage is picked in the merchant switcher, then its Default project opens on its landing page', async () => {
    useSession.getState().switchUser(ADMIN)
    inProject()
    const router = renderAt('/verifications')
    fireEvent.click(await screen.findByRole('button', { name: /Switch merchant/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Vantage' }))
    await waitFor(() => expect(useSession.getState()).toMatchObject({ projectId: fx('PRJ-0003') }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
  })

  it('Given a case link from another project, then that project is selected (DEC-109)', async () => {
    inProject(fx('PRJ-0002'))
    renderAt(`/verifications/${caseIdOf('KYC-260901-900003')}`)
    await waitFor(() => expect(useSession.getState().projectId).toBe(fx('PRJ-0001')))
    expect(await screen.findByRole('button', { name: 'Switch project. Current: Default' })).toBeTruthy()
  })

  it('Given I open the portal root, then the Merchants page, with no tab strip, Home or UAT link (DEC-109)', async () => {
    const router = renderAt('/')
    expect(await screen.findByRole('heading', { name: 'Merchants', level: 1 })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/')
    expect(screen.queryByRole('navigation', { name: 'Open pages' })).toBeNull()
    expect(mainNav().queryByRole('link', { name: 'Home' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'UAT scenarios' })).toBeNull()
  })

  it('Given pages inside a project, then no tab strip; the case page’s breadcrumb ends with its Reference ID', async () => {
    inProject()
    const router = renderAt('/billing')
    await mainNav().findByRole('link', { name: 'Billing' })
    expect(screen.queryByRole('navigation', { name: 'Open pages' })).toBeNull()
    await act(() => router.navigate(`/verifications/${caseIdOf('KYC-260901-900003')}`))
    const crumbs = within(screen.getByRole('navigation', { name: 'Breadcrumb' }))
    await waitFor(() => expect(crumbs.getAllByRole('listitem').at(-1)!.textContent).toBe('KYC-260901-900003'))
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

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { LANDING_TAB } from '@/app/tabs'
import { ADMIN, ALI, OWNER } from '@/test/factories'
import { devService } from '@/services/devService'
import { useSession } from '@/stores/sessionStore'
import { useTabs } from '@/stores/tabsStore'
import { routes } from './routes'

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

  it('Given the Merchant Owner, then the Audit Log is in the menu', async () => {
    useSession.getState().switchUser(OWNER)
    renderAt('/')
    await mainNav().findByRole('link', { name: /Audit Logs/ })
  })

  it('Given a Platform Admin, then admin screens are in the menu and Verifications is not (OQ-20)', async () => {
    useSession.getState().switchUser(ADMIN)
    renderAt('/')
    await mainNav().findByRole('link', { name: /Merchants/ })
    for (const shown of [/eKYC Workflow/, /Users/, /Billing/, /Developers/, /Audit Logs/]) expect(mainNav().getByRole('link', { name: shown })).toBeTruthy()
    expect(mainNav().queryByRole('link', { name: 'Verifications' })).toBeNull()
  })

  it('Given a Reviewer opens the Audit Log URL directly, then "No access" (DEC-72)', async () => {
    renderAt('/audit')
    await screen.findByRole('heading', { name: 'No access' })
  })

  it('Given I open the portal root, then I land on Overview and there is no Home page, tab or menu item', async () => {
    const router = renderAt('/')
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
    expect(tabs().getByRole('link', { name: 'Overview' })).toBeTruthy()
    expect(tabs().queryByRole('button', { name: 'Close Overview' })).toBeNull()
    expect(mainNav().queryByRole('link', { name: 'Home' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'UAT scenarios' })).toBeNull()
  })

  it('Given a page visit, then a tab opens; the detail tab is titled with the Reference No; closing the active tab goes left', async () => {
    const router = renderAt('/billing')
    expect(tabs().getByRole('link', { name: 'Billing' })).toBeTruthy()
    await act(() => router.navigate('/verifications/KYC-260901-900003'))
    expect(tabs().getByRole('link', { name: 'KYC-260901-900003' })).toBeTruthy()
    fireEvent.click(tabs().getByRole('button', { name: 'Close KYC-260901-900003' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/billing'))
    expect(tabs().queryByRole('button', { name: 'Close Overview' })).toBeNull()
  })

  it('Given ?as=USR-2026-0031, then the session switches to Siti and the parameter is removed', async () => {
    const router = renderAt('/verifications/KYC-260901-900010?as=USR-2026-0031')
    await waitFor(() => expect(useSession.getState().actor.userId).toBe('USR-2026-0031'))
    await waitFor(() => expect(router.state.location.search).toBe(''))
  })

  it('Given a reviewer opens an admin URL directly, then "No access"', () => {
    renderAt('/workflow')
    expect(screen.getByRole('heading', { name: 'No access' })).toBeTruthy()
  })

  it('Given an unknown URL, then "Page not found"', () => {
    renderAt('/manual-review-queue')
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeTruthy()
  })
})

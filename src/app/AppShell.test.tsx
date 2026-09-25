// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { HOME_TAB } from '@/app/tabs'
import { ADMIN, ALI } from '@/test/factories'
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

beforeEach(() => {
  useSession.getState().switchUser(ALI)
  useTabs.setState({ tabs: [HOME_TAB] })
})
afterEach(cleanup)

describe('AppShell', () => {
  it('Given a Merchant Reviewer, then the menu hides admin screens and has no Manual Review Queue (DEC-70, DEC-80)', () => {
    renderAt('/')
    expect(mainNav().getByRole('link', { name: 'Verifications' })).toBeTruthy()
    expect(mainNav().getByRole('link', { name: /Audit Logs/ })).toBeTruthy()
    for (const hidden of [/eKYC Workflow/, /Users/, /Billing/, /Developers/, /Manual Review/]) {
      expect(mainNav().queryByRole('link', { name: hidden })).toBeNull()
    }
  })

  it('Given a Platform Admin, then admin screens are in the menu', () => {
    useSession.getState().switchUser(ADMIN)
    renderAt('/')
    for (const shown of [/eKYC Workflow/, /Users/, /Billing/, /Developers/]) expect(mainNav().getByRole('link', { name: shown })).toBeTruthy()
  })

  it('Given a page visit, then a tab opens; the detail tab is titled with the Reference No; closing the active tab goes left', async () => {
    const router = renderAt('/audit')
    expect(tabs().getByRole('link', { name: 'Audit Logs' })).toBeTruthy()
    await act(() => router.navigate('/verifications/KYC-260901-900003'))
    expect(tabs().getByRole('link', { name: 'KYC-260901-900003' })).toBeTruthy()
    fireEvent.click(tabs().getByRole('button', { name: 'Close KYC-260901-900003' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/audit'))
    expect(tabs().queryByRole('button', { name: 'Close Home' })).toBeNull()
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

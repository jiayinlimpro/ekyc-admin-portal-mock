// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { routes } from '@/app/routes'
import { caseIdOf, fx } from '@/lib/ids'
import { devService } from '@/services/devService'
import { DEFAULT_DEV_FLAGS, useDevFlags } from '@/stores/devFlagsStore'
import { useSession } from '@/stores/sessionStore'

const DANIEL = { userId: fx('USR-2026-0006'), fullName: 'Daniel Tan' } // Support
const MARCUS = { userId: fx('USR-2026-0009'), fullName: 'Marcus Lee' } // Implementation
const HANNAH = { userId: fx('USR-2026-0008'), fullName: 'Hannah Lee' } // Finance
const renderAt = (path: string) => {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}
const mainNav = () => within(screen.getByRole('navigation', { name: 'Main' }))

beforeEach(async () => {
  useDevFlags.setState({ ...DEFAULT_DEV_FLAGS, simulateLatency: false })
  await devService.resetDemoData()
  useSession.getState().switchUser(DANIEL)
  useSession.getState().selectProject(fx('PRJ-0001')) // REQ: DEC-109 — the inner portal works on one project
})
afterEach(cleanup)

describe('screens for platform staff (DEC-99, DEC-104)', () => {
  it('Given Support in a project, then the menu has what the role allows: cases, flows, settings (keys) and the audit log; no dashboards or platform modules', async () => {
    renderAt('/verifications')
    await mainNav().findByRole('link', { name: 'Verifications' })
    for (const shown of ['Verifications', 'Flows', 'Project Settings', 'Audit Logs']) expect(mainNav().getByRole('link', { name: shown })).toBeTruthy()
    for (const hidden of ['Overview', 'Billing', 'Merchants', 'Super admins', 'Platform staff', 'Workflow Registry']) expect(mainNav().queryByRole('link', { name: hidden })).toBeNull()
  })

  it('Given Support opens the portal, then the Merchants page; Go to project lands on Verifications (no Overview for this role) (DEC-109)', async () => {
    const router = renderAt('/')
    fireEvent.click(await screen.findByRole('button', { name: 'Go to project SME app' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/verifications'))
    expect(useSession.getState().projectId).toBe(fx('PRJ-0002'))
    await screen.findByRole('navigation', { name: 'Main' })
    expect(within(screen.getByRole('navigation', { name: 'Main' })).queryByRole('link', { name: 'Overview' })).toBeNull()
  })

  it('Given Support opens a case, then the full page, no masking; the view is logged', async () => {
    renderAt(`/verifications/${caseIdOf('KYC-260901-900003')}`)
    expect(await screen.findByText(/Your view is logged/)).toBeTruthy()
    expect(screen.getByRole('img', { name: /front \(sample image/ })).toBeTruthy()
  })

  it('Given Implementation on Merchants, then every merchant and New merchant (DEC-109)', async () => {
    useSession.getState().switchUser(MARCUS)
    renderAt('/')
    expect(await screen.findByRole('heading', { name: 'Tesla' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /New merchant/ })).toBeTruthy()
  })

  it('Given Support on Flows, then the flows read-only: no New flow, and the detail says read-only', async () => {
    renderAt('/flows')
    await screen.findByRole('link', { name: 'Malaysian onboarding' })
    expect(screen.queryByRole('button', { name: /New flow/ })).toBeNull()
    cleanup()
    renderAt(`/flows/${fx('FLW-0001')}`)
    expect(await screen.findByText('Read-only: you can view this flow but not change it.')).toBeTruthy()
  })

  it('Given Support on Project Settings › Integration, then keys read-only (View, not Manage)', async () => {
    renderAt('/project-settings?tab=integration')
    expect(await screen.findByText(/Read-only: you can view API keys/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Create key/ })).toBeNull()
  })

  it('Given Finance, then Billing with Export, but no Verifications', async () => {
    useSession.getState().switchUser(HANNAH)
    useSession.getState().selectProject(fx('PRJ-0001'))
    renderAt('/billing')
    expect(await screen.findByRole('button', { name: /Export CSV/ })).toBeTruthy()
    expect(mainNav().queryByRole('link', { name: 'Verifications' })).toBeNull()
  })
})

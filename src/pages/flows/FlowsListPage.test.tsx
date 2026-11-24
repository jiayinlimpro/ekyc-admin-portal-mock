// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { routes } from '@/app/routes'
import { db } from '@/mocks/mockDb'
import { devService } from '@/services/devService'
import { DEFAULT_DEV_FLAGS, useDevFlags } from '@/stores/devFlagsStore'
import { useSession } from '@/stores/sessionStore'
import { ADMIN, OWNER } from '@/test/factories'
import { fx } from '@/lib/ids'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}
const row = async (name: string) => (await screen.findByRole('link', { name })).closest('tr')!
const menu = async (name: string) => {
  fireEvent.click(within(await row(name)).getByRole('button', { name: `Actions for ${name}` }))
  return screen.findAllByRole('menuitem')
}

beforeEach(async () => {
  useDevFlags.setState({ ...DEFAULT_DEV_FLAGS, simulateLatency: false })
  await devService.resetDemoData()
  useSession.getState().switchUser(OWNER)
  useSession.getState().selectProject(fx('PRJ-0001'))
})
afterEach(cleanup)

describe('Flows List (DEC-94)', () => {
  it('Given Atoz Default, then each flow with its revision and open cases, no Default badge or Routing column; the draft has no revision', async () => {
    renderAt('/flows')
    const malaysian = await row('Malaysian onboarding')
    expect(malaysian.textContent).not.toContain('Default') // REQ: DEC-95 — no default flow
    expect(malaysian.textContent).toContain('W4-R2')
    expect((await row('Foreigner onboarding')).textContent).not.toContain('Rule P1')
    expect(screen.queryByRole('columnheader', { name: 'Routing' })).toBeNull() // REQ: DEC-95 — no routing
    const draft = await row('Tourist onboarding')
    expect(draft.textContent).toContain('Draft')
    expect(within(draft).getAllByRole('cell')[1].textContent).toBe('—')
  })

  it('Given any Active flow, when Retire is chosen, then the dialog warns that its Flow ID is refused from now on and Retire is enabled (DEC-95)', async () => {
    renderAt('/flows')
    const items = await menu('Malaysian onboarding')
    expect(items.map((m) => m.textContent)).not.toContain('Set as default')
    fireEvent.click(items.find((m) => m.textContent === 'Retire')!)
    expect(await screen.findByText(/New sessions sent with its Flow ID are refused/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retire flow' }))
    await waitFor(() => expect(db.state().flows.find((f) => f.flowId === fx('FLW-0001'))!.status).toBe('RETIRING'))
  })

  it('Given New flow, then only Active versions are offered and it opens Flow Detail as Draft', async () => {
    const router = renderAt('/flows')
    fireEvent.click(await screen.findByRole('button', { name: /New flow/ }))
    const version = await screen.findByLabelText('Workflow version')
    await waitFor(() => expect(within(version).getAllByRole('option').map((o) => o.getAttribute('value'))).toEqual(['W1', 'W3', 'W4', 'W5']))
    fireEvent.change(screen.getByLabelText('Flow name'), { target: { value: 'Students' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create flow' }))
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/flows\/flw_[a-z0-9]{24}$/))
  })

  it('Given a Draft, when duplicated, then a "(copy)" Draft appears', async () => {
    renderAt('/flows')
    fireEvent.click((await menu('Tourist onboarding')).find((m) => m.textContent?.trim() === 'Duplicate')!)
    expect(await screen.findByRole('link', { name: 'Tourist onboarding (copy)' })).toBeTruthy()
  })

  it('Given the Super admin on Vantage, then they manage its flows too (DEC-75)', async () => {
    useSession.getState().switchUser(ADMIN)
    useSession.getState().selectProject(fx('PRJ-0003'))
    renderAt('/flows')
    expect(await row('Standard onboarding')).toBeTruthy()
    expect(screen.getByRole('button', { name: /New flow/ })).toBeTruthy()
  })

  it('Given Atoz Default, then the super admin sees the W6 trial marked Internal only; the Owner doesn’t see it (DEC-56)', async () => {
    useSession.getState().switchUser(ADMIN)
    useSession.getState().selectProject(fx('PRJ-0001'))
    renderAt('/flows')
    expect((await row('Next engine trial')).textContent).toContain('Internal only')
    cleanup()
    useSession.getState().switchUser(OWNER)
    useSession.getState().selectProject(fx('PRJ-0001'))
    renderAt('/flows')
    await row('Malaysian onboarding')
    expect(screen.queryByRole('link', { name: 'Next engine trial' })).toBeNull()
  })
})

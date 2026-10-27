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
const row = async (code: string) => (await screen.findByRole('button', { name: new RegExp(`^${code} ·`) })).closest('tr')!
const entry = (code: string) => db.state().registry.find((e) => e.code === code)!

beforeEach(async () => {
  useDevFlags.setState({ ...DEFAULT_DEV_FLAGS, simulateLatency: false })
  await devService.resetDemoData()
  useSession.getState().switchUser(ADMIN)
})
afterEach(cleanup)

describe('Workflow Registry (DEC-56 … DEC-58)', () => {
  it('Given V5 in Limited release, then Edit shows Merchant access; ticking Vantage gives it access (DEC-56)', async () => {
    renderAt('/registry')
    fireEvent.click(within(await row('V5')).getByRole('button', { name: 'Edit V5' }))
    const access = within(await screen.findByRole('group', { name: 'Merchant access' }))
    expect((access.getByLabelText('Atoz Software Tech') as HTMLInputElement).checked).toBe(true)
    fireEvent.click(access.getByLabelText(/Vantage/))
    fireEvent.change(screen.getByLabelText('Release note'), { target: { value: 'Pilot with Vantage' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(entry('V5').accessMerchantIds).toHaveLength(2))
    fireEvent.click(within(await row('V4')).getByRole('button', { name: 'Edit V4' }))
    await screen.findByRole('dialog')
    expect(screen.queryByRole('group', { name: 'Merchant access' })).toBeNull() // only for Limited release
  })

  it('Given Change status, then every other status is offered, with what it means (DEC-56)', async () => {
    renderAt('/registry')
    fireEvent.click(within(await row('V6')).getByRole('button', { name: 'Change status of V6' }))
    const select = (await screen.findByLabelText('New status')) as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual(['Draft', 'Limited release', 'Active', 'Deprecated'])
    fireEvent.change(select, { target: { value: 'LIMITED_RELEASE' } })
    expect(screen.getByText(/the merchants ticked under Merchant access/)).toBeTruthy()
  })

  it('Given the list, then each version with status, default and the flows using it; expanding shows them', async () => {
    renderAt('/registry')
    const v1 = await row('V1')
    expect(v1.textContent).toContain('Default for new merchants')
    expect((await row('V5')).textContent).toContain('Limited release1 merchant(s)') // DEC-56: Atoz only
    expect((await row('V6')).textContent).toContain('Internal testing')
    fireEvent.click(within(await row('V3')).getByRole('button', { name: /^V3 ·/ }))
    const list = within(await screen.findByRole('list', { name: 'Flows using V3' }))
    expect(list.getByText(/Atoz Software Tech › SME app ›/)).toBeTruthy()
  })

  it('Given a flow under a version, when its link is clicked, then the flow opens inside its project (DEC-109)', async () => {
    const router = renderAt('/registry')
    fireEvent.click(within(await row('V3')).getByRole('button', { name: /^V3 ·/ }))
    fireEvent.click(within(await screen.findByRole('list', { name: 'Flows using V3' })).getByRole('link', { name: 'SME director check' }))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/flows/${fx('FLW-0004')}`))
    expect(useSession.getState().projectId).toBe(fx('PRJ-0002'))
    expect(await screen.findByRole('button', { name: 'Switch project. Current: SME app' })).toBeTruthy()
  })

  it('Given a new version, then it is registered as Draft; a used code is refused', async () => {
    renderAt('/registry')
    await row('V1')
    fireEvent.click(screen.getByRole('button', { name: /Register version/ }))
    fireEvent.change(await screen.findByLabelText('Workflow code'), { target: { value: 'V4' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Duplicate' } })
    fireEvent.change(screen.getByLabelText('Release note'), { target: { value: 'First draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Register' }))
    expect(await screen.findByText('Workflow code already exists')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Workflow code'), { target: { value: 'V7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Register' }))
    await waitFor(() => expect(entry('V7')).toMatchObject({ status: 'DRAFT', name: 'Duplicate' }))
  })

  it('Given an active version, then only name, description and state machines can be edited', async () => {
    renderAt('/registry')
    fireEvent.click(within(await row('V4')).getByRole('button', { name: 'Edit V4' }))
    expect((await screen.findByLabelText('Face match compares') as HTMLSelectElement).disabled).toBe(true)
    expect((screen.getByLabelText('Name') as HTMLInputElement).disabled).toBe(false)
  })

  it('Given the default V1, then deprecating it is refused until another version is the default', async () => {
    renderAt('/registry')
    fireEvent.click(within(await row('V1')).getByRole('button', { name: 'Change status of V1' }))
    fireEvent.change(await screen.findByLabelText('Reason for change'), { target: { value: 'Replaced' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change status' }))
    expect(await screen.findByText('Set another version as default first: the default for new merchants must stay Active.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(within(await row('V3')).getByRole('button', { name: 'Make V3 the default' }))
    await waitFor(() => expect(entry('V3').isDefault).toBe(true))
  })

  it('Given a merchant user, then the registry is "No access"', async () => {
    useSession.getState().switchUser(OWNER)
    renderAt('/registry')
    await screen.findByRole('heading', { name: 'No access' })
  })
})

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
  it('Given the list, then each version with status, default and the flows using it; expanding shows them', async () => {
    renderAt('/registry')
    const v1 = await row('V1')
    expect(v1.textContent).toContain('Default for new merchants')
    expect((await row('V5')).textContent).toContain('Active') // DEC-107: V5 lets flows set the risk minimums
    fireEvent.click(within(await row('V3')).getByRole('button', { name: /^V3 ·/ }))
    const list = within(await screen.findByRole('list', { name: 'Flows using V3' }))
    expect(list.getByText(/Atoz Software Tech › SME app ›/)).toBeTruthy()
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
    fireEvent.change(screen.getByLabelText('Workflow code'), { target: { value: 'V6' } })
    fireEvent.click(screen.getByRole('button', { name: 'Register' }))
    await waitFor(() => expect(entry('V6')).toMatchObject({ status: 'DRAFT', name: 'Duplicate' }))
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
    expect(await screen.findByText('Set another version as default before deprecating this version')).toBeTruthy()
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

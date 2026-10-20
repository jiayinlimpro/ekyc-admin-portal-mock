// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { routes } from '@/app/routes'
import { auditService } from '@/services/auditService'
import { devService } from '@/services/devService'
import { DEFAULT_DEV_FLAGS, useDevFlags } from '@/stores/devFlagsStore'
import { useSession } from '@/stores/sessionStore'
import { ADMIN, SITI } from '@/test/factories'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}

beforeEach(async () => {
  useDevFlags.setState({ ...DEFAULT_DEV_FLAGS, simulateLatency: false })
  useSession.getState().switchUser(ADMIN)
  await devService.resetDemoData()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Merchants', () => {
  it('Given a new V4 merchant, then it gets MER-0007, config v1.0.0 (audited as the first deploy) and can be deleted while empty', async () => {
    renderAt('/uam/merchants')
    await screen.findByText('Atoz Software Tech')
    fireEvent.click(screen.getByRole('button', { name: /New merchant/ }))
    fireEvent.change(await screen.findByLabelText('Merchant name'), { target: { value: 'Nusantara Pay' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create merchant' }))
    const row = (await screen.findByText('Nusantara Pay')).closest('tr')!
    expect(row.textContent).toContain('MER-0007')
    expect(row.textContent).toContain('v1.0.0')
    const deploys = await auditService.list({ merchantId: 'MER-0007', actions: ['CONFIG_DEPLOY'] }, ADMIN)
    expect(deploys.total).toBe(1)

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(within(row).getByRole('button', { name: 'Delete Nusantara Pay' }))
    await waitFor(() => expect(screen.queryByText('Nusantara Pay')).toBeNull())
  })

  it('Given a duplicate name, then the dialog shows the error', async () => {
    renderAt('/uam/merchants')
    await screen.findByText('Atoz Software Tech')
    fireEvent.click(screen.getByRole('button', { name: /New merchant/ }))
    fireEvent.change(await screen.findByLabelText('Merchant name'), { target: { value: 'tesla' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create merchant' }))
    expect((await screen.findByRole('alert')).textContent).toBe('A merchant with this name already exists.')
  })

  it('Given a merchant with records, then Delete is disabled', async () => {
    renderAt('/uam/merchants')
    const row = (await screen.findByText('Atoz Software Tech')).closest('tr')!
    expect((within(row).getByRole('button', { name: /can’t be deleted/ }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('Login (mock)', () => {
  it('Given I pick Siti, then I am signed in as her and land on Overview (no Home page)', async () => {
    const router = renderAt('/login')
    fireEvent.click(await screen.findByRole('button', { name: /Siti Aminah Binti Yusof/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
    expect(useSession.getState().actor.userId).toBe(SITI.userId)
  })
})

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { routes } from '@/app/routes'
import { auditService } from '@/services/auditService'
import { devService } from '@/services/devService'
import { isServiceError } from '@/services/errors'
import { uamService } from '@/services/uamService'
import { verificationService } from '@/services/verificationService'
import { DEFAULT_DEV_FLAGS, useDevFlags } from '@/stores/devFlagsStore'
import { useSession } from '@/stores/sessionStore'
import { ADMIN, ALI, SITI } from '@/test/factories'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}
const region = (name: string) => within(screen.getByRole('region', { name }))

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

describe('Users', () => {
  it('Given a new Merchant Reviewer, then they appear with the next user ID', async () => {
    renderAt('/uam/users')
    await screen.findByText('Ali Bin Ahmad')
    fireEvent.click(screen.getByRole('button', { name: /New user/ }))
    fireEvent.change(await screen.findByLabelText('Full name'), { target: { value: 'Aishah Binti Omar' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create user' }))
    const row = (await screen.findByText('Aishah Binti Omar')).closest('tr')!
    expect(row.textContent).toContain('USR-2026-0081')
    expect(row.textContent).toContain('Merchant Reviewer')
  })

  it('Given Siti is deactivated, then she cannot claim (service-enforced) and is not offered as a reviewer', async () => {
    await uamService.setUserActive(SITI.userId, false, ADMIN)
    const err = await verificationService.claim('KYC-260901-900010', SITI).catch((e: unknown) => e)
    expect(isServiceError(err) && err.code).toBe('FORBIDDEN')
    await expect(verificationService.claim('KYC-260901-900010', ALI)).resolves.toBeTruthy()
  })

  it('Given I am the admin, then I cannot deactivate myself', async () => {
    await expect(uamService.setUserActive(ADMIN.userId, false, ADMIN)).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('Given a Merchant Reviewer, then UAM screens are not accessible', () => {
    useSession.getState().switchUser(ALI)
    renderAt('/uam/users')
    expect(screen.getByRole('heading', { name: 'No access' })).toBeTruthy()
  })
})

describe('Roles', () => {
  it('shows the 2-role permission matrix', async () => {
    renderAt('/uam/roles')
    const matrix = region('Permission matrix')
    const manage = matrix.getByText('Manage users').closest('tr')!
    expect(within(manage).getAllByRole('img').map((i) => i.getAttribute('aria-label'))).toEqual(['Allowed', 'Not allowed'])
    const review = matrix.getByText('Review').closest('tr')!
    expect(within(review).getAllByRole('img').map((i) => i.getAttribute('aria-label'))).toEqual(['Allowed', 'Allowed'])
  })
})

describe('Developers', () => {
  it('Given reveal and rotate, then the secret is a mock key and rotation is audited with a new key ID', async () => {
    useSession.getState().selectMerchant('MER-0002')
    renderAt('/developers')
    const key = region('API key')
    await waitFor(() => expect(key.getByText('key_mock_mer-0002_01')).toBeTruthy())
    fireEvent.click(key.getByRole('button', { name: /Reveal/ }))
    await waitFor(() => expect(key.getByText(/^sk_mock_[0-9a-f]{32}$/)).toBeTruthy())
    fireEvent.click(key.getByRole('button', { name: /Rotate/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Rotate key' }))
    await waitFor(() => expect(key.getByText('key_mock_mer-0002_02')).toBeTruthy())
    const log = await auditService.list({ merchantId: 'MER-0002', actions: ['CREDENTIAL_ROTATION'] }, ADMIN)
    expect(log.items[0].details).toMatchObject({ fromKeyId: 'key_mock_mer-0002_01', keyId: 'key_mock_mer-0002_02' })
    expect(region('Webhooks').getByText('On hold')).toBeTruthy()
  })
})

describe('Login (mock)', () => {
  it('Given I pick Siti, then I am signed in as her and land on Home', async () => {
    const router = renderAt('/login')
    fireEvent.click(await screen.findByRole('button', { name: /Siti Aminah Binti Yusof/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(useSession.getState().actor.userId).toBe(SITI.userId)
  })
})

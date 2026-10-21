// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { routes } from '@/app/routes'
import { db } from '@/mocks/mockDb'
import { auditService } from '@/services/auditService'
import { devService } from '@/services/devService'
import { DEFAULT_DEV_FLAGS, useDevFlags } from '@/stores/devFlagsStore'
import { useSession } from '@/stores/sessionStore'
import { ADMIN, OWNER } from '@/test/factories'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}
const row = async (name: string) => (await screen.findByRole('rowheader', { name })).closest('tr')!

beforeEach(async () => {
  useDevFlags.setState({ ...DEFAULT_DEV_FLAGS, simulateLatency: false })
  await devService.resetDemoData()
  useSession.getState().switchUser(ADMIN)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Merchants (DEC-92)', () => {
  it('Given a new merchant, then it gets a Default project, a Draft default flow and a Pending Merchant Owner; it can be deleted while it has no cases', async () => {
    renderAt('/merchants')
    await row('Atoz Software Tech')
    fireEvent.click(screen.getByRole('button', { name: /New merchant/ }))
    fireEvent.change(await screen.findByLabelText('Merchant name'), { target: { value: 'Nusantara Pay' } })
    fireEvent.change(screen.getByLabelText('Merchant Owner: full name'), { target: { value: 'Aminah Binti Salleh' } })
    fireEvent.change(screen.getByLabelText('Merchant Owner: email'), { target: { value: 'aminah@nusantara.example' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create merchant' }))
    const r = await row('Nusantara Pay')
    const merchantId = db.state().merchants.find((m) => m.name === 'Nusantara Pay')!.merchantId
    expect(merchantId).toMatch(/^mer_/)
    expect(r.textContent).toContain(merchantId)
    expect(r.textContent).toContain('aminah@nusantara.example · Pending')
    const project = db.state().projects.find((p) => p.merchantId === merchantId)!
    expect(project).toMatchObject({ name: 'Default', isDefault: true })
    expect(db.state().flows.find((f) => f.flowId === project.defaultFlowId)).toMatchObject({ status: 'DRAFT', workflowVersion: 'V1' })
    expect((await auditService.list({ merchantId: merchantId }, ADMIN)).items.map((e) => e.action).sort()).toEqual(['FLOW_CREATED', 'MERCHANT_CREATED', 'PROJECT_CREATED', 'USER_INVITED'])

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(within(r).getByRole('button', { name: 'Delete Nusantara Pay' }))
    await waitFor(() => expect(screen.queryByRole('rowheader', { name: 'Nusantara Pay' })).toBeNull())
    expect(db.state().projects.some((p) => p.merchantId === merchantId)).toBe(false)
  })

  it('Given a duplicate name, then the field shows the error', async () => {
    renderAt('/merchants')
    await row('Atoz Software Tech')
    fireEvent.click(screen.getByRole('button', { name: /New merchant/ }))
    fireEvent.change(await screen.findByLabelText('Merchant name'), { target: { value: 'tesla' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create merchant' }))
    expect(await screen.findByText('A merchant with this name already exists')).toBeTruthy()
  })

  it('Given a merchant with cases, then Delete is disabled', async () => {
    renderAt('/merchants')
    expect((within(await row('Atoz Software Tech')).getByRole('button', { name: /can’t be deleted/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('Given a Merchant Owner, then Merchants is "No access"', async () => {
    useSession.getState().switchUser(OWNER)
    renderAt('/merchants')
    await screen.findByRole('heading', { name: 'No access' })
  })
})

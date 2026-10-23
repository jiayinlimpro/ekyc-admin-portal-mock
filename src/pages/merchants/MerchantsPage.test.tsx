// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { routes } from '@/app/routes'
import { db } from '@/mocks/mockDb'
import { accountOf } from '@/services/accessGuard'
import { auditService } from '@/services/auditService'
import { integrationService } from '@/services/integrationService'
import { merchantAdminService } from '@/services/merchantAdminService'
import { fx } from '@/lib/ids'
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

const actionsFor = async (name: string) => {
  fireEvent.click(within(await row(name)).getByRole('button', { name: `Actions for ${name}` }))
  return (item: string) => fireEvent.click(screen.getByRole('menuitem', { name: item }))
}

describe('Merchants (DEC-98, DEC-92)', () => {
  it('Given the list, then the FRS columns, newest first, and no Delete anywhere', async () => {
    renderAt('/merchants')
    await row('Atoz Software Tech')
    const headers = within(screen.getByRole('region', { name: 'Merchant list' })).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual(['Merchant ID', 'Merchant Name', 'Country', 'Status', 'Created At', 'Actions'])
    const names = within(screen.getByRole('region', { name: 'Merchant list' })).getAllByRole('rowheader').map((h) => h.textContent)
    expect(names[0]).toBe('Empty Demo Merchant') // created most recently
    expect((await row('Vantage')).textContent).toContain('Australia')
    expect((await row('Empty Demo Merchant')).textContent).toContain('Onboarding')
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull()
  })

  it('Given a new merchant, then Onboarding with its Default project, Draft default flow and the primary contact as Pending owner', async () => {
    renderAt('/merchants')
    await row('Atoz Software Tech')
    fireEvent.click(screen.getByRole('button', { name: /Add Merchant/ }))
    fireEvent.change(await screen.findByLabelText(/^Merchant Name/), { target: { value: 'Nusantara Pay' } })
    fireEvent.change(screen.getByLabelText(/^Country of incorporation/), { target: { value: 'MY' } })
    fireEvent.change(screen.getByLabelText(/^Business Registration No/), { target: { value: '2021-01-012345' } })
    fireEvent.change(screen.getByLabelText(/^Primary Contact Name/), { target: { value: 'Aminah Binti Salleh' } })
    fireEvent.change(screen.getByLabelText(/^Primary Contact Email/), { target: { value: 'aminah@nusantara.example' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create merchant' }))
    const r = await row('Nusantara Pay')
    expect(r.textContent).toContain('Onboarding')
    expect(r.textContent).toContain('Malaysia')
    const m = db.state().merchants.find((x) => x.name === 'Nusantara Pay')!
    expect(m).toMatchObject({ registrationNo: '202101012345', status: 'ONBOARDING', primaryContact: { fullName: 'Aminah Binti Salleh', email: 'aminah@nusantara.example' } })
    const project = db.state().projects.find((p) => p.merchantId === m.merchantId)!
    expect(project).toMatchObject({ name: 'Default', isDefault: true })
    expect(db.state().flows.find((f) => f.flowId === project.defaultFlowId)).toMatchObject({ status: 'DRAFT', workflowVersion: 'V1' })
    expect(db.state().accounts.find((a) => a.email === 'aminah@nusantara.example')).toMatchObject({ status: 'PENDING', merchantId: m.merchantId })
    expect((await auditService.list({ merchantId: m.merchantId }, ADMIN)).items.map((e) => e.action).sort()).toEqual(['FLOW_CREATED', 'MERCHANT_CREATED', 'PROJECT_CREATED', 'USER_INVITED'])
  })

  it('Given missing or duplicate details, then the FRS messages', async () => {
    renderAt('/merchants')
    await row('Atoz Software Tech')
    fireEvent.click(screen.getByRole('button', { name: /Add Merchant/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Create merchant' }))
    expect(await screen.findByText('Company name cannot be empty')).toBeTruthy()
    expect(screen.getByText('Please select a valid base jurisdiction')).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/^Merchant Name/), { target: { value: 'Atoz Again' } })
    fireEvent.change(screen.getByLabelText(/^Country of incorporation/), { target: { value: 'MY' } })
    fireEvent.change(screen.getByLabelText(/^Business Registration No/), { target: { value: '201801023456' } }) // Atoz's
    fireEvent.change(screen.getByLabelText(/^Primary Contact Name/), { target: { value: 'Someone New' } })
    fireEvent.change(screen.getByLabelText(/^Primary Contact Email/), { target: { value: 'meiling.tan@atoz.example' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create merchant' }))
    expect(await screen.findByText('Registration number already exists')).toBeTruthy()
    expect(screen.getByText('Email address already active in system user directories')).toBeTruthy()
  })

  it('Given Active, when suspended with a reason, then its users can no longer sign in; made Active again, they can', async () => {
    renderAt('/merchants')
    ;(await actionsFor('Tesla'))('Change status')
    fireEvent.change(await screen.findByLabelText('New status'), { target: { value: 'SUSPENDED' } })
    expect(screen.getByRole('status').textContent).toMatch(/signed out/)
    fireEvent.click(screen.getByRole('button', { name: 'Set to Suspended' }))
    expect(await screen.findByText(/Give a reason/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Reason for change'), { target: { value: 'Invoice overdue 60 days' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set to Suspended' }))
    await waitFor(() => expect((within(screen.getByRole('region', { name: 'Merchant list' })).getByRole('rowheader', { name: 'Tesla' }).closest('tr')!).textContent).toContain('Suspended'))
    const [entry] = (await auditService.list({ actions: ['MERCHANT_STATUS_CHANGED'] }, ADMIN)).items
    expect(entry.details).toMatchObject({ reason: 'Invoice overdue 60 days', changes: [{ from: 'Active', to: 'Suspended' }] })

    const wong = { userId: fx('USR-2026-0052') } // Tesla's owner
    expect(() => accountOf(wong)).toThrow('Tesla is suspended: its users can’t sign in.')
    const teslaProject = db.state().projects.find((p) => p.merchantId === fx('MER-0003'))!.projectId
    expect((await integrationService.get(teslaProject, ADMIN)).apiAccess).toBe('STOPPED')
    await merchantAdminService.changeStatus(fx('MER-0003'), 'ACTIVE', 'Payment received in full', ADMIN)
    expect(accountOf(wong).userId).toBe(wong.userId)
  })

  it('Given an Onboarding merchant, then its API keys are sandbox only', async () => {
    const project = db.state().projects.find((p) => p.merchantId === fx('MER-0006'))!.projectId
    expect((await integrationService.get(project, ADMIN)).apiAccess).toBe('SANDBOX_ONLY')
    expect((await integrationService.get(fx('PRJ-0001'), ADMIN)).apiAccess).toBe('LIVE')
  })

  it('Given Onboarding with a Pending owner, then the invitation can be resent', async () => {
    renderAt('/merchants')
    await row('Empty Demo Merchant')
    db.setState((st) => ({ accounts: st.accounts.map((a) => (a.email === 'rajesh.muthu@emptydemo.example' ? { ...a, status: 'PENDING' as const } : a)) }))
    cleanup()
    renderAt('/merchants')
    ;(await actionsFor('Empty Demo Merchant'))('Resend invitation')
    await waitFor(async () => expect((await auditService.list({ actions: ['USER_INVITATION_RESENT'] }, ADMIN)).items[0].details).toMatchObject({ email: 'rajesh.muthu@emptydemo.example' }))
  })

  it('Given a Owner, then Merchants is "No access"', async () => {
    useSession.getState().switchUser(OWNER)
    renderAt('/merchants')
    await screen.findByRole('heading', { name: 'No access' })
  })
})

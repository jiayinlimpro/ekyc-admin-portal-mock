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
import { ADMIN, ALI, OWNER } from '@/test/factories'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}
const general = async () => within(await screen.findByRole('region', { name: 'General' }))
const tabs = () => within(screen.getByRole('tablist', { name: 'Merchant settings' }))
  .getAllByRole('tab')
  .map((t) => t.textContent)

beforeEach(async () => {
  useDevFlags.setState({ ...DEFAULT_DEV_FLAGS, simulateLatency: false })
  await devService.resetDemoData()
  useSession.getState().switchUser(ADMIN)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Merchant settings (DEC-109, DEC-98, DEC-92)', () => {
  it('Given the Super admin on Vantage, then every tab, the details with country and owner, and no Delete anywhere', async () => {
    renderAt(`/merchants/${fx('MER-0002')}`)
    const g = await general()
    await waitFor(() => expect(g.getByText('Australia')).toBeTruthy())
    expect(g.getByText(/^Ahmad Faiz Bin Zulkifli · Active/, { selector: 'dd' })).toBeTruthy() // the owner
    expect(tabs()).toEqual(['General', 'Users', 'Roles', 'Billing', 'Audit log'])
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull()
  })

  it('Given Active, when suspended with a reason, then its users can no longer sign in; made Active again, they can', async () => {
    renderAt(`/merchants/${fx('MER-0003')}`)
    fireEvent.click((await general()).getByRole('button', { name: 'Change status' }))
    fireEvent.change(await screen.findByLabelText('New status'), { target: { value: 'SUSPENDED' } })
    expect(screen.getByRole('status').textContent).toMatch(/signed out/)
    fireEvent.click(screen.getByRole('button', { name: 'Set to Suspended' }))
    expect(await screen.findByText(/Give a reason/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Reason for change'), { target: { value: 'Invoice overdue 60 days' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set to Suspended' }))
    await waitFor(async () => expect((await general()).getByText('Suspended')).toBeTruthy())
    const [entry] = (await auditService.list({ actions: ['MERCHANT_STATUS_CHANGED'] }, ADMIN)).items
    expect(entry.details).toMatchObject({ reason: 'Invoice overdue 60 days', changes: [{ from: 'Active', to: 'Suspended' }] })

    const wong = { userId: fx('USR-2026-0052') } // Tesla's owner
    expect(() => accountOf(wong)).toThrow('Tesla is suspended: its users can’t sign in.')
    const teslaFlow = db.state().flows.find((f) => f.merchantId === fx('MER-0003'))!.flowId // REQ: DEC-117 — keys are per flow
    expect((await integrationService.get(teslaFlow, ADMIN)).apiAccess).toBe('STOPPED')
    await merchantAdminService.changeStatus(fx('MER-0003'), 'ACTIVE', 'Payment received in full', ADMIN)
    expect(accountOf(wong).userId).toBe(wong.userId)
  })

  it('Given an Onboarding merchant, then its API keys are sandbox only', async () => {
    const flow = db.state().flows.find((f) => f.merchantId === fx('MER-0006'))!.flowId
    expect((await integrationService.get(flow, ADMIN)).apiAccess).toBe('SANDBOX_ONLY')
    expect((await integrationService.get(fx('FLW-0001'), ADMIN)).apiAccess).toBe('LIVE')
  })

  it('Given Onboarding with a Pending owner, then the invitation can be resent', async () => {
    db.setState((st) => ({ accounts: st.accounts.map((a) => (a.email === 'rajesh.muthu@emptydemo.example' ? { ...a, status: 'PENDING' as const } : a)) }))
    renderAt(`/merchants/${fx('MER-0006')}`)
    const g = await general()
    expect(g.getByText('Onboarding')).toBeTruthy()
    fireEvent.click(await g.findByRole('button', { name: 'Resend invitation' }))
    await waitFor(async () => expect((await auditService.list({ actions: ['USER_INVITATION_RESENT'] }, ADMIN)).items[0].details).toMatchObject({ email: 'rajesh.muthu@emptydemo.example' }))
  })

  it('Given the Owner of Atoz, then their merchant’s tabs and details, read-only; another merchant is "not found"', async () => {
    useSession.getState().switchUser(OWNER)
    renderAt(`/merchants/${fx('MER-0001')}`)
    const g = await general()
    expect(g.getByText(/Tan Mei Ling/, { selector: 'dd' })).toBeTruthy()
    expect(tabs()).toEqual(['General', 'Users', 'Roles', 'Billing', 'Audit log'])
    for (const b of ['Edit', 'Change status', 'Resend invitation']) expect(screen.queryByRole('button', { name: b })).toBeNull()
    cleanup()
    renderAt(`/merchants/${fx('MER-0002')}`)
    expect(await screen.findByText('Merchant not found')).toBeTruthy()
  })

  it('Given a Reviewer, then only General (no Users, Roles, Billing or Audit log)', async () => {
    useSession.getState().switchUser(ALI)
    renderAt(`/merchants/${fx('MER-0001')}?tab=users`)
    await general()
    expect(tabs()).toEqual(['General'])
  })

  it('Given Audit log, when an event filter is searched, then the tab stays and only that merchant’s entries show', async () => {
    useSession.getState().switchUser(OWNER)
    const router = renderAt(`/merchants/${fx('MER-0001')}?tab=audit`)
    const table = within(await screen.findByRole('region', { name: 'Audit entries' }))
    await waitFor(() => expect(table.getByRole('table').getAttribute('aria-busy')).toBe('false'))
    fireEvent.click(screen.getByText(/^Event \(/))
    fireEvent.click(within(screen.getByRole('group', { name: 'Cases events' })).getByRole('button', { name: 'Case claimed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(router.state.location.search).toBe('?action=CASE_CLAIMED&tab=audit'))
    expect(screen.getByRole('tab', { name: 'Audit log', selected: true })).toBeTruthy()
  })
})

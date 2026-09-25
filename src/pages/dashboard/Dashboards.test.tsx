// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { routes } from '@/app/routes'
import { analyticsService } from '@/services/analyticsService'
import { devService } from '@/services/devService'
import { DEFAULT_DEV_FLAGS, useDevFlags } from '@/stores/devFlagsStore'
import { useSession } from '@/stores/sessionStore'
import { ADMIN, ALI } from '@/test/factories'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}
const tile = (label: string) => screen.getByText(label, { selector: 'div' }).parentElement!

beforeEach(async () => {
  useDevFlags.setState({ ...DEFAULT_DEV_FLAGS, simulateLatency: false })
  useSession.getState().switchUser(ALI)
  await devService.resetDemoData()
})
afterEach(cleanup)

describe('Overview', () => {
  it('Given a reviewer and the last 30 days, then the three KPIs match the service and there is no Drop-off KPI (DEC-81)', async () => {
    const expected = await analyticsService.overview({ days: 30 }, ALI)
    renderAt('/dashboard')
    await waitFor(() => expect(tile('Total verifications').textContent).toContain(String(expected.total)))
    expect(tile('Pending review').textContent).toContain(`${expected.pending.unclaimed} unclaimed · ${expected.pending.claimed} claimed`)
    expect(tile('Auto-Clear').textContent).toContain(`${expected.autoCleared} approved by SYSTEM`)
    expect(screen.queryByText(/drop-off/i)).toBeNull()
  })

  it('Given Show table on the status split, then all 4 statuses are listed with counts', async () => {
    renderAt('/dashboard')
    const card = within(await screen.findByRole('region', { name: 'Status split' }))
    fireEvent.click(card.getByRole('button', { name: 'Show table' }))
    const rows = card.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent)
    expect(rows).toEqual(['Processing', 'Pending Review', 'Approved', 'Rejected'])
  })

  it('Given Last 7 days, then the URL carries it and the daily table has 7 rows', async () => {
    const router = renderAt('/dashboard')
    await screen.findByRole('region', { name: 'Daily verifications by status' })
    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }))
    await waitFor(() => expect(router.state.location.search).toBe('?days=7'))
    const card = within(screen.getByRole('region', { name: 'Daily verifications by status' }))
    fireEvent.click(card.getByRole('button', { name: 'Show table' }))
    await waitFor(() => expect(card.getAllByRole('row')).toHaveLength(8))
  })

  it('Given an admin on all merchants, then a by-merchant table', async () => {
    useSession.getState().switchUser(ADMIN)
    renderAt('/dashboard')
    const table = within(await screen.findByRole('region', { name: 'By merchant' }))
    expect(table.getByText('Atoz Software Tech')).toBeTruthy()
  })
})

describe('System Intelligence', () => {
  it('Given a reviewer (one merchant), then histograms carry that merchant’s threshold lines and the Retry KPI counts user retakes', async () => {
    renderAt('/intelligence?days=90')
    const card = within(await screen.findByRole('region', { name: 'Score distribution by phase' }))
    await waitFor(() => expect(card.getAllByText('Reject < 70')).toHaveLength(2)) // Face Match + Liveness, Atoz v1.1.0
    expect(card.getByText('Pass ≥ 85')).toBeTruthy()
    const stats = await analyticsService.intelligence({ days: 90 }, ALI)
    expect(tile('User retakes').textContent).toContain(String(stats.userRetakes))
  })

  it('Given an admin on all merchants, then no threshold lines (they differ per merchant)', async () => {
    useSession.getState().switchUser(ADMIN)
    renderAt('/intelligence')
    const card = within(await screen.findByRole('region', { name: 'Score distribution by phase' }))
    expect(card.getByText(/pick one merchant in the top bar/)).toBeTruthy()
    expect(card.queryByText(/Reject </)).toBeNull()
  })
})

describe('Billing', () => {
  it('Given retake charging off, then Cost of Retries is RM 0.00; switching OQ-07 on adds it (DEC-60)', async () => {
    useSession.getState().switchUser(ADMIN)
    renderAt('/billing')
    await waitFor(() => expect(tile('Cost of Retries').textContent).toContain('RM 0.00'))
    expect(tile('Cost of Retries').textContent).toContain('not charged (OQ-07 = no)')
    fireEvent.click(screen.getByRole('switch', { name: 'Charge user retakes per attempt' }))
    await waitFor(() => expect(tile('Cost of Retries').textContent).toMatch(/RM [1-9][\d,]*\.\d\d/))
    const lines = within(screen.getByRole('region', { name: 'Line items' }))
    expect(lines.getAllByRole('columnheader').map((h) => h.textContent)).toContain('Verification Status')
  })

  it('Given a Merchant Reviewer, then Billing is not accessible', () => {
    renderAt('/billing')
    expect(screen.getByRole('heading', { name: 'No access' })).toBeTruthy()
  })
})

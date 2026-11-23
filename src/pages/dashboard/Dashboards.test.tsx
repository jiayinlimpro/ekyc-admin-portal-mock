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
import { ADMIN, ALI, OWNER } from '@/test/factories'
import { fx } from '@/lib/ids'

function renderAt(path: string, projectId = fx('PRJ-0001')) {
  useSession.getState().selectProject(projectId) // REQ: DEC-109 — the inner portal works on one project
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}
const tile = (label: string) => screen.getByText(label, { selector: 'div' }).parentElement!
const ATOZ_DEFAULT = { projectIds: [fx('PRJ-0001')] }

beforeEach(async () => {
  useDevFlags.setState({ ...DEFAULT_DEV_FLAGS, simulateLatency: false })
  useSession.getState().switchUser(ALI)
  await devService.resetDemoData()
})
afterEach(cleanup)

describe('Overview', () => {
  it('Given a reviewer and the last 30 days, then the three KPIs match the service and there is no Drop-off KPI (DEC-81)', async () => {
    const expected = await analyticsService.overview({ days: 30, ...ATOZ_DEFAULT }, ALI)
    renderAt('/dashboard')
    await screen.findByRole('heading', { name: 'Overview' }, { timeout: 15000 }) // the first test loads the lazy page; slow under a full parallel run
    await waitFor(() => expect(tile('Total verifications').textContent).toContain(String(expected.total)))
    expect(tile('Pending review').textContent).toContain(`${expected.pending.unclaimed} unclaimed · ${expected.pending.claimed} claimed`)
    expect(tile('Auto-Clear').textContent).toContain(`${expected.autoCleared} approved by SYSTEM`)
    expect(screen.queryByText(/drop-off/i)).toBeNull()
  })

  it('Given Show table on the status split, then all 5 statuses are listed with counts (DEC-112)', async () => {
    renderAt('/dashboard')
    const card = within(await screen.findByRole('region', { name: 'Status split' }))
    fireEvent.click(card.getByRole('button', { name: 'Show table' }))
    const rows = card.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent)
    expect(rows).toEqual(['Processing', 'Pending Review', 'Approved', 'Rejected', 'Unsuccessful'])
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

  it('Given the Super admin in Vantage Default, then only that project: no By merchant or By project table (DEC-109)', async () => {
    useSession.getState().switchUser(ADMIN)
    renderAt('/dashboard?days=90', fx('PRJ-0003'))
    await screen.findByRole('region', { name: 'Status split' })
    expect(screen.getByText(/^Default · verifications created/)).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'By merchant' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'By project' })).toBeNull()
  })
})

describe('Overview by project and flow (DEC-86)', () => {
  it('Given the Owner in Atoz Default, then By flow shows its flows with pass rate and waiting time, and nothing from SME app (DEC-109)', async () => {
    useSession.getState().switchUser(OWNER)
    renderAt('/dashboard?days=90')
    const table = within(await screen.findByRole('region', { name: 'By flow' }))
    expect(table.getByText('Malaysian onboarding')).toBeTruthy()
    expect(table.queryByText('SME director check')).toBeNull()
    expect(table.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(expect.arrayContaining(['Pass rate', 'Oldest waiting']))
    expect(screen.queryByRole('region', { name: 'By project' })).toBeNull()
  })

  it('Given a flow is picked, then the URL carries it and the totals narrow to that flow', async () => {
    useSession.getState().switchUser(OWNER)
    const router = renderAt('/dashboard?days=90')
    await screen.findByRole('region', { name: 'By flow' })
    const all = await analyticsService.overview({ days: 90, ...ATOZ_DEFAULT }, OWNER)
    const one = await analyticsService.overview({ days: 90, ...ATOZ_DEFAULT, flowId: fx('FLW-0002') }, OWNER)
    fireEvent.change(await screen.findByLabelText('Flow'), { target: { value: fx('FLW-0002') } })
    await waitFor(() => expect(router.state.location.search).toContain(`flow=${fx('FLW-0002')}`))
    await waitFor(() => expect(tile('Total verifications').textContent).toContain(String(one.total)))
    expect(one.total).toBeLessThan(all.total)
    expect(screen.queryByRole('region', { name: 'By flow' })).toBeNull()
  })
})

describe('System Intelligence (DEC-18, DEC-86)', () => {
  it('Given one flow, then the histograms carry its threshold lines and the retry KPIs match the service', async () => {
    renderAt(`/intelligence?days=90&flow=${fx('FLW-0001')}`)
    const card = within(await screen.findByRole('region', { name: 'Score distribution' }))
    await waitFor(() => expect(card.getByText('Reject < 85')).toBeTruthy()) // face match, Standard
    expect(card.getByText('Reject < 70')).toBeTruthy() // liveness, Standard
    const stats = await analyticsService.intelligence({ days: 90, ...ATOZ_DEFAULT, flowId: fx('FLW-0001') }, ALI)
    expect(tile('Average retries').textContent).toContain(`${stats.retries} retries across document, selfie and liveness`)
  })

  it('Given all flows, then no threshold lines (they differ per flow) and a By flow table with drop-off', async () => {
    useSession.getState().switchUser(ADMIN)
    renderAt('/intelligence?days=90', fx('PRJ-0005')) // The Boring Company: a V1 and a V3 flow
    const card = within(await screen.findByRole('region', { name: 'Score distribution' }))
    expect(card.getByText(/pick one flow/)).toBeTruthy()
    expect(card.queryByText(/Reject </)).toBeNull()
    const byFlow = within(await screen.findByRole('region', { name: 'By flow' }))
    expect(byFlow.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(expect.arrayContaining(['Not finished: ID capture', 'Not finished: selfie', 'Not finished: liveness']))
  })
})

describe('Billing (DEC-60, DEC-86)', () => {
  it('Given the Super admin in Merchant settings › Billing, then tokens per document, selfie and liveness submission (DEC-60), cost of retries, and tables by project and flow (DEC-109)', async () => {
    useSession.getState().switchUser(ADMIN)
    renderAt(`/merchants/${fx('MER-0001')}?tab=billing`)
    const periods = await analyticsService.billingPeriods(ADMIN)
    const report = await analyticsService.billing({ period: periods[0], merchantId: fx('MER-0001'), projectIds: [fx('PRJ-0001'), fx('PRJ-0002')] }, ADMIN)
    await waitFor(() => expect(tile('Tokens').textContent).toContain(report.totals.tokens.toLocaleString('en-MY')))
    expect(tile('Cost of Retries').textContent).toContain('submissions after the first in a phase')
    expect(tile('Tokens').textContent).toContain('Document, selfie and liveness submissions')
    expect(await screen.findByRole('region', { name: 'By project' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'By flow' })).toBeTruthy()
    const lines = within(screen.getByRole('region', { name: 'Line items' }))
    expect(lines.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Verification ID', 'Project', 'Flow', 'Session started (MYT)', 'Verification Status', 'Tokens', 'Retry tokens', 'Cost'])
  })

  it('Given a Reviewer, then Billing opens on the project in the header (DEC-86, DEC-109)', async () => {
    renderAt('/billing')
    const lines = within(await screen.findByRole('region', { name: 'Line items' }))
    expect(screen.queryByRole('heading', { name: 'No access' })).toBeNull()
    await waitFor(() => expect(lines.getAllByRole('row').length).toBeGreaterThan(1))
    for (const r of lines.getAllByRole('row').slice(1)) expect(r.textContent).not.toContain('SME app')
  })
})

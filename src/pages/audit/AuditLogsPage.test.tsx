// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { routes } from '@/app/routes'
import { devService } from '@/services/devService'
import { verificationService } from '@/services/verificationService'
import { DEFAULT_DEV_FLAGS, useDevFlags } from '@/stores/devFlagsStore'
import { useSession } from '@/stores/sessionStore'
import { ADMIN, ALI, minutes } from '@/test/factories'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}
async function rows(regionName: string) {
  const table = within(screen.getByRole('region', { name: regionName })).getByRole('table')
  await waitFor(() => expect(table.getAttribute('aria-busy')).toBe('false'))
  return within(table).getAllByRole('row').slice(1)
}

beforeEach(async () => {
  useDevFlags.setState({ ...DEFAULT_DEV_FLAGS, simulateLatency: false })
  useSession.getState().switchUser(ALI)
  await devService.resetDemoData()
})
afterEach(cleanup)

describe('Audit Logs', () => {
  it('Given a reviewer, then only their merchant’s entries are listed', async () => {
    renderAt('/audit?size=100')
    const r = await rows('Audit entries')
    expect(r.length).toBeGreaterThan(0)
    for (const row of r) expect(row.textContent).toContain('Atoz Software Tech')
  })

  it('Given ref=S11, then its trail reads PII view → claim → decision with a readable summary', async () => {
    renderAt('/audit?ref=KYC-260901-900011')
    const r = await rows('Audit entries')
    expect(r.map((x) => within(x).getAllByRole('cell')[1].textContent)).toEqual(['Decision savedDECISION', 'ClaimedCLAIM', 'PII viewedPII_VIEW'])
    expect(r[0].textContent).toContain('PENDING_REVIEW → Approved · Face match confirmed by reviewer')
  })

  it('Given the Event filter = Config deployed, when Search, then only CONFIG_DEPLOY rows', async () => {
    useSession.getState().switchUser(ADMIN)
    const router = renderAt('/audit')
    await rows('Audit entries')
    fireEvent.click(within(screen.getByRole('group', { name: 'Event' })).getByRole('button', { name: 'Config deployed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(router.state.location.search).toBe('?action=CONFIG_DEPLOY'))
    const r = await rows('Audit entries')
    expect(r).toHaveLength(12) // 6 merchants × v1.0.0 + v1.1.0
    for (const row of r) expect(row.textContent).toContain('CONFIG_DEPLOY')
  })

  it('Given claims expire (time warp), then SYSTEM CLAIM_TIMEOUT entries name whose claim ended', async () => {
    act(() => useDevFlags.getState().advanceTime(minutes(31)))
    renderAt('/audit?actor=SYSTEM')
    const r = await rows('Audit entries')
    expect(r.length).toBeGreaterThan(0)
    expect(r.every((x) => x.textContent!.includes('CLAIM_TIMEOUT'))).toBe(true)
    expect(screen.getAllByText(/Claim by Ali Bin Ahmad \(USR-2026-0012\) expired/).length).toBeGreaterThan(0)
  })

  it('Given a live action elsewhere, then it appears on the next load', async () => {
    await verificationService.claim('KYC-260901-900010', ALI)
    renderAt('/audit?ref=KYC-260901-900010&action=CLAIM')
    const r = await rows('Audit entries')
    expect(r).toHaveLength(1)
    expect(r[0].textContent).toContain('Ali Bin Ahmad')
  })
})

describe('Merchant Workflow Directory', () => {
  it('Given an admin, then every merchant with its version, phases and risk gate; Open workflow jumps to the config', async () => {
    useSession.getState().switchUser(ADMIN)
    const router = renderAt('/workflow-directory')
    const r = await rows('Merchants and workflows')
    expect(r).toHaveLength(6)
    const atoz = r.find((x) => x.textContent!.includes('Atoz Software Tech'))!
    expect(within(atoz).getByRole('list', { name: 'Phases in order' }).textContent).toBe('DocumentSelfieFace MatchLivenessRisk Assessment')
    const vantage = r.find((x) => x.textContent!.includes('Vantage'))!
    expect(vantage.textContent).toContain('n/a (V1)')
    fireEvent.click(within(vantage).getByRole('button', { name: /Open workflow/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/workflow'))
    expect(useSession.getState().merchantId).toBe('MER-0002')
  })
})

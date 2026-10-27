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
import { ALI, OWNER, minutes } from '@/test/factories'
import { fx, caseIdOf } from '@/lib/ids'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}
async function rows(regionName: string) {
  const table = within(await screen.findByRole('region', { name: regionName })).getByRole('table')
  await waitFor(() => expect(table.getAttribute('aria-busy')).toBe('false'))
  return within(table).getAllByRole('row').slice(1)
}

beforeEach(async () => {
  useDevFlags.setState({ ...DEFAULT_DEV_FLAGS, simulateLatency: false })
  useSession.getState().switchUser(OWNER)
  useSession.getState().selectProject(fx('PRJ-0001')) // REQ: DEC-109 — the inner portal works on one project
  await devService.resetDemoData()
})
afterEach(cleanup)

describe('Audit Logs', () => {
  it('Given the Owner in Merchant settings › Audit log, then only Atoz entries (every project), with project and actor role and no Merchant column (DEC-109)', async () => {
    renderAt(`/merchants/${fx('MER-0001')}?tab=audit&size=100`)
    const r = await rows('Audit entries')
    expect(r.length).toBeGreaterThan(0)
    expect(screen.queryByRole('columnheader', { name: 'Merchant' })).toBeNull()
    for (const row of r) expect(['Default', 'SME app', '—']).toContain(within(row).getAllByRole('cell')[3].textContent)
    expect(r.some((x) => within(x).getAllByRole('cell')[3].textContent === 'SME app')).toBe(true)
    expect(r.some((x) => /Ali Bin AhmadReviewer|Siti Aminah Binti YusofReviewer/.test(x.textContent!))).toBe(true) // name, then role
  })

  it('Given SME app in the header, then only that project’s entries', async () => {
    useSession.getState().selectProject(fx('PRJ-0002'))
    renderAt('/audit?size=100')
    const r = await rows('Audit entries')
    expect(r.length).toBeGreaterThan(0)
    for (const row of r) expect(within(row).getAllByRole('cell')[3].textContent).toBe('SME app')
  })

  it('Given ref=S11, then its trail reads PII view → claim → decision with a readable summary', async () => {
    renderAt('/audit?ref=KYC-260901-900011')
    const r = await rows('Audit entries')
    expect(r.map((x) => within(x).getAllByRole('cell')[1].textContent)).toEqual(['Case approvedCASE_DECISION_APPROVED', 'Case claimedCASE_CLAIMED', 'Personal data viewedSENSITIVE_PII_VIEW'])
    expect(r[0].textContent).toContain('PENDING_REVIEW → Approved · “Liveness frame and MyKad photo compared side by side; same person.”')
  })

  it('Given the Event filter = Case claimed, when Search, then only CASE_CLAIMED rows', async () => {
    const router = renderAt('/audit')
    await rows('Audit entries')
    fireEvent.click(screen.getByText(/^Event \(/))
    fireEvent.click(within(screen.getByRole('group', { name: 'Cases events' })).getByRole('button', { name: 'Case claimed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(router.state.location.search).toBe('?action=CASE_CLAIMED'))
    const r = await rows('Audit entries')
    expect(r.length).toBeGreaterThan(0)
    for (const row of r) expect(row.textContent).toContain('CASE_CLAIMED')
  })
  it('Given claims expire (time warp), then SYSTEM CASE_CLAIM_EXPIRED entries name whose claim ended', async () => {
    act(() => useDevFlags.getState().advanceTime(minutes(31)))
    renderAt('/audit?actor=SYSTEM')
    const r = await rows('Audit entries')
    expect(r.length).toBeGreaterThan(0)
    expect(r.every((x) => x.textContent!.includes('CASE_CLAIM_EXPIRED'))).toBe(true)
    expect(screen.getAllByText(/Claim by Ali Bin Ahmad expired/).length).toBeGreaterThan(0)
  })

  it('Given a live action elsewhere, then it appears on the next load', async () => {
    await verificationService.claim(caseIdOf('KYC-260901-900010'), ALI)
    renderAt('/audit?ref=KYC-260901-900010&action=CASE_CLAIMED')
    const r = await rows('Audit entries')
    expect(r).toHaveLength(1)
    expect(r[0].textContent).toContain('Ali Bin Ahmad')
  })
})

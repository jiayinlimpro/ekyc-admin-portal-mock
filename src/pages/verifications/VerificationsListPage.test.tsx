// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { routes } from '@/app/routes'
import { devService } from '@/services/devService'
import { DEFAULT_DEV_FLAGS, useDevFlags } from '@/stores/devFlagsStore'
import { useSession } from '@/stores/sessionStore'
import { ADMIN, ALI, EMPTY_OWNER } from '@/test/factories'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}

const table = () => screen.getByRole('table')
async function dataRows(): Promise<HTMLElement[]> {
  await waitFor(() => expect(table().getAttribute('aria-busy')).toBe('false'))
  return within(table()).getAllByRole('row').slice(1) // minus header
}
const search = () => fireEvent.click(screen.getByRole('button', { name: 'Search' }))

beforeEach(async () => {
  useDevFlags.setState({ ...DEFAULT_DEV_FLAGS, simulateLatency: false })
  useSession.getState().switchUser(ALI)
  await devService.resetDemoData()
})
afterEach(cleanup)

describe('Verifications List', () => {
  it('Given a Merchant Reviewer, then only their merchant is listed and no NRIC, passport no. or client metadata appears (DEC-40)', async () => {
    renderAt('/verifications')
    const rows = await dataRows()
    expect(rows).toHaveLength(20)
    const text = table().textContent!
    expect(text).not.toMatch(/\d{6}-\d{2}-\d{4}/) // NRIC
    expect(text).not.toMatch(/X99\d{6}/) // passport
    expect(text).not.toMatch(/203\.0\.113|198\.51\.100|192\.0\.2\./) // IPs
    for (const other of ['Vantage', 'Tesla', '3Nova']) expect(text).not.toContain(other)
    expect(screen.queryByLabelText(/^Merchant/)).toBeNull() // no merchant filter for reviewers
  })

  it('Given Status = Processing, when Search, then the URL carries the filter and every row is Processing', async () => {
    const router = renderAt('/verifications')
    await dataRows()
    fireEvent.click(within(screen.getByRole('group', { name: 'Status' })).getByRole('button', { name: 'Processing' }))
    search()
    await waitFor(() => expect(router.state.location.search).toBe('?status=PROCESSING'))
    const rows = await dataRows()
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) expect(r.textContent).toContain('Processing')
  })

  it('Given Claimed By = Me, then S07 and S08 show with a countdown and a "You" marker', async () => {
    renderAt('/verifications')
    await dataRows()
    fireEvent.change(screen.getByLabelText('Claimed By'), { target: { value: ALI.userId } })
    search()
    await waitFor(() => expect(screen.getByRole('link', { name: 'KYC-260901-900007' })).toBeTruthy())
    const s07 = screen.getByRole('link', { name: 'KYC-260901-900008' }).closest('tr')!
    expect(s07.textContent).toMatch(/Ali Bin AhmadYou/)
    expect(s07.textContent).toMatch(/USR-2026-0012 · \d+ min left/)
    expect(s07.textContent).toContain('Pending Review') // claim is not a status
  })

  it('Given filters with no match, then the empty state offers Reset, which brings rows back', async () => {
    renderAt('/verifications?fullName=zzzz-nobody')
    await screen.findByText('No verifications match these filters')
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }))
    expect((await dataRows()).length).toBe(20)
  })

  it('Given the Owner of Empty Demo Merchant, then "No verifications yet" (S14)', async () => {
    useSession.getState().switchUser(EMPTY_OWNER)
    renderAt('/verifications')
    await screen.findByText('No verifications yet')
  })

  it('Given the Platform Admin, then Verifications is "No access": no case access by default (OQ-20, DEC-72)', async () => {
    useSession.getState().switchUser(ADMIN)
    renderAt('/verifications')
    await screen.findByRole('heading', { name: 'No access' })
  })

  it('Given the service fails, then an error with Try again; when it recovers, then rows load', async () => {
    useDevFlags.setState({ simulateErrors: true, errorRate: 1 })
    renderAt('/verifications')
    await screen.findByText('Couldn’t load data')
    useDevFlags.setState({ simulateErrors: false })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect((await dataRows()).length).toBe(20)
  })

  it('Given Submitted from is after Submitted to, then Search is blocked with a message', async () => {
    const router = renderAt('/verifications')
    await dataRows()
    fireEvent.change(screen.getByLabelText(/Submitted from/), { target: { value: '2026-09-26' } })
    fireEvent.change(screen.getByLabelText(/Submitted to/), { target: { value: '2026-09-25' } })
    search()
    expect(screen.getByRole('alert').textContent).toMatch(/on or before/)
    expect(router.state.location.search).toBe('')
  })

  it('Given a stale link with an unknown status, then it is ignored', async () => {
    renderAt('/verifications?status=CLAIMED')
    expect((await dataRows()).length).toBe(20)
  })

  it('paginates through the URL', async () => {
    const router = renderAt('/verifications')
    await dataRows()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(router.state.location.search).toBe('?page=2'))
    await waitFor(() => expect(screen.getByText(/Showing 21–40 of \d+/)).toBeTruthy())
  })
})

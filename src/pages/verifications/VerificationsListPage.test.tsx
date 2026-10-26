// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { routes } from '@/app/routes'
import { devService } from '@/services/devService'
import { DEFAULT_DEV_FLAGS, useDevFlags } from '@/stores/devFlagsStore'
import { useSession } from '@/stores/sessionStore'
import { ADMIN, ALI, EMPTY_OWNER, HAFIZ } from '@/test/factories'
import { fx } from '@/lib/ids'
import { addDays, formatRange, mytToday } from '@/lib/dateRange'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

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
  it('Given the default view, then only Pending Review cases, oldest Last updated first (DEC-43)', async () => {
    renderAt('/verifications')
    const rows = await dataRows()
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) expect(r.textContent).toContain('Pending Review')
    expect(screen.getByText(/Pending Review cases in your projects, oldest first/)).toBeTruthy()
  })

  it('Given clicks on the Status column name, then ascending, descending, then the default order; unsaved filters stay (DEC-100)', async () => {
    const router = renderAt('/verifications?status=ALL')
    await dataRows()
    expect(screen.queryByLabelText(/Sort by/)).toBeNull() // no sort control in the filters
    const header = () => within(table()).getByRole('columnheader', { name: /^Status/ })
    expect(header().getAttribute('aria-sort')).toBe('none')
    expect(within(table()).getByRole('columnheader', { name: 'Full Name' }).querySelector('button')).toBeNull() // not sortable (FRS)
    fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'tan' } }) // not searched yet
    const order = ['Processing', 'Pending Review', 'Approved', 'Rejected']
    const statuses = async () => (await dataRows()).map((r) => order.findIndex((s) => r.textContent!.includes(s)))
    fireEvent.click(within(header()).getByRole('button'))
    await waitFor(() => expect(header().getAttribute('aria-sort')).toBe('ascending'))
    expect(router.state.location.search).toBe('?status=ALL&sort=status.asc')
    expect(await statuses()).toEqual([...(await statuses())].sort((a, b) => a - b))
    fireEvent.click(within(header()).getByRole('button'))
    await waitFor(() => expect(header().getAttribute('aria-sort')).toBe('descending'))
    expect((await statuses())[0]).toBe(3) // Rejected first
    fireEvent.click(within(header()).getByRole('button'))
    await waitFor(() => expect(header().getAttribute('aria-sort')).toBe('none'))
    expect(router.state.location.search).toBe('?status=ALL')
    expect((screen.getByLabelText('Full Name') as HTMLInputElement).value).toBe('tan')
  })

  it('Given a Reviewer, then only their projects are listed and no NRIC, passport no. or client metadata appears (DEC-40)', async () => {
    renderAt('/verifications?status=ALL')
    const rows = await dataRows()
    expect(rows).toHaveLength(20)
    const text = table().textContent!
    expect(text).not.toMatch(/\d{6}-\d{2}-\d{4}/) // NRIC
    expect(text).not.toMatch(/X99\d{6}/) // passport
    expect(text).not.toMatch(/203\.0\.113|198\.51\.100|192\.0\.2\./) // IPs
    for (const other of ['Vantage', 'Tesla', '3Nova']) expect(text).not.toContain(other)
    expect(screen.queryByLabelText(/^Merchant/)).toBeNull() // no merchant filter
  })

  it('Given Ali sees two projects, then Project and Risk columns, with version under Flow and no Actions column; Project disappears with one project in the header (DEC-40)', async () => {
    renderAt('/verifications?status=ALL')
    await dataRows()
    const headers = within(table()).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual(['Reference ID', 'Full Name', 'Project', 'Flow', 'Document', 'Status', 'Risk', 'Claimed By', 'Created (MYT)', 'Last updated (MYT)'])
    cleanup()
    useSession.getState().switchUser(HAFIZ) // one project (SME app, V3: no risk)
    renderAt('/verifications?status=ALL')
    await dataRows()
    const one = within(table()).getAllByRole('columnheader').map((h) => h.textContent)
    expect(one).not.toContain('Project')
    expect(one).not.toContain('Risk')
    expect(screen.queryByLabelText('Project')).toBeNull()
  })

  it('Given Project = SME app, then every row is from that project and the Flow filter lists only its flows', async () => {
    const router = renderAt('/verifications?status=ALL')
    await dataRows()
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: fx('PRJ-0002') } })
    expect(within(screen.getByLabelText('Flow')).getAllByRole('option').map((o) => o.textContent)).toEqual(['All flows', 'SME director check (V3)'])
    search()
    await waitFor(() => expect(router.state.location.search).toBe(`?status=ALL&project=${fx('PRJ-0002')}`))
    for (const r of await dataRows()) expect(r.textContent).toContain('SME app')
  })

  it('Given Status = Processing, when Search, then the URL carries the filter and every row is Processing', async () => {
    const router = renderAt('/verifications')
    await dataRows()
    const status = within(screen.getByRole('group', { name: 'Status' }))
    fireEvent.click(status.getByRole('button', { name: 'Pending Review' })) // off: the default
    fireEvent.click(status.getByRole('button', { name: 'Processing' }))
    search()
    await waitFor(() => expect(router.state.location.search).toBe('?status=PROCESSING'))
    const rows = await dataRows()
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) expect(r.textContent).toContain('Processing')
  })

  it('Given Claim = Claimed by me, then S07 and S08 show with a "You" marker and the countdown under Claimed By', async () => {
    renderAt('/verifications')
    await dataRows()
    fireEvent.change(screen.getByLabelText('Claim'), { target: { value: 'MINE' } })
    search()
    await waitFor(() => expect(screen.getByRole('link', { name: 'KYC-260901-900007' })).toBeTruthy())
    const s08 = screen.getByRole('link', { name: 'KYC-260901-900008' }).closest('tr')!
    expect(s08.textContent).toMatch(/Ali Bin AhmadYou/)
    expect(s08.textContent).toMatch(/\d+ min left/)
    expect(s08.textContent).toContain('Pending Review') // claim is not a status
    const mine = within(table()).getAllByRole('row').slice(1)
    expect(mine.length).toBeGreaterThanOrEqual(2) // S07, S08 and any background claim the seed gave Ali
    for (const r of mine) expect(r.textContent).toMatch(/Ali Bin AhmadYou/)
  })

  it('Given filters with no match, then the empty state offers Reset, which brings rows back', async () => {
    renderAt('/verifications?fullName=zzzz-nobody')
    await screen.findByText('No verifications match these filters')
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }))
    expect((await dataRows()).length).toBeGreaterThan(0)
  })

  it('Given the Owner of Empty Demo Merchant, then "Nothing waiting for review", and "Show all statuses" is still empty (S14)', async () => {
    useSession.getState().switchUser(EMPTY_OWNER)
    renderAt('/verifications')
    await screen.findByText('Nothing waiting for review')
    fireEvent.click(screen.getByRole('button', { name: 'Show all statuses' }))
    await screen.findByText('No verifications match these filters')
  })

  it('Given the Super admin, then cases of every merchant are listed (DEC-75)', async () => {
    useSession.getState().switchUser(ADMIN)
    renderAt('/verifications?status=ALL&referenceNo=KYC-260901-900013')
    const row = (await screen.findByRole('rowheader', { name: 'KYC-260901-900013' })).closest('tr')!
    expect(row.textContent).toContain('Vantage') // across merchants, the merchant shows under the project
  })

  it('Given the service fails, then an error with Try again; when it recovers, then rows load', async () => {
    useDevFlags.setState({ simulateErrors: true, errorRate: 1 })
    renderAt('/verifications?status=ALL')
    await screen.findByText('Couldn’t load data')
    useDevFlags.setState({ simulateErrors: false })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect((await dataRows()).length).toBe(20)
  })

  it('Given the Created field, when the end day then an earlier day are clicked, then one range in one field, and Search applies it (DEC-101)', async () => {
    const router = renderAt('/verifications')
    await dataRows()
    expect(screen.queryByLabelText(/Created from|Created to/)).toBeNull() // one field, not two
    const today = mytToday(new Date())
    const [start, end] = [addDays(today, -5), addDays(today, -2)]
    fireEvent.click(screen.getByLabelText(/^Created/))
    const calendar = await screen.findByRole('dialog', { name: 'Created between' })
    const name = (d: string) => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`
    const day = (d: string) => within(calendar).getByRole('button', { name: name(d) })
    const tomorrow = within(calendar).queryByRole('button', { name: name(addDays(today, 1)) }) as HTMLButtonElement | null
    if (tomorrow) expect(tomorrow.disabled).toBe(true) // no future days (tomorrow may be in a month not shown)
    fireEvent.click(day(end))
    expect(within(calendar).getByText(/now choose the end date/)).toBeTruthy()
    fireEvent.click(day(start)) // earlier than the first click: the two swap
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Created between' })).toBeNull())
    expect(screen.getByLabelText(/^Created/).textContent).toBe(formatRange({ from: start, to: end }))
    search()
    await waitFor(() => expect(router.state.location.search).toBe(`?from=${start}&to=${end}`))
  })

  it('Given a link with Created from after Created to, then Search is blocked with a message', async () => {
    const router = renderAt('/verifications?from=2026-09-26&to=2026-09-25')
    await screen.findByText('No verifications match these filters') // the dates exclude everything
    search()
    expect(screen.getByRole('alert').textContent).toMatch(/on or before/)
    expect(router.state.location.search).toBe('?from=2026-09-26&to=2026-09-25')
  })

  it('Given a stale link with an unknown status, then it is ignored', async () => {
    renderAt('/verifications?status=CLAIMED')
    expect((await dataRows()).length).toBe(20)
  })

  it('paginates through the URL', async () => {
    const router = renderAt('/verifications?status=ALL')
    await dataRows()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(router.state.location.search).toBe('?status=ALL&page=2'))
    await waitFor(() => expect(screen.getByText(/Showing 21–40 of \d+/)).toBeTruthy())
  })
})

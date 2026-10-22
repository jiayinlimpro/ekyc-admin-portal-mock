// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { routes } from '@/app/routes'
import { devService } from '@/services/devService'
import { DEFAULT_DEV_FLAGS, useDevFlags } from '@/stores/devFlagsStore'
import { useSession } from '@/stores/sessionStore'
import { ADMIN, ALI, HAFIZ, OWNER } from '@/test/factories'
import { fx } from '@/lib/ids'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}
const list = async () => within(await screen.findByRole('region', { name: 'Project list' }))
/** The row whose project name (first span in the row header) is `name`. */
const nameOf = (tr: HTMLElement) => tr.querySelector('th span span')?.textContent
const rowOf = async (name: string) => {
  const region = await list()
  return waitFor(() => {
    const rows = region.getAllByRole('row')
    const row = rows.find((tr) => nameOf(tr) === name)
    if (!row) throw new Error(`No project row "${name}"; rows: ${rows.map(nameOf).join(', ')}`)
    return row
  })
}

beforeEach(async () => {
  useDevFlags.setState({ ...DEFAULT_DEV_FLAGS, simulateLatency: false })
  await devService.resetDemoData()
  useSession.getState().switchUser(OWNER)
})
afterEach(cleanup)

describe('Projects (DEC-90, DEC-93)', () => {
  it('Given the Merchant Owner, then both Atoz projects with flows, members and open cases', async () => {
    renderAt('/projects')
    const def = await rowOf('Default')
    expect(def.textContent).toContain('Merchant Owner')
    expect(def.textContent).toContain('Malaysian onboarding')
    expect(def.textContent).toMatch(/2 active \/ 3/) // Malaysian, Foreigner active; Tourist draft
    expect((await rowOf('SME app')).textContent).toContain('45 min')
  })

  it('Given a new project, then it appears with its Draft default flow and the header switcher lists it (MOCK-12)', async () => {
    renderAt('/projects')
    await rowOf('Default')
    fireEvent.click(screen.getByRole('button', { name: /New project/ }))
    fireEvent.change(await screen.findByLabelText('Project name'), { target: { value: 'Branch kiosks' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
    const row = await rowOf('Branch kiosks')
    expect(row.textContent).toContain('0 active / 1')
    expect(row.textContent).toContain('Default flow')
    fireEvent.click(screen.getByRole('button', { name: /Switch project/ }))
    expect((await screen.findAllByRole('menuitemradio')).map((o) => o.textContent)).toContain('Branch kiosksMerchant Owner')
  })

  it('Given a duplicate name, then the error shows on the field', async () => {
    renderAt('/projects')
    await rowOf('Default')
    fireEvent.click(screen.getByRole('button', { name: /New project/ }))
    fireEvent.change(await screen.findByLabelText('Project name'), { target: { value: 'sme app' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
    expect((await screen.findByRole('alert')).textContent).toBe('A project with this name already exists')
  })

  it('Given archive, then the project is tagged Archived and can no longer be archived', async () => {
    renderAt('/projects')
    fireEvent.click(within(await rowOf('SME app')).getByRole('button', { name: 'Archive SME app' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Archive project' }))
    await waitFor(async () => expect((await rowOf('SME app')).textContent).toContain('Archived'))
    expect((within(await rowOf('SME app')).getByRole('button', { name: 'Archive SME app' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('Given a Project Admin, then only their project, without New, Rename or Archive (DEC-70)', async () => {
    useSession.getState().switchUser(HAFIZ)
    renderAt('/projects')
    await rowOf('SME app')
    expect((await list()).getAllByRole('row').map(nameOf).filter(Boolean)).toEqual(['SME app'])
    expect(screen.queryByRole('button', { name: /New project/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Rename/ })).toBeNull()
  })

  it('Given the Super admin, then every merchant, with a Merchant column', async () => {
    useSession.getState().switchUser(ADMIN)
    renderAt('/projects')
    await rowOf('Wallet app')
    expect((await list()).getAllByRole('columnheader').map((h) => h.textContent)).toContain('Merchant')
  })

  it('Given a Reviewer, then Projects is "No access"', async () => {
    useSession.getState().switchUser(ALI)
    renderAt('/projects')
    await screen.findByRole('heading', { name: 'No access' })
  })

  it('Given Flows on a row, then the header switches to that project', async () => {
    const router = renderAt('/projects')
    fireEvent.click(within(await rowOf('SME app')).getByRole('button', { name: 'Flows of SME app' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/flows'))
    expect(useSession.getState().projectId).toBe(fx('PRJ-0002'))
  })
})

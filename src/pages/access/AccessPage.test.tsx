// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { routes } from '@/app/routes'
import { db } from '@/mocks/mockDb'
import { devService } from '@/services/devService'
import { DEFAULT_DEV_FLAGS, useDevFlags } from '@/stores/devFlagsStore'
import { useSession } from '@/stores/sessionStore'
import { ADMIN, ALI, HAFIZ, OWNER } from '@/test/factories'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}
const userRow = async (name: string) => (await screen.findByRole('rowheader', { name: new RegExp(`^${name}`) })).closest('tr')!

beforeEach(async () => {
  useDevFlags.setState({ ...DEFAULT_DEV_FLAGS, simulateLatency: false })
  await devService.resetDemoData()
  useSession.getState().switchUser(OWNER)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Users and Access (DEC-70, DEC-74)', () => {
  it('Given the Merchant Owner, then users with projects and roles, status and last active', async () => {
    renderAt('/access')
    const ali = await userRow('Ali Bin Ahmad')
    expect(ali.textContent).toContain('Default · Reviewer')
    expect(ali.textContent).toContain('SME app · Viewer')
    expect((await userRow('Chong Pei Shan')).textContent).toContain('Invited')
    expect((await userRow('Tan Mei Ling')).textContent).toContain('Merchant Owner · all projects')
  })

  it('Given Edit access, when Ali becomes Viewer in Default, then his role changes and his claims there are released', async () => {
    renderAt('/access')
    fireEvent.click(within(await userRow('Ali Bin Ahmad')).getByRole('button', { name: 'Edit access for Ali Bin Ahmad' }))
    fireEvent.change(await screen.findByLabelText('Default'), { target: { value: 'VIEWER' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save access' }))
    await waitFor(async () => expect((await userRow('Ali Bin Ahmad')).textContent).toContain('Default · Viewer'))
    expect(db.state().verifications.find((v) => v.referenceNo === 'KYC-260901-900007')!.claimedBy).toBeUndefined()
  })

  it('Given an invite, then the new user is listed as Invited', async () => {
    renderAt('/access')
    await userRow('Ali Bin Ahmad')
    fireEvent.click(screen.getByRole('button', { name: /Invite user/ }))
    fireEvent.change(await screen.findByLabelText('Full name'), { target: { value: 'Aishah Binti Omar' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'aishah@atoz.example' } })
    fireEvent.change(screen.getByLabelText('SME app'), { target: { value: 'REVIEWER' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }))
    const row = await userRow('Aishah Binti Omar')
    expect(row.textContent).toContain('Invited')
    expect(row.textContent).toContain('SME app · Reviewer')
  })

  it('Given an invite with no project, then it is refused with a message', async () => {
    renderAt('/access')
    await userRow('Ali Bin Ahmad')
    fireEvent.click(screen.getByRole('button', { name: /Invite user/ }))
    fireEvent.change(await screen.findByLabelText('Full name'), { target: { value: 'No Roles Person' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'noroles@atoz.example' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Give the user a role in at least one project')
  })

  it('Given a Project Admin, then only SME app can be edited and nobody can be deactivated', async () => {
    useSession.getState().switchUser(HAFIZ)
    renderAt('/access')
    const ali = await userRow('Ali Bin Ahmad')
    expect(within(ali).queryByRole('button', { name: /Deactivate/ })).toBeNull()
    fireEvent.click(within(ali).getByRole('button', { name: 'Edit access for Ali Bin Ahmad' }))
    expect(await screen.findByLabelText('SME app')).toBeTruthy()
    expect(screen.queryByLabelText('Default')).toBeNull()
  })

  it('Given the Roles tab, then the DEC-70 table: only Platform Admin sets Advanced thresholds; Viewers cannot claim', async () => {
    renderAt('/access')
    await userRow('Ali Bin Ahmad')
    fireEvent.click(screen.getByRole('tab', { name: 'Roles' }))
    const table = within(await screen.findByRole('region', { name: 'Role permissions' }))
    const advanced = table.getByRole('rowheader', { name: /Advanced/ }).closest('tr')!
    expect(within(advanced).getAllByRole('img').map((i) => i.getAttribute('aria-label'))).toEqual(['Allowed', 'Not allowed', 'Not allowed', 'Not allowed', 'Not allowed'])
    const claim = table.getByRole('rowheader', { name: 'Claim a case' }).closest('tr')!
    expect(within(claim).getAllByRole('img').map((i) => i.getAttribute('aria-label'))).toEqual(['Not allowed', 'Allowed', 'Allowed', 'Allowed', 'Not allowed'])
  })

  it('Given a Reviewer, then "No access"; the Platform Admin picks a project first', async () => {
    useSession.getState().switchUser(ALI)
    renderAt('/access')
    await screen.findByRole('heading', { name: 'No access' })
    cleanup()
    useSession.getState().switchUser(ADMIN)
    renderAt('/access')
    fireEvent.click(within(await screen.findByRole('list', { name: 'Choose a project' })).getAllByRole('button', { name: /Default/ })[1])
    expect(await screen.findByRole('region', { name: 'User list' })).toBeTruthy()
  })
})

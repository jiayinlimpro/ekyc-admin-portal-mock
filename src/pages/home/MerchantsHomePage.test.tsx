// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { routes } from '@/app/routes'
import { db } from '@/mocks/mockDb'
import { auditService } from '@/services/auditService'
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
const merchantRow = async (name: string) => within(await screen.findByRole('region', { name }))
const cards = (row: ReturnType<typeof within>) => row.getAllByRole('heading', { level: 3 }).map((h: HTMLElement) => h.textContent)
const merchantNames = () => within(screen.getByRole('main')).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
const mainNav = () => within(screen.getByRole('navigation', { name: 'Main' }))

beforeEach(async () => {
  useDevFlags.setState({ ...DEFAULT_DEV_FLAGS, simulateLatency: false })
  await devService.resetDemoData()
  useSession.getState().switchUser(ADMIN)
})
afterEach(cleanup)

describe('Merchants page — the outer layer (DEC-109)', () => {
  it('Given the Super admin, then a row per merchant (by name) with its projects as cards, New merchant, and the platform modules in the menu', async () => {
    renderAt('/')
    const atoz = await merchantRow('Atoz Software Tech')
    expect(cards(atoz)).toEqual(['Default', 'SME app'])
    const names = merchantNames()
    expect(names).toEqual([...names].sort((a, b) => a!.localeCompare(b!)))
    expect(names).toContain('Vantage')
    expect(cards(await merchantRow('3Nova'))).toEqual(['Default', 'Wallet app', 'Pilot 2025']) // archived last
    expect(screen.getByRole('button', { name: /New merchant/ })).toBeTruthy()
    expect(atoz.getByRole('link', { name: 'Merchant settings of Atoz Software Tech' })).toBeTruthy()
    expect(atoz.getByRole('button', { name: 'New project in Atoz Software Tech' })).toBeTruthy()
    for (const m of ['Merchants', 'Platform staff', 'Workflow Registry']) expect(mainNav().getByRole('link', { name: m })).toBeTruthy()
    for (const inner of ['Overview', 'Verifications', 'Flows', 'Project Settings']) expect(mainNav().queryByRole('link', { name: inner })).toBeNull()
  })

  it('Given Ali (Reviewer · Default, Viewer · SME app), then only Atoz with both cards; no New merchant, New project or Merchant settings', async () => {
    useSession.getState().switchUser(ALI)
    renderAt('/')
    const atoz = await merchantRow('Atoz Software Tech')
    expect(cards(atoz)).toEqual(['Default', 'SME app'])
    expect(merchantNames()).toEqual(['Atoz Software Tech'])
    expect(screen.queryByRole('button', { name: /New merchant/ })).toBeNull()
    expect(atoz.queryByRole('button', { name: /New project/ })).toBeNull()
    expect(atoz.queryByRole('link', { name: /Merchant settings/ })).toBeNull()
    expect(mainNav().queryByRole('link', { name: 'Platform staff' })).toBeNull()
  })

  it('Given Go to project, then the inner portal on that project: Merchant / Project in the header and only project modules in the menu', async () => {
    useSession.getState().switchUser(OWNER)
    const router = renderAt('/')
    fireEvent.click((await merchantRow('Atoz Software Tech')).getByRole('button', { name: 'Go to project SME app' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
    expect(useSession.getState().projectId).toBe(fx('PRJ-0002'))
    expect(await screen.findByRole('button', { name: 'Switch merchant. Current: Atoz Software Tech' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Switch project. Current: SME app' })).toBeTruthy()
    await mainNav().findByRole('link', { name: 'Verifications' })
    for (const outer of ['Merchants', 'Platform staff', 'Workflow Registry']) expect(mainNav().queryByRole('link', { name: outer })).toBeNull()
  })

  it('Given a project’s ⚙, then Project Settings of that project', async () => {
    useSession.getState().switchUser(OWNER)
    const router = renderAt('/')
    fireEvent.click((await merchantRow('Atoz Software Tech')).getByRole('button', { name: 'Settings of SME app' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/project-settings'))
    expect(((await screen.findByLabelText('Project name')) as HTMLInputElement).value).toBe('SME app')
  })

  it('Given an inner page without a project (a stale link), then back to the Merchants page', async () => {
    useSession.getState().switchUser(OWNER)
    const router = renderAt('/verifications')
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(await screen.findByRole('heading', { name: 'Merchants', level: 1 })).toBeTruthy()
  })

  it('Given ?project= on a link, then that project is selected and the param is removed', async () => {
    useSession.getState().switchUser(OWNER)
    const router = renderAt(`/flows?project=${fx('PRJ-0002')}`)
    expect(await screen.findByRole('link', { name: 'SME director check' })).toBeTruthy()
    expect(useSession.getState().projectId).toBe(fx('PRJ-0002'))
    expect(router.state.location.search).toBe('')
  })

  it('Given Search projects = "wallet", then only 3Nova with its Wallet app card', async () => {
    renderAt('/')
    await merchantRow('Atoz Software Tech')
    fireEvent.change(screen.getByLabelText('Search projects'), { target: { value: 'wallet' } })
    expect(merchantNames()).toEqual(['3Nova'])
    expect(cards(await merchantRow('3Nova'))).toEqual(['Wallet app'])
  })

  it('Given New project in Atoz, then its card appears', async () => {
    useSession.getState().switchUser(OWNER)
    renderAt('/')
    fireEvent.click((await merchantRow('Atoz Software Tech')).getByRole('button', { name: 'New project in Atoz Software Tech' }))
    fireEvent.change(await screen.findByLabelText(/^Project name/), { target: { value: 'Retail app' } })
    fireEvent.click(screen.getByRole('button', { name: /Create project/ }))
    await waitFor(async () => expect(cards(await merchantRow('Atoz Software Tech'))).toContain('Retail app'))
  })

  it('Given a new merchant, then a row with its Default project; Onboarding with a Draft default flow and the primary contact as Pending owner', async () => {
    renderAt('/')
    await merchantRow('Atoz Software Tech')
    fireEvent.click(screen.getByRole('button', { name: /New merchant/ }))
    fireEvent.change(await screen.findByLabelText(/^Merchant Name/), { target: { value: 'Nusantara Pay' } })
    fireEvent.change(screen.getByLabelText(/^Country of incorporation/), { target: { value: 'MY' } })
    fireEvent.change(screen.getByLabelText(/^Business Registration No/), { target: { value: '2021-01-012345' } })
    fireEvent.change(screen.getByLabelText(/^Primary Contact Name/), { target: { value: 'Aminah Binti Salleh' } })
    fireEvent.change(screen.getByLabelText(/^Primary Contact Email/), { target: { value: 'aminah@nusantara.example' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create merchant' }))
    await waitFor(async () => expect(cards(await merchantRow('Nusantara Pay'))).toEqual(['Default']))
    const m = db.state().merchants.find((x) => x.name === 'Nusantara Pay')!
    expect(m).toMatchObject({ registrationNo: '202101012345', status: 'ONBOARDING', primaryContact: { fullName: 'Aminah Binti Salleh', email: 'aminah@nusantara.example' } })
    const project = db.state().projects.find((p) => p.merchantId === m.merchantId)!
    expect(project).toMatchObject({ name: 'Default', isDefault: true })
    expect(db.state().flows.find((f) => f.flowId === project.defaultFlowId)).toMatchObject({ status: 'DRAFT', workflowVersion: 'V1' })
    expect(db.state().accounts.find((a) => a.email === 'aminah@nusantara.example')).toMatchObject({ status: 'PENDING', merchantId: m.merchantId })
    expect((await auditService.list({ merchantId: m.merchantId }, ADMIN)).items.map((e) => e.action).sort()).toEqual(['FLOW_CREATED', 'MERCHANT_CREATED', 'PROJECT_CREATED', 'USER_INVITED'])
  })

  it('Given missing or duplicate details, then the FRS messages', async () => {
    renderAt('/')
    await merchantRow('Atoz Software Tech')
    fireEvent.click(screen.getByRole('button', { name: /New merchant/ }))
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
})

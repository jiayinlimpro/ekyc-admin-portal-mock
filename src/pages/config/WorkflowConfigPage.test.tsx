// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { routes } from '@/app/routes'
import { auditService } from '@/services/auditService'
import { devService } from '@/services/devService'
import { DEFAULT_DEV_FLAGS, useDevFlags } from '@/stores/devFlagsStore'
import { useSession } from '@/stores/sessionStore'
import { ADMIN } from '@/test/factories'

async function openAs(merchantId: string) {
  useSession.getState().selectMerchant(merchantId)
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/workflow'] })} />)
  await screen.findByRole('heading', { name: /Staging canvas/ })
}

const phase = (name: string) => within(screen.getByRole('region', { name: `${name} phase` }))
const canvasStatus = () => screen.getByRole('heading', { name: /Staging canvas/ }).nextElementSibling!.textContent
const button = (name: RegExp | string) => screen.getByRole('button', { name })
const setNumber = (el: HTMLElement, v: number) => fireEvent.change(el, { target: { value: String(v) } })
const auditActions = async () => (await auditService.list({ merchantId: 'MER-0001', actions: ['CONFIG_DRAFT_SAVE', 'CONFIG_DEPLOY', 'CONFIG_DISCARD'] }, ADMIN)).items.map((e) => e.action)

beforeEach(async () => {
  useDevFlags.setState({ ...DEFAULT_DEV_FLAGS, simulateLatency: false })
  useSession.getState().switchUser(ADMIN)
  await devService.resetDemoData()
})
afterEach(cleanup)

describe('eKYC Workflow configuration', () => {
  it('Given no edits, then the canvas matches production and Deploy / Save are disabled', async () => {
    await openAs('MER-0001')
    expect(canvasStatus()).toContain('Canvas matches production v1.1.0')
    expect((button(/Deploy/) as HTMLButtonElement).disabled).toBe(true)
    expect((button(/Save draft/) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('region', { name: 'Risk Assessment phase' })).toBeTruthy() // V4
  })

  it('Given Face Match Auto-Pass 85 → 88, then a "was 85" diff badge and an unsaved change', async () => {
    await openAs('MER-0001')
    setNumber(phase('Face Match').getByLabelText('Auto-Pass at or above'), 88)
    expect(phase('Face Match').getByText('was 85')).toBeTruthy()
    expect(canvasStatus()).toMatch(/Unsaved changes.*1 change\(s\) vs production/)
  })

  it('Given Auto-Reject ≥ Auto-Pass, then an inline error and Save / Deploy are disabled (DEC-53)', async () => {
    await openAs('MER-0001')
    setNumber(phase('Liveness').getByLabelText('Auto-Reject below'), 95)
    expect(phase('Liveness').getByText('Auto-Reject must be lower than Auto-Pass.')).toBeTruthy()
    expect((button(/Deploy/) as HTMLButtonElement).disabled).toBe(true)
    expect((button(/Save draft/) as HTMLButtonElement).disabled).toBe(true)
  })

  it('Given a change, when Save draft then Deploy with the confirm diff, then v1.2.0 is live and both steps are audited (DEC-51)', async () => {
    await openAs('MER-0001')
    setNumber(phase('Face Match').getByLabelText('Auto-Pass at or above'), 88)
    fireEvent.click(button(/Save draft/))
    await waitFor(() => expect(canvasStatus()).toMatch(/Draft v1\.2\.0 saved .* by Lim Wei Jie/))

    fireEvent.click(button(/^Deploy$/))
    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByText('Deploy v1.1.0 → v1.2.0?')).toBeTruthy()
    const row = dialog.getByText('Face Match · Auto-Pass').closest('tr')!
    expect(row.textContent).toBe('Face Match · Auto-Pass8588')
    fireEvent.click(dialog.getByRole('button', { name: /Deploy v1\.2\.0/ }))

    await waitFor(() => expect(canvasStatus()).toContain('Canvas matches production v1.2.0'))
    expect(screen.getByText(/currently v1\.2\.0/)).toBeTruthy()
    expect(await auditActions()).toEqual(['CONFIG_DEPLOY', 'CONFIG_DRAFT_SAVE', 'CONFIG_DEPLOY', 'CONFIG_DEPLOY'])
  })

  it('Given a saved draft, when Discard draft, then the canvas returns to production and CONFIG_DISCARD is audited', async () => {
    await openAs('MER-0001')
    setNumber(screen.getByLabelText('Claim timeout'), 45)
    fireEvent.click(button(/Save draft/))
    await waitFor(() => expect(canvasStatus()).toMatch(/Draft v1\.2\.0 saved/))
    fireEvent.click(button(/Discard draft/))
    await waitFor(() => expect(canvasStatus()).toContain('Canvas matches production v1.1.0'))
    expect((await auditActions())[0]).toBe('CONFIG_DISCARD')
  })

  it('Given unsaved edits without a draft, when Discard changes, then the canvas resets locally (nothing audited)', async () => {
    await openAs('MER-0001')
    setNumber(phase('Selfie').getByLabelText('Max attempts'), 5)
    fireEvent.click(button(/Discard changes/))
    expect(canvasStatus()).toContain('Canvas matches production')
    expect((phase('Selfie').getByLabelText('Max attempts') as HTMLInputElement).value).toBe('3')
  })

  it('Given a V1 merchant, then there is no Risk Assessment section', async () => {
    await openAs('MER-0002')
    expect(screen.queryByRole('region', { name: 'Risk Assessment phase' })).toBeNull()
  })

  it('Given a stricter Face Match threshold, then the what-if preview moves sessions out of auto-approval', async () => {
    await openAs('MER-0001')
    const preview = () => within(screen.getByRole('region', { name: 'What-if preview' }))
    const approvedRow = () => preview().getByText('Auto-approved').closest('tr')!
    await waitFor(() => expect(approvedRow().textContent).toMatch(/±0\.0 pt/))
    setNumber(phase('Face Match').getByLabelText('Auto-Pass at or above'), 99)
    await waitFor(() => expect(approvedRow().textContent).toMatch(/−\d+\.\d pt/), { timeout: 3000 })
  })
})

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { routes } from '@/app/routes'
import type { Actor } from '@/domain/types'
import { db } from '@/mocks/mockDb'
import { devService } from '@/services/devService'
import { DEFAULT_DEV_FLAGS, useDevFlags } from '@/stores/devFlagsStore'
import { useSession } from '@/stores/sessionStore'
import { ADMIN, OWNER } from '@/test/factories'
import { fx } from '@/lib/ids'

const VANTAGE_OWNER: Actor = { userId: fx('USR-2026-0045'), fullName: 'Ahmad Faiz Bin Zulkifli' }

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}
const card = async (name: string) => within(await screen.findByRole('region', { name }))
const flow = (id: string) => db.state().flows.find((f) => f.flowId === id)!

beforeEach(async () => {
  useDevFlags.setState({ ...DEFAULT_DEV_FLAGS, simulateLatency: false })
  await devService.resetDemoData()
  useSession.getState().switchUser(OWNER)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Flow Detail (DEC-18, DEC-19, DEC-50, DEC-51)', () => {
  it('Given a preset is chosen, then the 0–100 band bar follows it', async () => {
    renderAt(`/flows/${fx('FLW-0001')}`)
    const liveness = await card('Liveness')
    expect(liveness.getByRole('img').getAttribute('aria-label')).toBe('Reject below 70 · Review 70 to 85 · Approve at 85 and above')
    fireEvent.click(liveness.getByRole('radio', { name: /High/ }))
    expect(liveness.getByRole('img').getAttribute('aria-label')).toBe('Reject below 80 · Review 80 to 92 · Approve at 92 and above')
    expect(liveness.queryByRole('radio', { name: /Advanced/ })).toBeNull() // Owner: no Advanced
  })

  it('Given an Active flow, then Save needs a reason; with one it creates V4-R3 for new sessions (DEC-51)', async () => {
    renderAt(`/flows/${fx('FLW-0001')}`)
    fireEvent.click((await card('Face Match')).getByRole('radio', { name: /Low/ }))
    expect(screen.getByText(/Creates V4-R3 · applies to new sessions only/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save new revision' }))
    expect(await screen.findByText(/Reason for change is required/, { selector: '[role="alert"]' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Reason for change/), { target: { value: 'Too many good users sent to review' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save new revision' }))
    await waitFor(() => expect(flow(fx('FLW-0001')).revision).toBe(3))
    expect(await (await card('History')).findByText('V4-R3', { exact: false })).toBeTruthy()
  })

  it('Given the retries stepper, then it moves within 1–5 and shows the submissions it allows (DEC-18, OQ-03)', async () => {
    renderAt(`/flows/${fx('FLW-0001')}`)
    const fm = await card('Face Match')
    fireEvent.click(fm.getByRole('button', { name: 'More Face Match retries' }))
    fireEvent.click(fm.getByRole('button', { name: 'More Face Match retries' }))
    expect(fm.getByLabelText('Face Match retries allowed').textContent).toBe('5')
    expect((fm.getByRole('button', { name: 'More Face Match retries' }) as HTMLButtonElement).disabled).toBe(true)
    expect(fm.getByText(/up to 6 submissions/)).toBeTruthy()
  })

  it('Given Advanced set by the platform, then the merchant sees a read-only chip; the Super admin edits the numbers (DEC-19)', async () => {
    useSession.getState().switchUser(VANTAGE_OWNER)
    renderAt(`/flows/${fx('FLW-0005')}`)
    const fm = await card('Face Match')
    expect(fm.getByRole('radio', { name: /Advanced \(set by platform\)/ }).getAttribute('aria-checked')).toBe('true')
    expect(fm.queryByLabelText('Auto-Reject below')).toBeNull()
    cleanup()
    useSession.getState().switchUser(ADMIN)
    renderAt(`/flows/${fx('FLW-0005')}`)
    const admin = await card('Face Match')
    fireEvent.change(admin.getByLabelText('Auto-Reject below'), { target: { value: '95' } })
    expect(admin.getByRole('img').getAttribute('aria-label')).toBe('Bands not valid yet')
    fireEvent.change(screen.getByLabelText(/Reason for change/), { target: { value: 'Testing invalid values' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save new revision' }))
    expect(await admin.findByText('Auto-Reject threshold must be lower than Auto-Pass threshold')).toBeTruthy()
  })

  it('Given the Draft "Tourist onboarding", then Activate is refused until session expiry is set; then it activates as V4-R1', async () => {
    renderAt(`/flows/${fx('FLW-0003')}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Activate' }))
    await waitFor(() => expect(flow(fx('FLW-0003')).status).toBe('DRAFT'))
    fireEvent.change(screen.getByLabelText(/Session expiry/), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(flow(fx('FLW-0003')).settings.sessionExpiryMin).toBe(30))
    fireEvent.click(await screen.findByRole('button', { name: 'Activate' }))
    await waitFor(() => expect(flow(fx('FLW-0003'))).toMatchObject({ status: 'ACTIVE', revision: 1 }))
  })

  it('Given a Retiring flow, then it is read-only', async () => {
    useSession.getState().switchUser(ADMIN)
    renderAt(`/flows/${fx('FLW-0008')}`)
    expect(await screen.findByText(/Retiring flows are read-only/)).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Save changes' })).toBeNull()
  })

  it('Given Preview impact, then the what-if counts finished sessions under current and edited settings (MOCK-10)', async () => {
    renderAt(`/flows/${fx('FLW-0001')}`)
    fireEvent.click((await card('Liveness')).getByRole('radio', { name: /High/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Preview impact' }))
    expect(await screen.findByText(/finished sessions in the last 30 days would end differently/)).toBeTruthy()
  })

  it('Given V4, then Risk and the email requirement show; V3 has neither (DEC-50)', async () => {
    renderAt(`/flows/${fx('FLW-0001')}`)
    expect(await card('Risk Assessment')).toBeTruthy()
    expect(screen.getByText(/Email required at session creation/)).toBeTruthy()
    cleanup()
    renderAt(`/flows/${fx('FLW-0004')}`)
    await card('Liveness')
    expect(screen.queryByRole('region', { name: 'Risk Assessment' })).toBeNull()
    expect(screen.queryByText(/Email required/)).toBeNull()
  })
})

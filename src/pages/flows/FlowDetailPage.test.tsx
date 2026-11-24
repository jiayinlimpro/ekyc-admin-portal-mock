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
  // REQ: DEC-109 — the inner portal works on one project: the flow's.
  useSession.getState().selectProject(flow(path.split('/').pop()!).projectId)
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
    fireEvent.click((await card('Face match')).getByRole('radio', { name: /Low/ }))
    expect(screen.getByText(/Creates V4-R3 · applies to new sessions only/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save new revision' }))
    expect(await screen.findByText(/Reason for change is required/, { selector: '[role="alert"]' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Reason for change/), { target: { value: 'Too many good users sent to review' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save new revision' }))
    await waitFor(() => expect(flow(fx('FLW-0001')).revision).toBe(3))
    expect(await (await card('History')).findByText('V4-R3', { exact: false })).toBeTruthy()
  })

  it('Given Retries allowed, then its own card per phase (no Selfie on V4), each stepper within 1–5 (DEC-108, OQ-03)', async () => {
    renderAt(`/flows/${fx('FLW-0001')}`)
    const r = await card('Retries allowed')
    expect(r.queryByLabelText('Selfie retries allowed')).toBeNull() // V4 has no selfie step
    expect(r.getByLabelText('Document (OCR) retries allowed').textContent).toBe('3')
    fireEvent.click(r.getByRole('button', { name: 'More Document (OCR) retries' }))
    fireEvent.click(r.getByRole('button', { name: 'More Document (OCR) retries' }))
    expect(r.getByLabelText('Document (OCR) retries allowed').textContent).toBe('5')
    expect((r.getByRole('button', { name: 'More Document (OCR) retries' }) as HTMLButtonElement).disabled).toBe(true)
    expect(r.getByText(/up to 6 submissions/)).toBeTruthy()
    expect(r.getByText(/Used up: Unsuccessful \(no usable ID image\)/)).toBeTruthy() // DEC-112
    expect(r.getByText(/Used up: the last result decides \(Pending Review or Rejected\)/)).toBeTruthy() // liveness never fails
    expect((await card('Face match')).queryByText(/Retries allowed/)).toBeNull() // not in the threshold card
  })

  it('Given a V1 flow, then Selfie retries too: a failed selfie or a face match below Auto-Pass uses one (DEC-108)', async () => {
    useSession.getState().switchUser(ADMIN)
    renderAt(`/flows/${fx('FLW-0005')}`)
    const r = await card('Retries allowed')
    expect(r.getByLabelText('Selfie retries allowed').textContent).toBe('3')
    expect(r.getByText(/A submitted selfie that fails its quality check, or a face match below Auto-Pass/)).toBeTruthy()
    expect(r.getByText(/Used up: Unsuccessful when no selfie was usable; otherwise the last face match decides/)).toBeTruthy() // DEC-112
  })

  it('Given the Cooldown card, then one field after Rejected and one after Unsuccessful; a change saves in a new revision (DEC-26, DEC-112)', async () => {
    renderAt(`/flows/${fx('FLW-0002')}`)
    const c = await card('Cooldown')
    expect((c.getByLabelText('Cooldown after Rejected (min)') as HTMLInputElement).value).toBe('120')
    const failed = c.getByLabelText('Cooldown after Unsuccessful (min)') as HTMLInputElement
    expect(failed.value).toBe('30')
    fireEvent.change(failed, { target: { value: '-5' } })
    fireEvent.change(screen.getByLabelText(/Reason for change/), { target: { value: 'Longer wait after unusable images' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save new revision' }))
    expect(await screen.findByText('Cooldown after Unsuccessful must be a whole number of minutes, 0 or more')).toBeTruthy()
    fireEvent.change(failed, { target: { value: '60' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save new revision' }))
    await waitFor(() => expect(flow(fx('FLW-0002')).settings.unsuccessfulCooldownMin).toBe(60))
    expect(flow(fx('FLW-0002')).settings.cooldownMin).toBe(120)
  })

  it('Given Advanced set by the platform, then the merchant sees a read-only chip; the Super admin edits the numbers (DEC-19)', async () => {
    useSession.getState().switchUser(VANTAGE_OWNER)
    renderAt(`/flows/${fx('FLW-0005')}`)
    const fm = await card('Face match')
    expect(fm.getByRole('radio', { name: /Advanced \(set by platform\)/ }).getAttribute('aria-checked')).toBe('true')
    expect(fm.queryByLabelText('Auto-Reject below')).toBeNull()
    cleanup()
    useSession.getState().switchUser(ADMIN)
    renderAt(`/flows/${fx('FLW-0005')}`)
    const admin = await card('Face match')
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

  it('Given Developer info, then the sample request carries the secret in the header and the flow ID in the body (DEC-111)', async () => {
    renderAt(`/flows/${fx('FLW-0001')}`)
    const sample = (await screen.findByLabelText('Sample create-session request')).textContent!
    expect(sample).toContain('Authorization: Bearer <your project\'s secret key>')
    expect(sample).toContain(`"flowId": "${fx('FLW-0001')}"`)
  })

  it('Given a Retiring flow, then it is read-only', async () => {
    useSession.getState().switchUser(ADMIN)
    renderAt(`/flows/${fx('FLW-0008')}`)
    expect(await screen.findByText(/Retiring flows are read-only/)).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Save changes' })).toBeNull()
  })

  it('Given V4, then Risk shows, and no email requirement: the workflow handles it; V3 has no Risk (DEC-50, DEC-115)', async () => {
    renderAt(`/flows/${fx('FLW-0001')}`)
    expect(await card('Risk Assessment')).toBeTruthy()
    expect(screen.queryByText(/Email required/)).toBeNull()
    expect(screen.getByLabelText('Sample create-session request').textContent).not.toContain('email')
    cleanup()
    renderAt(`/flows/${fx('FLW-0004')}`)
    await card('Liveness')
    expect(screen.queryByRole('region', { name: 'Risk Assessment' })).toBeNull()
    expect(screen.queryByText(/Email required/)).toBeNull()
  })
})

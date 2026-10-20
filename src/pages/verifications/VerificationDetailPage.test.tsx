// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { routes } from '@/app/routes'
import type { AuditAction } from '@/domain/types'
import { auditService } from '@/services/auditService'
import { devService } from '@/services/devService'
import { DEFAULT_DEV_FLAGS, useDevFlags } from '@/stores/devFlagsStore'
import { useSession } from '@/stores/sessionStore'
import { ADMIN, ALI, OTHER_MERCHANT_REVIEWER, minutes } from '@/test/factories'

const S = (n: number) => `KYC-260901-${900000 + n}`

async function open(ref: string) {
  const router = createMemoryRouter(routes, { initialEntries: [`/verifications/${ref}`] })
  render(<RouterProvider router={router} />)
  await screen.findByRole('heading', { level: 1, name: ref })
  return router
}

async function audit(ref: string, actions: AuditAction[]) {
  return (await auditService.list({ referenceNo: ref, actions, pageSize: 500 }, ADMIN)).items.map((e) => e.action).reverse()
}

const decision = () => within(screen.getByRole('region', { name: 'Decision' }))

function fillDecision(outcome: RegExp, reason: string, comment: string) {
  fireEvent.click(decision().getByLabelText(outcome))
  fireEvent.change(decision().getByLabelText(/Reason Code/), { target: { value: reason } })
  fireEvent.change(decision().getByLabelText('Audit Comment'), { target: { value: comment } })
  fireEvent.click(decision().getByRole('button', { name: 'Save decision' }))
}

beforeEach(async () => {
  useDevFlags.setState({ ...DEFAULT_DEV_FLAGS, simulateLatency: false })
  useSession.getState().switchUser(ALI)
  await devService.resetDemoData()
})
afterEach(cleanup)

describe('Verification Detail', () => {
  it('Given S03 unclaimed, when Ali assigns, confirms Manual Pass with reason + comment, then APPROVED by Ali and final', async () => {
    await open(S(3))
    expect(await audit(S(3), ['PII_VIEW'])).toEqual(['PII_VIEW']) // DEC-41: opening logs the view
    expect(decision().getByRole('status').textContent).toBe('Assign to me to review')

    fireEvent.click(screen.getByRole('button', { name: 'Assign to me' }))
    await screen.findByText('You are reviewing this record.')

    fillDecision(/Confirm Manual Pass/, 'FACE_MATCH_CONFIRMED', 'Compared selfie with MyKad photo.')
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm Approved' }))

    await screen.findByText(/Decision is final — Ali Bin Ahmad \(USR-2026-0012\)/)
    expect(screen.getAllByText('Approved').length).toBeGreaterThan(0)
    expect(decision().getByRole('status').textContent).toBe('Decision is final')
    expect(await audit(S(3), ['CLAIM', 'DECISION'])).toEqual(['CLAIM', 'DECISION'])
  })

  it('Given the form is incomplete, then Save shows what is missing and nothing is saved', async () => {
    await open(S(7)) // Ali already holds the claim
    fireEvent.click(decision().getByRole('button', { name: 'Save decision' }))
    expect(decision().getByText('Choose an outcome.')).toBeTruthy()
    fireEvent.click(decision().getByLabelText(/Maintain Automated Rejection/))
    expect(decision().getByText('Reason Code is required.')).toBeTruthy()
    expect(decision().getByText('Audit Comment is required.')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Given S09 is claimed by Siti, then Ali can view but the overlay says who holds it and there is no Assign button (S09)', async () => {
    await open(S(9))
    expect(decision().getByRole('status').textContent).toBe('Claimed by Siti Aminah Binti Yusof')
    expect(screen.queryByRole('button', { name: 'Assign to me' })).toBeNull()
    expect(screen.getByText('NRIC')).toBeTruthy() // viewing is never blocked (DEC-25)
  })

  it('Given S05 PROCESSING, then read-only (S05)', async () => {
    await open(S(5))
    expect(decision().getByRole('status').textContent).toBe('Record is still processing (read-only)')
    expect(screen.getByText(/This record is read-only/)).toBeTruthy()
    expect((decision().getByRole('group', { name: 'Decision' }) as HTMLFieldSetElement).disabled).toBe(true)
  })

  it('Given S11 manually approved, then "Decision is final" (S11)', async () => {
    await open(S(11))
    expect(decision().getByRole('status').textContent).toBe('Decision is final')
    expect(screen.getByText(/Decision is final — Ali Bin Ahmad \(USR-2026-0012\)/)).toBeTruthy()
  })

  it('Given S06, then the reason banner shows the final liveness condition and 4 submissions under one Reference No (DEC-16, DEC-35)', async () => {
    await open(S(6))
    expect(screen.getByText('Face not live (Retry Not Allowed)')).toBeTruthy()
    const history = within(screen.getByRole('region', { name: 'Attempt history' }))
    expect(history.getAllByRole('row')).toHaveLength(5) // header + 4
  })

  it('Given V4 S02, then a Risk panel with HIGH; given V1 S01, then no Risk panel', async () => {
    await open(S(2))
    const risk = within(screen.getByRole('region', { name: 'Risk Assessment (V4)' }))
    expect(risk.getByText('High')).toBeTruthy()
    expect(screen.getByText('Risk Assessment not passed')).toBeTruthy()
    cleanup()
    useSession.getState().switchUser(OTHER_MERCHANT_REVIEWER) // Vantage reviewer
    await open(S(1))
    expect(screen.queryByRole('region', { name: 'Risk Assessment (V4)' })).toBeNull()
  })

  it('Given S15 passport, then passport fields and no NRIC (S15)', async () => {
    useSession.getState().switchUser(OTHER_MERCHANT_REVIEWER)
    await open(S(15))
    expect(screen.getByText('Passport No')).toBeTruthy()
    expect(screen.queryByText('NRIC')).toBeNull()
  })

  it("Given another merchant's record, then not found", async () => {
    const router = createMemoryRouter(routes, { initialEntries: [`/verifications/${S(1)}`] })
    render(<RouterProvider router={router} />)
    await screen.findByText(`${S(1)} not found`)
  })

  it('Given UI claim checks on, when Ali’s claim expires while viewing, then the overlay disables and offers Assign again', async () => {
    await open(S(8)) // ~10 min left
    expect(decision().queryByRole('status')).toBeNull() // enabled
    act(() => useDevFlags.getState().advanceTime(minutes(11)))
    await waitFor(() => expect(decision().getByRole('status').textContent).toBe('Assign to me to review'))
    expect(screen.getByRole('button', { name: 'Assign to me' })).toBeTruthy()
  })

  it('Given UI claim checks off, when Ali saves after his claim expired, then the service refuses: nothing saved, CLAIM_TIMEOUT + OWNERSHIP_CONFLICT audited (S08)', async () => {
    useDevFlags.setState({ uiClaimChecks: false })
    await open(S(8))
    act(() => useDevFlags.getState().advanceTime(minutes(11)))
    fillDecision(/Confirm Manual Pass/, 'DOC_VERIFIED_MANUALLY', 'Looks fine.')
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm Approved' }))
    await screen.findByText('Your claim expired. No changes saved.')
    expect(screen.getAllByText('Pending Review').length).toBeGreaterThan(0)
    expect(await audit(S(8), ['CLAIM_TIMEOUT', 'OWNERSHIP_CONFLICT', 'DECISION'])).toEqual(['CLAIM_TIMEOUT', 'OWNERSHIP_CONFLICT'])
  })

  it('Given Ali holds a claim, when he cancels, then it is released and the record stays Pending Review', async () => {
    await open(S(7))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel claim' }))
    await screen.findByRole('button', { name: 'Assign to me' })
    expect(await audit(S(7), ['CLAIM_RELEASE'])).toEqual(['CLAIM_RELEASE'])
  })
})

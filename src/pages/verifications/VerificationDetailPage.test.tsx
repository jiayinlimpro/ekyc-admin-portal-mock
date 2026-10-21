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
import { ADMIN, ALI, NURUL, OTHER_MERCHANT_REVIEWER, minutes } from '@/test/factories'

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

function fillDecision(outcome: RegExp, reasons: string[], note: string) {
  fireEvent.click(decision().getByLabelText(outcome))
  for (const r of reasons) fireEvent.click(decision().getByLabelText(r))
  fireEvent.change(decision().getByLabelText(/Note/), { target: { value: note } })
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
    expect(await audit(S(3), ['SENSITIVE_PII_VIEW'])).toEqual(['SENSITIVE_PII_VIEW']) // DEC-41: opening logs the view
    expect(decision().getByRole('status').textContent).toBe('Assign to me to review')

    fireEvent.click(screen.getByRole('button', { name: 'Assign to me' }))
    await screen.findByText('You are reviewing this record.')

    fillDecision(/Confirm Manual Pass/, [], 'Compared selfie with MyKad photo.')
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm Approved' }))

    await screen.findByText(/Decision is final — Ali Bin Ahmad\b/)
    expect(screen.getAllByText('Approved').length).toBeGreaterThan(0)
    expect(decision().getByRole('status').textContent).toBe('Decision is final')
    expect(await audit(S(3), ['CASE_CLAIMED', 'CASE_DECISION_APPROVED'])).toEqual(['CASE_CLAIMED', 'CASE_DECISION_APPROVED'])
  })

  it('Given the form is incomplete, then Save shows what is missing and nothing is saved', async () => {
    await open(S(7)) // Ali already holds the claim
    fireEvent.click(decision().getByRole('button', { name: 'Save decision' }))
    expect(decision().getByText('Choose an outcome.')).toBeTruthy()
    fireEvent.click(decision().getByLabelText(/^Reject/))
    expect(decision().getByText('Choose at least one reason.')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Given Reject with two catalogue reasons and no note, then REJECTED with those reasons, audited (DEC-31, DEC-35)', async () => {
    await open(S(7))
    fillDecision(/^Reject/, ['Face not live (Retry Not Allowed)', 'No word detected'], '')
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm Rejected' }))
    await screen.findByText(/Decision is final — Ali Bin Ahmad/)
    expect(await audit(S(7), ['CASE_DECISION_REJECTED'])).toEqual(['CASE_DECISION_REJECTED'])
    expect(screen.getAllByText(/Face not live \(Retry Not Allowed\); No word detected/).length).toBeGreaterThan(0)
  })

  it('Given S09 is claimed by Siti, then Ali can view but the overlay says who holds it and there is no Assign button (S09)', async () => {
    await open(S(9))
    expect(decision().getByRole('status').textContent).toBe('Claimed by Siti Aminah Binti Yusof')
    expect(screen.queryByRole('button', { name: 'Assign to me' })).toBeNull()
    expect(screen.getByText('NRIC')).toBeTruthy() // viewing is never blocked (DEC-25)
  })

  it('Given S16 in SME app, where Ali is a Viewer, then he can view but not assign or decide (S16, DEC-70)', async () => {
    await open(S(16))
    expect(decision().getByRole('status').textContent).toBe('No review permission')
    expect(screen.queryByRole('button', { name: 'Assign to me' })).toBeNull()
    expect(screen.getByText(/Your role in this project can view this record but not review it/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Audit trail' })).toBeNull() // Reviewers and Viewers have no Audit Log (DEC-70)
  })

  it('Given S16, when Nurul (Reviewer in SME app) opens it, then she can assign it', async () => {
    useSession.getState().switchUser(NURUL)
    await open(S(16))
    expect(screen.getByRole('button', { name: 'Assign to me' })).toBeTruthy()
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
    expect(screen.getByText(/Decision is final — Ali Bin Ahmad\b/)).toBeTruthy()
  })

  it('Given S06, then the reason banner shows the final liveness condition and Liveness shows 4 scores, 3 of 3 retries (DEC-16, DEC-35, DEC-44)', async () => {
    await open(S(6))
    expect(screen.getAllByText('Face not live (Retry Not Allowed)').length).toBeGreaterThan(0)
    const liveness = within(screen.getByRole('region', { name: 'Liveness' }))
    expect(within(liveness.getByRole('list', { name: 'Scores in submission order' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['52.3', '58.9', '61', '74.5'])
    expect(liveness.getByText('3 of 3 allowed')).toBeTruthy()
    expect(liveness.getByText('Standard · reject < 70 · approve ≥ 85')).toBeTruthy()
    expect(liveness.getByText('Review band')).toBeTruthy()
  })

  it('Given the header, then project, flow, version, rules applied revision and created are shown (DEC-44)', async () => {
    await open(S(12))
    expect(screen.getByText('Malaysian onboarding')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Rules applied' })).getByText('V4-R1')).toBeTruthy()
    expect(screen.getByText(/^Created /)).toBeTruthy()
  })

  it('Given S18 rejected under a 120-min cooldown, then Liveness shows "New case allowed from" (DEC-26)', async () => {
    await open(S(18))
    const liveness = within(screen.getByRole('region', { name: 'Liveness' }))
    expect(liveness.getByText('120 min after a rejection')).toBeTruthy()
    expect(liveness.getByText('New case allowed from')).toBeTruthy()
  })

  it('Given V4 S02, then a Risk section with HIGH and the components as an open question; given V1 S01, then no Risk section but a Selfie section', async () => {
    await open(S(2))
    const risk = within(screen.getByRole('region', { name: 'Risk Assessment' }))
    expect(risk.getByText('High')).toBeTruthy()
    expect(risk.getByText('Open question OQ-25')).toBeTruthy()
    expect(screen.getByText('Risk Assessment not passed')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Selfie' })).toBeNull() // V4 has no selfie phase
    cleanup()
    useSession.getState().switchUser(OTHER_MERCHANT_REVIEWER) // Vantage reviewer
    await open(S(1))
    expect(screen.queryByRole('region', { name: 'Risk Assessment' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Selfie' })).toBeTruthy()
  })

  it('Given S11, then the Activity timeline shows the claim and the approval', async () => {
    await open(S(11))
    const activity = within(screen.getByRole('region', { name: 'Activity' }))
    expect(activity.getByText('Session started')).toBeTruthy()
    expect(activity.getByText('Case claimed')).toBeTruthy()
    expect(activity.getByText('Case approved')).toBeTruthy()
  })

  it('Given S20 Driving License, then IC, licence class and validity in End-user data (S20, DEC-50)', async () => {
    useSession.getState().switchUser(OTHER_MERCHANT_REVIEWER)
    await open(S(20))
    const data = within(screen.getByRole('region', { name: 'End-user data' }))
    for (const label of ['IC', 'Licence class', 'Valid until']) expect(data.getByText(label)).toBeTruthy()
    expect(screen.getByRole('region', { name: 'ID capture · Driving License' })).toBeTruthy()
    expect(data.queryByText('Email')).toBeNull() // V1 has no email input
  })

  it('Given a V4 case, then End-user data includes the email (DEC-44)', async () => {
    await open(S(3))
    expect(within(screen.getByRole('region', { name: 'End-user data' })).getByText(/@mail\.example$/)).toBeTruthy()
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

  it('Given UI claim checks off, when Ali saves after his claim expired, then the service refuses: nothing saved, CASE_CLAIM_EXPIRED + CASE_DECISION_BLOCKED audited (S08)', async () => {
    useDevFlags.setState({ uiClaimChecks: false })
    await open(S(8))
    act(() => useDevFlags.getState().advanceTime(minutes(11)))
    fillDecision(/Confirm Manual Pass/, [], 'Looks fine.')
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm Approved' }))
    await screen.findByText('Your claim expired. No changes saved.')
    expect(screen.getAllByText('Pending Review').length).toBeGreaterThan(0)
    expect(await audit(S(8), ['CASE_CLAIM_EXPIRED', 'CASE_DECISION_BLOCKED', 'CASE_DECISION_APPROVED'])).toEqual(['CASE_CLAIM_EXPIRED', 'CASE_DECISION_BLOCKED'])
  })

  it('Given Ali holds a claim, when he cancels, then it is released and the record stays Pending Review', async () => {
    await open(S(7))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel claim' }))
    await screen.findByRole('button', { name: 'Assign to me' })
    expect(await audit(S(7), ['CASE_RELEASED'])).toEqual(['CASE_RELEASED'])
  })
})

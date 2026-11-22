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
import { ADMIN, ALI, NURUL, OTHER_MERCHANT_REVIEWER, OWNER, minutes } from '@/test/factories'
import { verificationIdOf } from '@/lib/ids'

const S = (n: number) => `KYC-260901-${900000 + n}`

async function open(ref: string) {
  const router = createMemoryRouter(routes, { initialEntries: [`/verifications/${verificationIdOf(ref)}`] })
  render(<RouterProvider router={router} />)
  await screen.findByRole('heading', { level: 1, name: verificationIdOf(ref) }) // REQ: DEC-114
  return router
}

async function audit(ref: string, actions: AuditAction[]) {
  return (await auditService.list({ referenceId: ref, actions, pageSize: 500 }, ADMIN)).items.map((e) => e.action).reverse()
}

const decision = () => within(screen.getByRole('region', { name: 'Decision' }))
const region = (name: string | RegExp) => within(screen.getByRole('region', { name }))
/** Cells of one table column, by header text. */
function column(table: HTMLElement, header: string): string[] {
  const i = within(table).getAllByRole('columnheader').findIndex((h) => h.textContent === header)
  return within(table).getAllByRole('row').slice(1).map((r) => (r.children[i] as HTMLElement).textContent ?? '')
}
/** Telemetry row (metric label; the last one when a label repeats across stages) → [value, threshold, result]. */
function metric(label: string): string[] {
  const row = within(screen.getByRole('table', { name: 'Telemetry' })).getAllByRole('rowheader', { name: label }).at(-1)!.closest('tr')!
  return [...row.querySelectorAll('td')].map((td) => td.textContent ?? '')
}

const FACE_CONFIRMED = 'Face confirmed by reviewer (e.g. old ID photo)'

function fillDecision(outcome: RegExp, reasons: (string | RegExp)[], note: string) {
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
  it('Given S03 unclaimed, when Ali assigns, confirms Manual Pass with an approve reason + note, then APPROVED by Ali and final (DEC-106)', async () => {
    await open(S(3))
    expect(await audit(S(3), ['SENSITIVE_PII_VIEW'])).toEqual(['SENSITIVE_PII_VIEW']) // DEC-41: opening logs the view
    expect(decision().getByRole('status').textContent).toBe('Assign to me to review')

    fireEvent.click(screen.getByRole('button', { name: 'Assign to me' }))
    await screen.findByText('You are reviewing this record.')

    fillDecision(/Confirm Manual Pass/, [FACE_CONFIRMED], 'Compared selfie with MyKad photo.')
    expect(within(await screen.findByRole('list', { name: 'Chosen reasons' })).getByText(FACE_CONFIRMED)).toBeTruthy()
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
    fireEvent.click(decision().getByLabelText(/Confirm Manual Pass/)) // switching outcome clears the reasons
    expect(decision().getByText('Choose a reason.')).toBeTruthy()
    fireEvent.click(decision().getByLabelText(/^Other/))
    expect(decision().getByText('(required)')).toBeTruthy()
    fireEvent.click(decision().getByRole('button', { name: 'Save decision' }))
    expect(decision().getByText(/^Add a note: “Other” needs one\./)).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Given Reject offers the project’s reasons by group, including its own; two chosen with a note, then REJECTED with them, audited (DEC-106)', async () => {
    await open(S(7))
    fireEvent.click(decision().getByLabelText(/^Reject/))
    expect(within(decision().getByRole('group', { name: 'Fraud & risk' })).getByLabelText(/^Customer on internal watchlist/)).toBeTruthy() // Atoz Default’s Custom reason
    fillDecision(/^Reject/, ['Spoof suspected (photo, mask, screen, deepfake)', /^Customer on internal watchlist/], 'Matches a watchlist entry.')
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm Rejected' }))
    await screen.findByText(/Decision is final — Ali Bin Ahmad/)
    expect(await audit(S(7), ['CASE_DECISION_REJECTED'])).toEqual(['CASE_DECISION_REJECTED'])
    expect(screen.getAllByText(/Spoof suspected \(photo, mask, screen, deepfake\); Customer on internal watchlist/).length).toBeGreaterThan(0)
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
    expect(screen.queryByRole('link', { name: 'Audit trail' })).toBeNull() // no audit link on the case page (DEC-105); Reviewers and Viewers have no Audit Log (DEC-70)
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

  it('Given S06, then the banner shows the liveness condition with target vs actual, and Attempts the 4 scores, 3 of 3 retries (DEC-16, DEC-105)', async () => {
    await open(S(6))
    expect(screen.getAllByText('Face not live (Retry Not Allowed)').length).toBeGreaterThan(0)
    expect(screen.getByText('Auto-Reject < 70 · Auto-Pass ≥ 85 · Actual 74.5')).toBeTruthy()
    expect(column(screen.getByRole('table', { name: 'Attempts' }), 'Liveness confidence')).toEqual(['52.3', '58.9', '61.0', '74.5'])
    const checks = region('Checks')
    expect(checks.getByText('Standard · Auto-Reject < 70 · Auto-Pass ≥ 85 · 3 of 3 retries used')).toBeTruthy()
    expect(checks.getByText('Review band')).toBeTruthy()
  })

  it('Given the header strip, then project › flow, version, rules applied revision and created; the SDK only in the metadata box (DEC-105)', async () => {
    await open(S(12))
    expect(screen.getByText('Malaysian onboarding')).toBeTruthy()
    expect(region('Rules applied').getByText('V4-R1')).toBeTruthy()
    expect(screen.getByText(/^Created /)).toBeTruthy()
    const meta = within(screen.getByRole('region', { name: 'Client metadata' })) // top right of the header (DEC-105)
    for (const label of ['SDK', 'OS', 'Device', 'IP address', 'Location']) expect(meta.getByText(label)).toBeTruthy()
    const os = meta.getByText('OS').nextElementSibling!.textContent!
    expect(screen.getByRole('heading', { level: 1 }).closest('header')!.querySelector('div')!.textContent).not.toMatch(/Source|sdk/i) // SDK and OS only in the metadata box
    expect(os).toBeTruthy()
  })

  it('Given the Owner, who can open the Audit Log, then still no Audit trail link on the case page (DEC-105)', async () => {
    useSession.getState().switchUser(OWNER)
    await open(S(3))
    expect(screen.queryByRole('link', { name: 'Audit trail' })).toBeNull()
  })

  it('Given S18 rejected under a 120-min cooldown, then both cooldowns are in Rules applied and the banner says when a new session is allowed (DEC-26)', async () => {
    await open(S(18))
    expect(region('Rules applied').getByText('Cooldown after Rejected')).toBeTruthy()
    expect(region('Rules applied').getByText('120 min')).toBeTruthy()
    expect(region('Rules applied').getByText('Cooldown after Failed')).toBeTruthy()
    expect(screen.getByText(/^New session allowed from .* MYT \(cooldown\)$/)).toBeTruthy()
  })

  it('Given V4 S02, then High risk with the four scores against the fixed minimums, and the banner lists the categories below (DEC-107)', async () => {
    await open(S(2))
    const risk = region('Risk Assessment')
    expect(within(risk.getByRole('heading', { name: 'Risk Assessment' }).parentElement!).getByText('High risk')).toBeTruthy() // overall, in the section header
    const table = risk.getByRole('table', { name: 'Risk categories' })
    expect(column(table, 'Score')).toEqual(['32', '18', '20', '10'])
    expect(column(table, 'Minimum')).toEqual(['50', '50', '50', '50'])
    expect(column(table, 'Result')).toEqual(['High risk', 'High risk', 'High risk', 'High risk'])
    expect(risk.getByText(/Minimums fixed by the platform/)).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Risk signals' })).toBeNull() // no breakdown
    expect(screen.getByText('Risk Assessment: high risk')).toBeTruthy()
    expect(screen.getByText('EXIF Score 32 < 50 · Noise Score 18 < 50 · Email Validity Score 20 < 50 · OSINT Score 10 < 50')).toBeTruthy()
    expect(region('Checks').queryByText('Selfie')).toBeNull() // V4 has no selfie phase
  })

  it('Given V5 S23, then the flow’s own minimums apply: High risk by OSINT 22 < 30 only (DEC-107)', async () => {
    await open(S(23))
    const table = region('Risk Assessment').getByRole('table', { name: 'Risk categories' })
    expect(column(table, 'Minimum')).toEqual(['40', '60', '50', '30'])
    expect(column(table, 'Result')).toEqual(['Low risk', 'Low risk', 'Low risk', 'High risk'])
    expect(region('Risk Assessment').getByText(/Minimums set by this flow/)).toBeTruthy()
    expect(screen.getByText('OSINT Score 22 < 30')).toBeTruthy()
  })

  it('Given V1 S01, then no Risk section, a Selfie check, and every selfie metric with its engine threshold (DEC-105)', async () => {
    useSession.getState().switchUser(OTHER_MERCHANT_REVIEWER) // Vantage reviewer
    await open(S(1))
    expect(screen.queryByRole('region', { name: 'Risk Assessment' })).toBeNull()
    expect(region('Checks').getByText('Selfie')).toBeTruthy()
    for (const [label, threshold] of [['Eyes open', 'Yes'], ['Face covered', 'No'], ['Sharpness', '> 25'], ['Brightness', '> 25'], ['Yaw', 'within ±30°'], ['Pitch', 'within ±30°']]) {
      expect(metric(label).slice(1), label).toEqual([threshold, 'Pass'])
    }
    expect(metric('Face size').slice(1)).toEqual(['50 px configured, not checked', 'Information only']) // OQ-32
    expect(region('Checks').getByText(/^Selfie vs ID ·/)).toBeTruthy()
  })

  it('Given S03, then the faces side by side with the face match score; face match (similarity) and face detection confidence are separate (DEC-105)', async () => {
    await open(S(3))
    const evidence = region('Evidence')
    expect(evidence.getByRole('img', { name: /^MyKad front/ })).toBeTruthy()
    expect(evidence.getByRole('img', { name: /^Liveness frame, attempt 4/ })).toBeTruthy()
    expect(evidence.getByText('Face match 88.5')).toBeTruthy()
    expect(metric('Face match (similarity)')).toEqual(['88.5', 'Auto-Reject < 85 · Auto-Pass ≥ 95', 'Review band'])
    const faceMatch = within(screen.getByRole('table', { name: 'Telemetry' })).getAllByRole('rowheader', { name: 'Face detection confidence' }).map((h) => h.closest('tr')!.textContent)
    expect(faceMatch).toEqual([expect.stringMatching(/≥ 90Pass$/), expect.stringMatching(/> 90Pass$/)]) // on the ID, then on the compared face
    expect(screen.getByText(/Face detection confidence: a face is clearly detected \(not liveness\)/)).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: 'Set by' })).toBeNull()
    expect(region('Checks').getByText(/^Liveness face vs ID ·/)).toBeTruthy()
    expect(region('Checks').queryByText(/Similarity|Face detection/)).toBeNull() // the check is named Face match
    expect(metric('Image size')[1]).toBe('≥ 320 × 320 px')
  })

  it('Given V1 S22, whose selfie was too dark, then it was not compared: no face match, and the rejected selfie says why (DEC-105)', async () => {
    useSession.getState().switchUser(OTHER_MERCHANT_REVIEWER)
    await open(S(22))
    expect(region('Checks').getByText('Fail: not compared with the ID')).toBeTruthy()
    expect(metric('Brightness')).toEqual(['14.2', '> 25', 'Fail'])
    expect(metric('Face match (similarity)').slice(0, 1)).toEqual(['Not run'])
    expect(region('Evidence').getByText('Not compared: the selfie failed its quality check.')).toBeTruthy()
    expect(within(screen.getByRole('table', { name: 'Attempts' })).getByText('Selfie rejected')).toBeTruthy()
    expect(region('Checks').getByText('Not checked yet')).toBeTruthy() // duplicate user: no search without a face comparison
  })

  it('Given S25, then the 4th ID image still failed with 3 of 3 Document retries used, so Failed by the engine (DEC-108, DEC-112)', async () => {
    await open(S(25))
    expect(screen.getAllByText('Failed').length).toBeGreaterThan(0) // status badge
    expect(screen.getByText('ID image smaller than 320x320 (Retry Not Allowed)')).toBeTruthy()
    expect(region('Checks').getByText('3 earlier ID image(s) failed · 3 of 3 retries used')).toBeTruthy()
    expect(region('Rules applied').getByText('Document (OCR) 3 · Liveness 3')).toBeTruthy()
    // REQ: DEC-112 — nothing to review: no claim, no decision buttons.
    expect(decision().getByRole('status').textContent).toBe('Failed: nothing to review')
    expect(screen.queryByRole('button', { name: 'Assign to me' })).toBeNull()
    expect(screen.getByText(/^Failed: no usable image when retries ran out — SYSTEM\. Nothing to review; the same Reference ID can start a new session\.$/)).toBeTruthy()
  })

  it('Given S30 (3 sessions), then Sessions lists Failed, Rejected and the current Approved session with flow, rules and tokens (DEC-113)', async () => {
    await open(S(30))
    const t = within(await screen.findByRole('table', { name: 'Sessions' }))
    const body = t.getAllByRole('row').slice(1).map((r) => [...r.querySelectorAll('th, td')].map((c) => c.textContent))
    expect(body.map((c) => c[0])).toEqual(['Session 1', 'Session 2', 'Session 3Current'])
    expect(body.map((c) => c[2])).toEqual(['Malaysian onboarding V4-R1', 'Malaysian onboarding V4-R1', 'Malaysian onboarding V4-R2'])
    expect(body[0][3]).toMatch(/^Failed/)
    expect(body[0][4]).toMatch(/^ID image smaller than 320x320 \(Retry Not Allowed\)1 attempt\(s\)/)
    expect(body[0][6]).toBe('4') // 4 ID images (DEC-60)
    expect(body[1][3]).toMatch(/^Rejected/)
    expect(body[2][3]).toBe('Approved')
    expect(screen.getByText(/^Session 3 \(current\) · Same Reference ID for every retry$/)).toBeTruthy()
  })

  it('Given a case with one session, then no Sessions section', async () => {
    await open(S(25))
    expect(screen.queryByRole('table', { name: 'Sessions' })).toBeNull()
  })

  it('Given S33 Failed 17 min ago under a 30-min Cooldown after Failed, then the banner says when a new session is allowed (DEC-26, DEC-112)', async () => {
    await open(S(33))
    expect(screen.getByText(/^New session allowed from .* MYT \(cooldown\)$/)).toBeTruthy()
    expect(region('Rules applied').getByText('Cooldown after Failed').nextElementSibling!.textContent).toBe('30 min')
  })

  it('Given S27, then 4 rejected selfies under Attempts and the case Failed with nothing compared (DEC-112)', async () => {
    useSession.getState().switchUser(OTHER_MERCHANT_REVIEWER) // Vantage reviewer
    await open(S(27))
    expect(screen.getByText('No valid face in Selfie detected (Retry Not Allowed)')).toBeTruthy()
    expect(within(screen.getByRole('table', { name: 'Attempts' })).getAllByText('Selfie rejected')).toHaveLength(4)
  })

  it('Given a case page, then the heading is the Verification ID with a copy button, and the Reference ID follows it (DEC-114)', async () => {
    await open(S(3))
    expect(screen.getByRole('button', { name: 'Copy Verification ID' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy Reference ID' })).toBeTruthy()
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.compareDocumentPosition(screen.getByText(S(3))) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('Given S05 stopped at ID capture, then the failing ID checks say why (DEC-105)', async () => {
    await open(S(5))
    expect(region('Checks').getByText('Fail: Image size, OCR fields detected')).toBeTruthy()
    expect(metric('Image size')).toEqual(['300 × 240 px', '≥ 320 × 320 px', 'Fail'])
    expect(metric('OCR fields detected')[0]).toBe('3 / 4 (missing: Address)')
  })

  it('Given S21, then "Existing user found" is shown for information, and the case can still be claimed and decided as usual (DEC-105)', async () => {
    await open(S(21))
    const checks = region('Checks')
    expect(checks.getByText('Existing user found (similarity 97.6, ≥ 90)')).toBeTruthy()
    expect(checks.getByText('Information only: never changes the result')).toBeTruthy()
    expect(metric('Face search').slice(2)).toEqual(['Information only'])
    expect(screen.getByRole('button', { name: 'Assign to me' })).toBeTruthy()
  })

  it('Given S11, then no Activity section: the history is in the Audit Log (DEC-105)', async () => {
    await open(S(11))
    expect(screen.queryByRole('region', { name: 'Activity' })).toBeNull()
  })

  it('Given S20 Driving License, then IC, licence class and validity in Extracted data (S20, DEC-50)', async () => {
    useSession.getState().switchUser(OTHER_MERCHANT_REVIEWER)
    await open(S(20))
    const data = region('Extracted data · Driving License')
    for (const label of ['IC', 'Licence class', 'Valid until']) expect(data.getByText(label)).toBeTruthy()
    expect(metric('OCR fields detected')[0]).toBe('6 / 6')
    expect(data.queryByText('Email')).toBeNull() // V1 has no email input
  })

  it('Given a V4 case, then Extracted data includes the email (DEC-44)', async () => {
    await open(S(3))
    expect(region('Extracted data · MyKad').getByText(/@mail\.example$/)).toBeTruthy()
  })

  it('Given S15 passport, then passport fields and no NRIC (S15)', async () => {
    useSession.getState().switchUser(OTHER_MERCHANT_REVIEWER)
    await open(S(15))
    expect(screen.getByText('Passport No')).toBeTruthy()
    expect(screen.queryByText('NRIC')).toBeNull()
  })

  it("Given another merchant's record, then not found", async () => {
    const router = createMemoryRouter(routes, { initialEntries: [`/verifications/${verificationIdOf(S(1))}`] })
    render(<RouterProvider router={router} />)
    await screen.findByText('Case not found')
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
    fillDecision(/Confirm Manual Pass/, [FACE_CONFIRMED], 'Looks fine.')
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

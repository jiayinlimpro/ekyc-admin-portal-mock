import { expect, test } from '@playwright/test'

// List filter → open detail → claim → approve → audit entry exists (seen by the Merchant Owner).
test('reviewer finds an unclaimed pending record, claims it, approves it, and the decision is audited', async ({ page }) => {
  // REQ: DEC-109 — sign in, then Go to project on the Merchants page (the inner portal works on one project).
  await page.goto('/?as=ali.ahmad@atoz.example')
  await page.getByRole('button', { name: 'Go to project Default' }).click()
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Verifications' }).click()
  // The default view is Pending Review, oldest first (DEC-43); narrow it to unclaimed cases.
  await page.getByLabel('Claim', { exact: true }).selectOption('UNCLAIMED')
  await page.getByRole('button', { name: 'Search' }).click()
  await expect(page).toHaveURL(/claim=UNCLAIMED/)
  await expect(page.locator('table[aria-busy="false"] tbody tr').first()).toBeVisible()

  // Open S03 directly from the filtered list via the top-bar search.
  await page.getByLabel('Go to Reference ID').fill('KYC-260901-900003')
  await page.getByLabel('Go to Reference ID').press('Enter')
  await expect(page.getByRole('heading', { level: 1, name: 'KYC-260901-900003' })).toBeVisible()

  await page.getByRole('button', { name: 'Assign to me' }).click()
  await expect(page.getByText('You are reviewing this record.')).toBeVisible()

  const decision = page.getByRole('region', { name: 'Decision' })
  await decision.getByText('Confirm Manual Pass').click()
  await decision.getByLabel('Face confirmed by reviewer (e.g. old ID photo)').check() // REQ: DEC-106 — Approve needs one reason
  await decision.getByLabel(/Note/).fill('E2E: selfie matches MyKad photo.')
  await decision.getByRole('button', { name: 'Save decision' }).click()
  await page.getByRole('button', { name: 'Confirm Approved' }).click()
  await expect(page.getByText(/Decision is final — Ali Bin Ahmad/)).toBeVisible()

  // Reviewers have no Audit Log (DEC-70): the Merchant Owner checks the trail.
  await expect(page.getByRole('link', { name: 'Audit trail' })).toHaveCount(0)
  await page.goto('/?as=meiling.tan@atoz.example')
  await page.getByRole('button', { name: 'Go to project Default' }).click()
  await page.goto('/audit?ref=KYC-260901-900003') // the session (and its project) stays in this tab
  const rows = page.locator('section[aria-label="Audit entries"] tbody tr')
  await expect(rows.first()).toContainText('CASE_DECISION_APPROVED')
  await expect(rows.first()).toContainText('E2E: selfie matches MyKad photo.')
  await expect(page.locator('section[aria-label="Audit entries"]')).toContainText('SENSITIVE_PII_VIEW')
})

test('reviewer cannot open platform screens: no Platform Users in the menu and "No access" on the URL (DEC-104, DEC-109)', async ({ page }) => {
  await page.goto('/platform-users?as=ali.ahmad@atoz.example')
  await expect(page.getByRole('heading', { name: 'No access' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Platform Users' })).toHaveCount(0)
})

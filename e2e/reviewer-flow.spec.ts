import { expect, test } from '@playwright/test'

// List filter → open detail → claim → approve → audit entry exists (seen by the Merchant Owner).
test('reviewer finds an unclaimed pending record, claims it, approves it, and the decision is audited', async ({ page }) => {
  await page.goto('/verifications?as=ali.ahmad@atoz.example')
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
  await decision.getByLabel(/Note/).fill('E2E: selfie matches MyKad photo.')
  await decision.getByRole('button', { name: 'Save decision' }).click()
  await page.getByRole('button', { name: 'Confirm Approved' }).click()
  await expect(page.getByText(/Decision is final — Ali Bin Ahmad/)).toBeVisible()

  // Reviewers have no Audit Log (DEC-70): the Merchant Owner checks the trail.
  await expect(page.getByRole('link', { name: 'Audit trail' })).toHaveCount(0)
  await page.goto('/audit?ref=KYC-260901-900003&as=meiling.tan@atoz.example')
  const rows = page.locator('section[aria-label="Audit entries"] tbody tr')
  await expect(rows.first()).toContainText('CASE_DECISION_APPROVED')
  await expect(rows.first()).toContainText('E2E: selfie matches MyKad photo.')
  await expect(page.locator('section[aria-label="Audit entries"]')).toContainText('SENSITIVE_PII_VIEW')
})

test('reviewer cannot open settings screens: no Flows in the menu and "No access" on the URL', async ({ page }) => {
  await page.goto('/flows?as=ali.ahmad@atoz.example')
  await expect(page.getByRole('heading', { name: 'No access' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Flows' })).toHaveCount(0)
})

import { expect, test } from '@playwright/test'

// List filter → open detail → claim → approve → audit entry exists (seen by the Merchant Owner).
test('reviewer finds an unclaimed pending record, claims it, approves it, and the decision is audited', async ({ page }) => {
  await page.goto('/verifications?as=USR-2026-0012')
  await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'Pending Review' }).click()
  await page.getByLabel('Claimed By').selectOption('UNCLAIMED')
  await page.getByRole('button', { name: 'Search' }).click()
  await expect(page).toHaveURL(/status=PENDING_REVIEW/)
  await expect(page).toHaveURL(/claimedBy=UNCLAIMED/)
  await expect(page.locator('table[aria-busy="false"] tbody tr').first()).toBeVisible()

  // Open S03 directly from the filtered list via the top-bar search.
  await page.getByLabel('Go to Reference No').fill('KYC-260901-900003')
  await page.getByLabel('Go to Reference No').press('Enter')
  await expect(page.getByRole('heading', { level: 1, name: 'KYC-260901-900003' })).toBeVisible()

  await page.getByRole('button', { name: 'Assign to me' }).click()
  await expect(page.getByText('You are reviewing this record.')).toBeVisible()

  const decision = page.getByRole('region', { name: 'Decision' })
  await decision.getByText('Confirm Manual Pass').click()
  await decision.getByLabel(/Reason Code/).selectOption('FACE_MATCH_CONFIRMED')
  await decision.getByLabel('Audit Comment').fill('E2E: selfie matches MyKad photo.')
  await decision.getByRole('button', { name: 'Save decision' }).click()
  await page.getByRole('button', { name: 'Confirm Approved' }).click()
  await expect(page.getByText(/Decision is final — Ali Bin Ahmad \(USR-2026-0012\)/)).toBeVisible()

  // Reviewers have no Audit Log (DEC-70): the Merchant Owner checks the trail.
  await expect(page.getByRole('link', { name: 'Audit trail' })).toHaveCount(0)
  await page.goto('/audit?ref=KYC-260901-900003&as=USR-2026-0002')
  const rows = page.locator('section[aria-label="Audit entries"] tbody tr')
  await expect(rows.first()).toContainText('DECISION')
  await expect(rows.first()).toContainText('E2E: selfie matches MyKad photo.')
  await expect(page.locator('section[aria-label="Audit entries"]')).toContainText('PII_VIEW')
})

test('reviewer cannot open admin screens and sees only their merchant', async ({ page }) => {
  await page.goto('/workflow?as=USR-2026-0012')
  await expect(page.getByRole('heading', { name: 'No access' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /eKYC Workflow/ })).toHaveCount(0)
})

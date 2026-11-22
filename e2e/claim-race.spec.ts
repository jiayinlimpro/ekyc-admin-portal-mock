import { expect, test } from '@playwright/test'

// S10's Verification ID (Reference ID KYC-260901-900010). Seeded IDs are stable across resets (MOCK-05); case URLs use the Verification ID (DEC-97).
const S10_VERIFICATION_ID = 'vrf_ahdcf0j77ilftmnxon73ec2e'

// S10 — two reviewers race for the same unclaimed record. Two tabs in ONE browser context: they share the mock DB
// (localStorage + storage events) but each tab has its own signed-in user (sessionStorage).
test('S10: first reviewer wins the claim, the second is refused and sees who holds it', async ({ context }) => {
  const ref = S10_VERIFICATION_ID
  const ali = await context.newPage()
  await ali.goto(`/verifications/${ref}?as=ali.ahmad@atoz.example`)
  await expect(ali.getByRole('heading', { level: 1, name: 'KYC-260901-900010' })).toBeVisible()

  const siti = await context.newPage()
  await siti.goto(`/verifications/${ref}?as=siti.yusof@atoz.example`)
  await expect(siti.getByRole('heading', { level: 1, name: 'KYC-260901-900010' })).toBeVisible()
  await expect(siti.getByRole('button', { name: 'Assign to me' })).toBeVisible()

  // Ali claims first.
  await ali.getByRole('button', { name: 'Assign to me' }).click()
  await expect(ali.getByText('You are reviewing this record.')).toBeVisible()

  // Siti's tab refreshes live and shows the claim — no Assign button any more.
  await expect(siti.getByText(/Claimed by Ali Bin Ahmad/).first()).toBeVisible()
  await expect(siti.getByRole('button', { name: 'Assign to me' })).toHaveCount(0)
  await expect(siti.getByRole('region', { name: 'Decision' }).getByRole('status')).toHaveText('Claimed by Ali Bin Ahmad')
})

test('S10 (true race): both click Assign before either tab refreshes — the service lets only one win', async ({ context }) => {
  const ref = S10_VERIFICATION_ID
  const ali = await context.newPage()
  const siti = await context.newPage()
  await ali.goto(`/verifications/${ref}?as=ali.ahmad@atoz.example`)
  await siti.goto(`/verifications/${ref}?as=siti.yusof@atoz.example`)
  await expect(ali.getByRole('button', { name: 'Assign to me' })).toBeVisible()
  await expect(siti.getByRole('button', { name: 'Assign to me' })).toBeVisible()

  await Promise.all([ali.getByRole('button', { name: 'Assign to me' }).click(), siti.getByRole('button', { name: 'Assign to me' }).click()])

  // Exactly one tab ends up holding the claim; the other sees it held by the winner.
  await expect.poll(async () => (await ali.getByText('You are reviewing this record.').count()) + (await siti.getByText('You are reviewing this record.').count())).toBe(1)
  const aliWon = (await ali.getByText('You are reviewing this record.').count()) === 1
  const loser = aliWon ? siti : ali
  await expect(loser.getByText(aliWon ? /Claimed by Ali Bin Ahmad/ : /Claimed by Siti Aminah Binti Yusof/).first()).toBeVisible()
})

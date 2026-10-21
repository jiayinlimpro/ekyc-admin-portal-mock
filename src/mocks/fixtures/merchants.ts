import type { Merchant } from '@/domain/types'
import { fx } from '@/lib/ids'

// REQ: DEC-98 — demo merchants. Registration and phone numbers are made up (MOCK-09): the Malaysian ones follow the SSM
// 12-digit format but belong to no company; +1 555 numbers are fictional.
type MerchantSpec = Omit<Merchant, 'createdAt' | 'createdBy'> & { createdDaysAgo: number }

const SPECS: MerchantSpec[] = [
  { merchantId: fx('MER-0001'), name: 'Atoz Software Tech', registrationNo: '201801023456', country: 'MY', primaryContact: { fullName: 'Tan Mei Ling', email: 'meiling.tan@atoz.example', phone: '+60 3-2345 6789' }, status: 'ACTIVE', createdDaysAgo: 400 },
  { merchantId: fx('MER-0002'), name: 'Vantage', registrationNo: '615 234 789', country: 'AU', primaryContact: { fullName: 'Ahmad Faiz Bin Zulkifli', email: 'faiz.zulkifli@vantage.example', phone: '+61 2 9000 0000' }, status: 'ACTIVE', createdDaysAgo: 400 },
  { merchantId: fx('MER-0003'), name: 'Tesla', registrationNo: '88-1234567', country: 'US', primaryContact: { fullName: 'Wong Kah Heng', email: 'kahheng.wong@tesla.example', phone: '+1 512 555 0100' }, status: 'ACTIVE', createdDaysAgo: 300 },
  { merchantId: fx('MER-0004'), name: 'The Boring Company', registrationNo: '81-7654321', country: 'US', primaryContact: { fullName: 'Farah Binti Ismail', email: 'farah.ismail@boring.example' }, status: 'ACTIVE', createdDaysAgo: 300 },
  { merchantId: fx('MER-0005'), name: '3Nova', registrationNo: '202001034567', country: 'MY', primaryContact: { fullName: 'Ng Chee Keong', email: 'cheekeong.ng@3nova.example', phone: '+60 12-345 6789' }, status: 'ACTIVE', createdDaysAgo: 250 },
  // S14: no records yet; still Onboarding (sandbox only).
  { merchantId: fx('MER-0006'), name: 'Empty Demo Merchant', registrationNo: '202301045678', country: 'MY', primaryContact: { fullName: 'Rajesh A/L Muthu', email: 'rajesh.muthu@emptydemo.example' }, status: 'ONBOARDING', createdDaysAgo: 20 },
]

export function buildMerchants(now: Date): Merchant[] {
  return SPECS.map(({ createdDaysAgo, ...m }) => ({ ...m, createdAt: new Date(now.getTime() - createdDaysAgo * 86_400_000).toISOString(), createdBy: 'Lim Wei Jie' }))
}

/** Share of background records per merchant (MER-0006 intentionally absent). */
export const MERCHANT_WEIGHTS: Record<string, number> = { [fx('MER-0001')]: 30, [fx('MER-0002')]: 20, [fx('MER-0003')]: 20, [fx('MER-0004')]: 15, [fx('MER-0005')]: 15 }

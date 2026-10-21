import type { Merchant } from '@/domain/types'
import { fx } from '@/lib/ids'

export const MERCHANTS: Merchant[] = [
  { merchantId: fx('MER-0001'), name: 'Atoz Software Tech' },
  { merchantId: fx('MER-0002'), name: 'Vantage' },
  { merchantId: fx('MER-0003'), name: 'Tesla' },
  { merchantId: fx('MER-0004'), name: 'The Boring Company' },
  { merchantId: fx('MER-0005'), name: '3Nova' },
  { merchantId: fx('MER-0006'), name: 'Empty Demo Merchant' }, // S14: no records
]

/** Share of background records per merchant (MER-0006 intentionally absent). */
export const MERCHANT_WEIGHTS: Record<string, number> = { [fx('MER-0001')]: 30, [fx('MER-0002')]: 20, [fx('MER-0003')]: 20, [fx('MER-0004')]: 15, [fx('MER-0005')]: 15 }

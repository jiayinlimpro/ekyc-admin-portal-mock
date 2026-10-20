import type { Merchant } from '@/domain/types'

export const MERCHANTS: Merchant[] = [
  { merchantId: 'MER-0001', name: 'Atoz Software Tech' },
  { merchantId: 'MER-0002', name: 'Vantage' },
  { merchantId: 'MER-0003', name: 'Tesla' },
  { merchantId: 'MER-0004', name: 'The Boring Company' },
  { merchantId: 'MER-0005', name: '3Nova' },
  { merchantId: 'MER-0006', name: 'Empty Demo Merchant' }, // S14: no records
]

/** Share of background records per merchant (MER-0006 intentionally absent). */
export const MERCHANT_WEIGHTS: Record<string, number> = { 'MER-0001': 30, 'MER-0002': 20, 'MER-0003': 20, 'MER-0004': 15, 'MER-0005': 15 }

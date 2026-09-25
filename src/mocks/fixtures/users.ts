import type { Actor } from '@/domain/types'

export const USERS: Actor[] = [
  { userId: 'USR-2026-0001', fullName: 'Lim Wei Jie', role: 'PLATFORM_ADMIN' },
  { userId: 'USR-2026-0012', fullName: 'Ali Bin Ahmad', role: 'MERCHANT_REVIEWER', merchantId: 'MER-0001' },
  { userId: 'USR-2026-0031', fullName: 'Siti Aminah Binti Yusof', role: 'MERCHANT_REVIEWER', merchantId: 'MER-0001' },
  { userId: 'USR-2026-0044', fullName: 'Kavitha A/P Subramaniam', role: 'MERCHANT_REVIEWER', merchantId: 'MER-0002' },
  { userId: 'USR-2026-0052', fullName: 'Wong Kah Heng', role: 'MERCHANT_REVIEWER', merchantId: 'MER-0003' },
  { userId: 'USR-2026-0063', fullName: 'Farah Binti Ismail', role: 'MERCHANT_REVIEWER', merchantId: 'MER-0004' },
  { userId: 'USR-2026-0071', fullName: 'Ng Chee Keong', role: 'MERCHANT_REVIEWER', merchantId: 'MER-0005' },
  { userId: 'USR-2026-0080', fullName: 'Rajesh A/L Muthu', role: 'MERCHANT_REVIEWER', merchantId: 'MER-0006' },
]

export const DEFAULT_USER = USERS[1] // Ali Bin Ahmad — main reviewer persona in docs/SCENARIOS.md

export const userById = (id: string) => USERS.find((u) => u.userId === id)

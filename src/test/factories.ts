// Minimal builders for unit tests. Independent of src/mocks so domain tests don't depend on seed data.
import type { Actor, Attempt, Verification } from '@/domain/types'

export const NOW = new Date('2026-09-25T02:00:00.000Z')

export const ALI: Actor = { userId: 'USR-2026-0012', fullName: 'Ali Bin Ahmad' }
export const SITI: Actor = { userId: 'USR-2026-0031', fullName: 'Siti Aminah Binti Yusof' }
export const OTHER_MERCHANT_REVIEWER: Actor = { userId: 'USR-2026-0044', fullName: 'Kavitha A/P Subramaniam' }
export const ADMIN: Actor = { userId: 'USR-2026-0001', fullName: 'Lim Wei Jie' }
// Per-project personas (seeded accounts). Services read their rights from the account.
export const OWNER: Actor = { userId: 'USR-2026-0002', fullName: 'Tan Mei Ling' } // Merchant Owner, Atoz
export const HAFIZ: Actor = { userId: 'USR-2026-0020', fullName: 'Hafiz Bin Rahman' } // Project Admin, SME app
export const NURUL: Actor = { userId: 'USR-2026-0033', fullName: 'Nurul Huda Binti Kamaruddin' } // Reviewer, SME app
export const EMPTY_OWNER: Actor = { userId: 'USR-2026-0080', fullName: 'Rajesh A/L Muthu' } // Owner, Empty Demo Merchant

export function completed(scores: Attempt['phaseScores'], attemptNo = 1): Attempt {
  return { attemptNo, phase: 'LIVENESS', startedAt: NOW.toISOString(), outcome: 'COMPLETED', isUserRetake: attemptNo > 1, phaseScores: scores }
}

export function stopped(phase: Attempt['phase'], outcome: Attempt['outcome'], attemptNo = 1): Attempt {
  return { attemptNo, phase, startedAt: NOW.toISOString(), outcome, isUserRetake: attemptNo > 1, phaseScores: {} }
}

export const ALL_PASS = { DOCUMENT: 95, SELFIE: 95, FACE_MATCH: 95, LIVENESS: 95 }

export function verification(overrides: Partial<Verification> = {}): Verification {
  return {
    referenceNo: 'KYC-260925-000001',
    merchantId: 'MER-0001',
    workflowVersion: 'V4',
    status: 'PENDING_REVIEW',
    lastUpdatedBy: { kind: 'SYSTEM' },
    lastUpdatedAt: NOW.toISOString(),
    attempts: [completed(ALL_PASS)],
    riskLevel: 'LOW',
    riskScore: 10,
    documentType: 'MYKAD',
    pii: {
      fullName: 'TEST PERSON',
      nric: '900101-10-9991',
      gender: 'LELAKI',
      dob: '1990-01-01',
      nationality: 'WARGANEGARA',
      address: 'No. 1, Jalan Ujian 1/1, 40000 Shah Alam, Selangor',
    },
    clientMetadata: { sdk: 'ekyc-web-sdk 3.4.1', os: 'Windows 11', device: 'Chrome 140', ip: '192.0.2.10' },
    images: { docFront: '/mock/mykad-front.svg', selfie: '/mock/selfie.svg' },
    charged: true,
    projectId: 'PRJ-0001',
    flowId: 'FLW-0001',
    configRevision: 2,
    createdAt: NOW.toISOString(),
    submissions: { FACE_MATCH: [95], LIVENESS: [95] },
    idCaptureSoftRejects: 0,
    ...overrides,
  }
}

export const minutes = (n: number) => n * 60_000
export const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs)

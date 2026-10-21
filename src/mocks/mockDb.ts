// In-memory mock database, persisted to localStorage so demo state survives refresh and is shared across tabs.
// Only src/services may import this file.
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { AuditEntry, Verification } from '@/domain/types'
import { now } from '@/lib/clock'
import { DB_VERSION, seedDatabase, type MockDbState } from './seed'
import { newId } from '@/lib/ids'

export const DB_STORAGE_KEY = 'ekyc-mock-db'

export const useMockDb = create<MockDbState>()(
  persist(() => seedDatabase(now()), {
    name: DB_STORAGE_KEY,
    version: DB_VERSION,
    storage: createJSONStorage(() => localStorage),
    migrate: () => seedDatabase(now()), // shape changed: start from fresh demo data
  }),
)

// Another tab changed the data (e.g. claimed a record): pick it up so the two-reviewer race is visible.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === DB_STORAGE_KEY) void useMockDb.persist.rehydrate()
  })
}

export const db = {
  state: () => useMockDb.getState(),

  findVerification(caseId: string): Verification | undefined {
    return useMockDb.getState().verifications.find((v) => v.caseId === caseId)
  },

  updateVerification(caseId: string, fn: (v: Verification) => Verification): Verification {
    let updated: Verification | undefined
    useMockDb.setState((s) => ({
      verifications: s.verifications.map((v) => (v.caseId === caseId ? (updated = fn(v)) : v)),
    }))
    if (!updated) throw new Error(`Verification ${caseId} not found`)
    return updated
  },

  /** Append-only. IDs are assigned here (DEC-97: evt_…). */
  appendAudit(...entries: AuditEntry[]): void {
    if (entries.length === 0) return
    useMockDb.setState((s) => ({ audit: [...s.audit, ...entries.map((e) => ({ ...e, id: newId('evt') }))] }))
  },

  setState: useMockDb.setState,

  reset(): void {
    useMockDb.setState(seedDatabase(now()), true)
  },
}

// In-memory mock database, persisted to localStorage so demo state survives refresh and is shared across tabs.
// Only src/services may import this file.
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { AuditEntry, Verification } from '@/domain/types'
import { now } from '@/lib/clock'
import { DB_VERSION, seedDatabase, type MockDbState } from './seed'

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

  findVerification(ref: string): Verification | undefined {
    return useMockDb.getState().verifications.find((v) => v.referenceNo === ref)
  },

  updateVerification(ref: string, fn: (v: Verification) => Verification): Verification {
    let updated: Verification | undefined
    useMockDb.setState((s) => ({
      verifications: s.verifications.map((v) => (v.referenceNo === ref ? (updated = fn(v)) : v)),
    }))
    if (!updated) throw new Error(`Verification ${ref} not found`)
    return updated
  },

  /** Append-only. Ids are assigned here. */
  appendAudit(...entries: AuditEntry[]): void {
    if (entries.length === 0) return
    useMockDb.setState((s) => {
      let seq = s.auditSeq
      const added = entries.map((e) => ({ ...e, id: `AUD-${String(++seq).padStart(6, '0')}` }))
      return { audit: [...s.audit, ...added], auditSeq: seq }
    })
  },

  setState: useMockDb.setState,

  reset(): void {
    useMockDb.setState(seedDatabase(now()), true)
  },
}

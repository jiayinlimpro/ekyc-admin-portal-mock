// Change notifications, so an open record refreshes when another tab (another "user") claims or decides it.
// Mock: subscribes to the mock DB (which also reacts to other tabs via the storage event).
// Real API: polling or server push; pages keep the same onVerificationsChanged() call.
import { useMockDb } from '@/mocks/mockDb'

export function onVerificationsChanged(cb: () => void): () => void {
  return useMockDb.subscribe((s, prev) => {
    if (s.verifications !== prev.verifications) cb()
  })
}

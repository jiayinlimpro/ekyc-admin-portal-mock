// Dev-only toggles for demos: simulated latency/errors and a "time warp" offset (MOCK-04).
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export interface DevFlags {
  simulateLatency: boolean
  latencyMs: [number, number]
  simulateErrors: boolean
  errorRate: number // 0–1
  timeOffsetMs: number // added to the real clock
}

export const DEFAULT_DEV_FLAGS: DevFlags = {
  simulateLatency: import.meta.env.MODE !== 'test',
  latencyMs: [300, 800],
  simulateErrors: false,
  errorRate: 0.1,
  timeOffsetMs: 0,
}

interface DevFlagsStore extends DevFlags {
  setFlags: (patch: Partial<DevFlags>) => void
  advanceTime: (ms: number) => void
  resetTime: () => void
}

export const useDevFlags = create<DevFlagsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_DEV_FLAGS,
      setFlags: (patch) => set(patch),
      advanceTime: (ms) => set((s) => ({ timeOffsetMs: s.timeOffsetMs + ms })),
      resetTime: () => set({ timeOffsetMs: 0 }),
    }),
    { name: 'ekyc-mock-devflags', storage: createJSONStorage(() => localStorage) },
  ),
)

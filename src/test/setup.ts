// Screens are lazy-loaded; the first import in a test file is compiled on demand and can exceed the 1 s default.
import { configure } from '@testing-library/react'
import { vi } from 'vitest'

configure({ asyncUtilTimeout: 10_000 }) // a full parallel run compiles several screens at once

// A screen test can wait up to 10 s for its first element (above) and then run several steps; under a full parallel run
// the first test in a file also pays for compiling the screen, so the 5 s default per test is too tight.
vi.setConfig({ testTimeout: 30_000 }) // multi-step screen tests under a full parallel run

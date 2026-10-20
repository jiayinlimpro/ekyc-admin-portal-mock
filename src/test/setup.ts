// Screens are lazy-loaded; the first import in a test file is compiled on demand and can exceed the 1 s default.
import { configure } from '@testing-library/react'
import { vi } from 'vitest'

configure({ asyncUtilTimeout: 5000 })

// A screen test can wait up to 5 s for its first element (above) and then run several steps; under a full parallel run
// the first test in a file also pays for compiling the screen, so 5 s per test is too tight.
vi.setConfig({ testTimeout: 15_000 })

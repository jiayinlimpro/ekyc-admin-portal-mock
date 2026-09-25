// Screens are lazy-loaded; the first import in a test file is compiled on demand and can exceed the 1 s default.
import { configure } from '@testing-library/react'

configure({ asyncUtilTimeout: 5000 })

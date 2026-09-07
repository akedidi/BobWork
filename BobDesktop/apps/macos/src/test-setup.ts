// ============================================================
// Bob Work – Vitest test setup
// ============================================================
import '@testing-library/jest-dom'
import { setTestLocale } from './i18n'

// Keep existing French assertions stable; locale resolution is unit-tested separately.
setTestLocale('fr')

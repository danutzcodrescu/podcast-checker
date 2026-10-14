// oxlint-disable-next-line import/no-unassigned-import -- Registers Vitest's DOM matchers and their types.
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

import { overwriteGetLocale } from '#/paraglide/runtime'

// JSDOM has no layout observer; Base UI uses it for popup positioning.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  },
)

beforeEach(() => overwriteGetLocale(() => 'en'))
afterEach(cleanup)

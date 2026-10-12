// oxlint-disable-next-line import/no-unassigned-import -- Registers Vitest's DOM matchers and their types.
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'

import { overwriteGetLocale } from '#/paraglide/runtime'

beforeEach(() => overwriteGetLocale(() => 'en'))
afterEach(cleanup)

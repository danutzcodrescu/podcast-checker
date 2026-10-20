import { createFileRoute, notFound } from '@tanstack/react-router'

import { AuthPage } from '#/components/AuthPage'
import { getSignupEnabled } from '#/lib/feature-flags'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/signup')({
  beforeLoad: async () => {
    if (!(await getSignupEnabled())) {
      throw notFound()
    }
  },
  head: () => ({ meta: [{ title: m.auth_sign_up_title() }] }),
  component: SignUp,
})

function SignUp() {
  return <AuthPage mode="sign-up" />
}

import { createFileRoute } from '@tanstack/react-router'

import { AuthPage } from '#/components/AuthPage'
import { getSignupEnabled } from '#/lib/feature-flags'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/signin')({
  beforeLoad: async () => ({ signupEnabled: await getSignupEnabled() }),
  head: () => ({ meta: [{ title: m.auth_sign_in_title() }] }),
  component: SignIn,
})

function SignIn() {
  const { signupEnabled } = Route.useRouteContext()
  return <AuthPage mode="sign-in" signupEnabled={signupEnabled} />
}

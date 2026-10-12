import { createFileRoute } from '@tanstack/react-router'

import { AuthPage } from '#/components/AuthPage'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/signin')({
  head: () => ({ meta: [{ title: m.auth_sign_in_title() }] }),
  component: SignIn,
})

function SignIn() {
  return <AuthPage mode="sign-in" />
}

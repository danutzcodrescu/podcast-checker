import { createFileRoute } from '@tanstack/react-router'

import { AuthPage } from '#/components/auth-page'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/signup')({
  head: () => ({ meta: [{ title: m.auth_sign_up_title() }] }),
  component: SignUp,
})

function SignUp() {
  return <AuthPage mode="sign-up" />
}

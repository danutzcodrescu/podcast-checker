import { createMiddleware, createStart } from '@tanstack/react-start'

const functionLogging = createMiddleware({ type: 'function' }).server(
  async ({ next, serverFnMeta }) => {
    const { withServerFunctionLogging } = await import('./lib/server-function-logging')
    return withServerFunctionLogging(serverFnMeta, next)
  },
)

export const startInstance = createStart(() => ({ functionMiddleware: [functionLogging] }))

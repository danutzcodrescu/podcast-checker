import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start'

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
})

const functionLogging = createMiddleware({ type: 'function' }).server(
  async ({ next, serverFnMeta }) => {
    const { withServerFunctionLogging } = await import('./lib/server-function-logging')
    return withServerFunctionLogging(serverFnMeta, next)
  },
)

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware],
  functionMiddleware: [functionLogging],
}))

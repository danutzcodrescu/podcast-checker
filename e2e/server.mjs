import { preview } from 'vite'

// Let the OS allocate a port; never share an app server between workers.
const server = await preview({ preview: { host: '127.0.0.1', port: 0, strictPort: true } })
const address = server.httpServer.address()
if (!address || typeof address === 'string') throw new Error('Expected a TCP preview server')
const url = `http://127.0.0.1:${address.port}`

// SSR modules load on the first request, after the final origin is known.
process.env.BETTER_AUTH_URL = url
console.log(`E2E_SERVER_URL=${url}`)

process.on('SIGTERM', () => {
  server.httpServer.close(() => process.exit(0))
  server.httpServer.closeIdleConnections()
})

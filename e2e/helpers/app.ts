import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'

export async function startApp(databaseUrl: string) {
  const child = spawn(process.execPath, ['e2e/server.mjs'], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      DIRECT_DATABASE_URL: databaseUrl,
      BETTER_AUTH_URL: '',
      BETTER_AUTH_SECRET: 'playwright-test-secret-for-local-tests-only-123456789',
      LOG_LEVEL: 'silent',
      // Do not pick up real provider credentials from the environment or .env files.
      OPENROUTER_API_KEY: '',
      CLOUDFLARE_ACCOUNT_ID: '',
      CLOUDFLARE_API_TOKEN: '',
      EPISODE_RERANKING_ENABLED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  async function stop() {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
    const exited = once(child, 'exit')
    child.kill('SIGTERM')
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5_000)
    timeout.unref()
    try {
      await exited
    } finally {
      clearTimeout(timeout)
    }
  }

  let logs = ''
  const collect = (chunk: Buffer) => {
    logs = (logs + chunk.toString()).slice(-8_000)
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)

  try {
    const url = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Preview startup timed out')), 60_000)
      const onData = () => {
        const match = /E2E_SERVER_URL=(http:\/\/127\.0\.0\.1:\d+)/.exec(logs)
        if (match) {
          clearTimeout(timeout)
          resolve(match[1])
        }
      }
      child.stdout.on('data', onData)
      child.once('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      child.once('exit', (code, signal) => {
        clearTimeout(timeout)
        reject(new Error(`Preview exited: ${code ?? signal}`))
      })
    })
    const response = await fetch(`${url}/signin`, { signal: AbortSignal.timeout(30_000) })
    if (response.status !== 200) throw new Error(`Sign-in health check returned ${response.status}`)
    await response.body?.cancel()
    return { url, stop }
  } catch (error) {
    await stop()
    throw new Error(`Unable to start isolated E2E app.\n${logs}`, { cause: error })
  }
}

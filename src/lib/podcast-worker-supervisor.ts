import { Worker } from 'node:worker_threads'
import { getLogger } from './logger'

type WorkerOptions = {
  entry: string
  development?: boolean
  restartDelayMs?: number
  readyTimeoutMs?: number
  shutdownTimeoutMs?: number
}

/** Own exactly one worker thread and await its exit when the server closes. */
export function startPodcastWorker({
  entry,
  development = false,
  restartDelayMs = 1000,
  readyTimeoutMs = 60_000,
  shutdownTimeoutMs = 75_000,
}: WorkerOptions) {
  let worker: Worker | undefined
  let closing: Promise<void> | undefined
  let stopping = false
  let failures = 0
  let restartTimer: ReturnType<typeof setTimeout> | undefined
  let readyTimer: ReturnType<typeof setTimeout> | undefined
  let stableTimer: ReturnType<typeof setTimeout> | undefined

  function spawn() {
    if (stopping) return
    // tsx's programmatic loader works in a raw Node thread during Vite dev.
    // Production starts the compiled Nitro entry directly, without a TS loader.
    worker = development
      ? new Worker(
          `import('tsx/esm/api').then(({ tsImport }) => tsImport(${JSON.stringify(entry)}, ${JSON.stringify(import.meta.url)}))`,
          { eval: true, execArgv: [] },
        )
      : new Worker(entry, { execArgv: [] })
    const current = worker
    readyTimer = setTimeout(() => {
      getLogger().error(
        { event: 'worker.startup_timeout', readyTimeoutMs },
        'Podcast worker did not become ready; restarting it',
      )
      void current.terminate()
    }, readyTimeoutMs)
    current.on('message', (message) => {
      if (message !== 'ready' || stopping) return
      clearTimeout(readyTimer)
      // Do not reset backoff for workers that repeatedly crash soon after startup.
      stableTimer = setTimeout(() => {
        failures = 0
      }, 60_000)
    })
    current.on('error', (err) =>
      getLogger().error({ event: 'worker.failed', err }, 'Podcast worker thread failed'),
    )
    current.once('exit', (code) => {
      clearTimeout(readyTimer)
      clearTimeout(stableTimer)
      worker = undefined
      if (stopping) return
      const delay = Math.min(restartDelayMs * 2 ** Math.min(failures++, 6), 60_000)
      getLogger().error(
        { event: 'worker.restarting', exitCode: code, restartDelayMs: delay },
        'Podcast worker exited; restarting',
      )
      restartTimer = setTimeout(spawn, delay)
    })
  }

  spawn()
  return {
    close() {
      if (closing) return closing
      stopping = true
      clearTimeout(restartTimer)
      clearTimeout(readyTimer)
      clearTimeout(stableTimer)
      const current = worker
      closing = current
        ? new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
              getLogger().warn(
                { event: 'worker.shutdown_timeout', shutdownTimeoutMs },
                'Podcast worker shutdown timed out; terminating thread',
              )
              void current.terminate()
            }, shutdownTimeoutMs)
            current.once('exit', () => {
              clearTimeout(timeout)
              resolve()
            })
            // eslint-disable-next-line unicorn/require-post-message-target-origin -- Node Worker API, not window.postMessage.
            current.postMessage('shutdown')
          })
        : Promise.resolve()
      return closing
    },
  }
}

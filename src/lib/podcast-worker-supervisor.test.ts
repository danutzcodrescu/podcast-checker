// @vitest-environment node
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startPodcastWorker } from './podcast-worker-supervisor'
import { logger } from './logger'

const mocks = vi.hoisted(() => ({ workers: [] as any[] }))
vi.mock('node:worker_threads', () => ({
  Worker: class extends EventEmitter {
    postMessage = vi.fn()
    terminate = vi.fn(async () => {
      this.emit('exit', 1)
      return 1
    })
    constructor(
      public entry: string,
      public options: unknown,
    ) {
      super()
      mocks.workers.push(this)
    }
  },
}))

beforeEach(() => {
  vi.useFakeTimers()
  mocks.workers.length = 0
  vi.spyOn(logger, 'error').mockImplementation(() => {})
  vi.spyOn(logger, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('app-managed podcast worker', () => {
  it('restarts crashed workers with backoff instead of restarting the web server', async () => {
    const supervisor = startPodcastWorker({ entry: '/app/worker.mjs' })
    mocks.workers[0].emit('message', 'ready')
    mocks.workers[0].emit('error', new Error('worker crashed'))
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'worker.failed', err: expect.any(Error) }),
      'Podcast worker thread failed',
    )
    mocks.workers[0].emit('exit', 1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.workers).toHaveLength(2)
    mocks.workers[1].emit('message', 'ready')
    mocks.workers[1].emit('exit', 1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.workers).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.workers).toHaveLength(3)
    const close = supervisor.close()
    mocks.workers[2].emit('exit', 0)
    await close
  })

  it('waits for graceful shutdown and never respawns a deliberately stopped worker', async () => {
    const supervisor = startPodcastWorker({ entry: '/app/worker.mjs' })
    const worker = mocks.workers[0]
    const close = supervisor.close()
    expect(worker.postMessage).toHaveBeenCalledWith('shutdown')
    expect(supervisor.close()).toBe(close)
    // Initialization may finish after the parent has requested shutdown.
    worker.emit('message', 'ready')
    worker.emit('exit', 0)
    await close
    await vi.advanceTimersByTimeAsync(120_000)
    expect(mocks.workers).toHaveLength(1)
    expect(worker.terminate).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels scheduled restarts when the server closes', async () => {
    const supervisor = startPodcastWorker({ entry: '/app/worker.mjs' })
    mocks.workers[0].emit('exit', 1)
    await supervisor.close()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(mocks.workers).toHaveLength(1)
  })

  it('terminates a stuck startup and bounds shutdown time', async () => {
    const supervisor = startPodcastWorker({
      entry: '/app/worker.mjs',
      readyTimeoutMs: 100,
      shutdownTimeoutMs: 200,
    })
    await vi.advanceTimersByTimeAsync(100)
    expect(mocks.workers[0].terminate).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.workers).toHaveLength(2)
    const close = supervisor.close()
    await vi.advanceTimersByTimeAsync(200)
    await close
    expect(mocks.workers[1].terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})

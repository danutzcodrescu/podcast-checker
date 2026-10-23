/** Stop waiting promptly; the operation must also pass the signal to its underlying I/O. */
export async function runWithAbort<T>(
  signal: AbortSignal | undefined,
  operation: () => PromiseLike<T>,
): Promise<T> {
  signal?.throwIfAborted()
  if (!signal) return operation()
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      cleanup()
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    // Subscribe synchronously: cancellation must not leave an already-started
    // shared operation's rejection unobserved in a later microtask.
    try {
      Promise.resolve(operation()).then(
        (result) => {
          cleanup()
          resolve(result)
        },
        (error: unknown) => {
          cleanup()
          reject(error)
        },
      )
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}

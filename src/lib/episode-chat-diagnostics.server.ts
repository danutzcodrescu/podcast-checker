import { getLogger } from '#/lib/logger'
import { ZodError } from 'zod'
import { StandardSchemaValidationError } from '@tanstack/ai'

type ChatStage =
  | 'request'
  | 'authentication'
  | 'input'
  | 'configuration'
  | 'library'
  | 'provider'
  | 'search'
type FailureReason =
  | 'missing_openrouter_api_key'
  | 'request_failed'
  | 'provider_error'
  | 'tool_failed'
  | 'invalid_tool_result'
  | 'stream_error'
  | 'deadline_exceeded'

const knownCodes = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
  'CONTEXT_OVERFLOW',
  'TOOL_ARGUMENTS_INVALID',
  'TOOL_NOT_FOUND',
  'context_overflow',
  'max_tokens',
  'empty-response',
  'parse-error',
  'server',
])
const validationFields = new Set([
  'action',
  'clarification',
  'unsupportedConstraints',
  'filters',
  'term',
  'days',
  'sort',
  'searchMode',
  'podcastId',
  'categoryId',
])

/** Error messages, stacks, SDK metadata and causes can all contain private input.
 * Only retain machine codes, numeric statuses and a small set of error types. */
function errorDetails(
  error: unknown,
  depth = 0,
): {
  errorCode?: string
  errorType?: string
  errorStatus?: number
  errorLocations?: string[]
  validationIssues?: { code: string; path: string }[]
} {
  if (!error || typeof error !== 'object' || depth > 3) return {}
  const nested = 'cause' in error ? errorDetails(error.cause, depth + 1) : {}
  const code = 'code' in error ? error.code : undefined
  const numericStatus =
    'statusCode' in error ? error.statusCode : 'status' in error ? error.status : undefined
  const status =
    typeof numericStatus === 'number' &&
    Number.isInteger(numericStatus) &&
    numericStatus >= 100 &&
    numericStatus <= 599
      ? numericStatus
      : undefined
  const safeCode =
    typeof code === 'string' &&
    (knownCodes.has(code) ||
      /^(?:[0-9]{2}|0A|2F|F0|HV|P0|XX)[0-9A-Z]{3}$/.test(code) ||
      /^[45]\d\d$/.test(code))
      ? code
      : undefined
  const name = error instanceof Error ? error.name : undefined
  const errorType =
    name &&
    [
      'Error',
      'TypeError',
      'ZodError',
      'StandardSchemaValidationError',
      'AbortError',
      'TimeoutError',
    ].includes(name)
      ? name
      : undefined
  // Retain application file locations, not function names, messages, URLs, or full stacks.
  const locations =
    error instanceof Error
      ? error.stack
          ?.split('\n')
          .flatMap((line) => {
            if (!/^\s+at /.test(line)) return []
            const match = line.match(
              /(?:\(|\s)((?:file:\/\/)?\/[^()\s?#]*(?:\/src\/|\/dist\/|\/\.netlify\/)[^()\s?#]+:\d+:\d+)\)?$/,
            )
            return match ? [match[1]] : []
          })
          .slice(0, 5)
      : undefined
  const validationIssues =
    error instanceof ZodError || error instanceof StandardSchemaValidationError
      ? error.issues.slice(0, 8).map((issue) => ({
          code: 'invalid_input',
          path: (issue.path ?? [])
            .map((segment) => {
              const part = typeof segment === 'object' ? segment.key : segment
              return typeof part === 'string' && validationFields.has(part) ? part : '*'
            })
            .join('.'),
        }))
      : undefined
  return {
    ...nested,
    ...(safeCode ? { errorCode: safeCode } : {}),
    ...(errorType ? { errorType } : {}),
    ...(status ? { errorStatus: status } : {}),
    ...(locations?.length ? { errorLocations: locations } : {}),
    ...(validationIssues ? { validationIssues } : {}),
  }
}

export function createEpisodeChatDiagnostics(model: string) {
  // Capture the request-scoped logger now: stream pulls can outlive HTTP setup's
  // AsyncLocalStorage context, but must keep the same requestId/correlationId.
  const log = getLogger().child({ component: 'episode-chat', model })
  const started = performance.now()
  let stage: ChatStage = 'request'
  let terminal = false
  let providerStatus: number | undefined
  let resultKind: 'results' | 'clarification' | undefined
  const fields = () => ({
    stage,
    providerStatus,
    durationMs: Math.round(performance.now() - started),
  })
  log.info({ event: 'chat.started' }, 'Episode chat started')

  function fail(reason: FailureReason, error?: unknown) {
    if (terminal) return
    terminal = true
    log.error(
      { event: 'chat.failed', reason, ...fields(), ...errorDetails(error) },
      'Episode chat failed',
    )
  }

  return {
    stage(next: ChatStage) {
      stage = next
      if (!terminal) log.info({ event: 'chat.stage', ...fields() }, 'Episode chat stage started')
    },
    // Inspect only HTTP status; do not read/clone bodies or record request options.
    wrapFetch(baseFetch: typeof fetch): typeof fetch {
      return async (...args: Parameters<typeof fetch>) => {
        try {
          const response = await baseFetch(...args)
          providerStatus = response.status
          log.info({ event: 'chat.provider_response', ...fields() }, 'Chat provider responded')
          return response
        } catch (error) {
          // Capture safe transport codes before the SDK converts them into a RUN_ERROR.
          fail('provider_error', error)
          throw error
        }
      }
    },
    result(kind: 'results' | 'clarification') {
      resultKind = kind
    },
    fail,
    reject(status: number, reason: string) {
      if (terminal) return
      terminal = true
      log[status >= 500 ? 'error' : 'warn'](
        { event: 'chat.rejected', status, reason, ...fields() },
        'Episode chat rejected',
      )
    },
    cancel() {
      if (terminal) return
      terminal = true
      log.info({ event: 'chat.cancelled', ...fields() }, 'Episode chat delivery disconnected')
    },
    complete() {
      if (terminal) return
      terminal = true
      log[resultKind ? 'info' : 'warn'](
        { event: 'chat.completed', resultKind: resultKind ?? 'no_result', ...fields() },
        'Episode chat completed',
      )
    },
  }
}

export type EpisodeChatDiagnostics = ReturnType<typeof createEpisodeChatDiagnostics>

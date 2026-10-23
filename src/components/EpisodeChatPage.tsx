import { fetchServerSentEvents, useChat } from '@tanstack/ai-react'
import type { UIMessage } from '@tanstack/ai-react'
import { Link } from '@tanstack/react-router'
import {
  ArrowUpRight,
  ChevronRight,
  List,
  LoaderCircle,
  Search,
  SendHorizontal,
  SlidersHorizontal,
  Sparkles,
  Square,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { EpisodeCard } from '#/components/EpisodeCard'
import { PocketCastsConnection } from '#/components/PocketCastsConnection'
import { PodcastPageShell } from '#/components/PodcastPageShell'
import { Button } from '#/components/ui/Button'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/Popover'
import { usePodcastLibrary } from '#/hooks/use-podcast-library'
import { usePocketCasts } from '#/hooks/use-pocket-casts'
import {
  episodeChatPromptLimit,
  episodeChatSearchParams,
  episodeChatToolName,
  episodeChatTimeoutCode,
  readEpisodeChatResult,
} from '#/lib/episode-chat'
import type { EpisodeChatResults } from '#/lib/episode-chat'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'

function messageResult(message: UIMessage) {
  for (const part of message.parts) {
    if (part.type !== 'tool-call' || part.name !== episodeChatToolName) continue
    const result = readEpisodeChatResult(part.output)
    if (result && result.kind !== 'ignored') return result
  }
  return null
}

function ResultSummary({ result }: { result: EpisodeChatResults }) {
  return (
    <>
      <p>
        {result.episodes.length
          ? m.chat_results({ count: result.episodes.length, total: result.total })
          : m.chat_no_results()}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {result.filters.term && <>“{result.filters.term}” · </>}
        {result.filters.days === null
          ? m.episodes_all_time()
          : m.episodes_last_days({ count: result.filters.days })}
        {' · '}
        {result.filters.sort === 'relevance'
          ? m.episodes_relevance()
          : result.filters.sort === 'oldest'
            ? m.episodes_oldest()
            : m.episodes_newest()}
      </p>
      {result.semanticUnavailable && (
        <p className="mt-2 text-xs text-muted-foreground">{m.episodes_semantic_unavailable()}</p>
      )}
      {result.ranking === 'fallback' && (
        <p className="mt-2 text-xs text-muted-foreground">{m.episodes_ranking_fallback()}</p>
      )}
    </>
  )
}

export function EpisodeChatPage({ email }: { email: string }) {
  const library = usePodcastLibrary(email)
  const pocketCasts = usePocketCasts(email)
  const [input, setInput] = useState('')
  const [headerInput, setHeaderInput] = useState('')
  const [responseStatus, setResponseStatus] = useState<number | null>(null)
  const [stopped, setStopped] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const [now] = useState(() => Date.now())
  const bottom = useRef<HTMLDivElement>(null)
  const { messages, sendMessage, isLoading, error, stop, reload } = useChat({
    connection: fetchServerSentEvents('/api/chat', () => ({
      credentials: 'same-origin',
      body: { locale: getLocale() },
      fetchClient: async (...args: Parameters<typeof fetch>) => {
        const response = await fetch(...args)
        setResponseStatus(response.status)
        return response
      },
    })),
    queue: 'drop',
    onChunk: (chunk) => {
      if (chunk.type === 'RUN_ERROR' && chunk.code === episodeChatTimeoutCode) setTimedOut(true)
    },
  })
  const emptyLibrary = !library.isPending && !library.isError && library.podcasts.length === 0
  const disabled = library.disabled || emptyLibrary
  const latestUserIndex = messages.reduce(
    (last, message, index) => (message.role === 'user' ? index : last),
    -1,
  )
  const hasLatestResult = messages
    .slice(latestUserIndex + 1)
    .some((message) => messageResult(message))

  useEffect(() => {
    if (messages.length)
      bottom.current?.scrollIntoView?.({
        block: 'nearest',
        behavior: isLoading ? 'instant' : 'auto',
      })
  }, [messages.length, isLoading])

  function submit(text: string) {
    if (isLoading || disabled || !text.trim() || text.length > episodeChatPromptLimit) return
    setResponseStatus(null)
    setStopped(false)
    setTimedOut(false)
    void sendMessage(text.trim())
    setInput('')
    setHeaderInput('')
  }

  return (
    <PodcastPageShell
      email={email}
      activeTab="chat"
      headerSearch={
        <form
          className="relative ml-auto w-80 laptop:w-56 tablet:hidden"
          onSubmit={(event) => {
            event.preventDefault()
            submit(headerInput)
          }}
        >
          <Search
            className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            className="h-10 w-full rounded-lg border border-border bg-surface/60 pr-3 pl-10 text-xs placeholder:text-muted-foreground focus:outline-2 focus:outline-ring"
            aria-label={m.chat_header_search()}
            placeholder={m.chat_header_search()}
            value={headerInput}
            maxLength={episodeChatPromptLimit}
            disabled={disabled || isLoading}
            onChange={(event) => setHeaderInput(event.target.value)}
          />
        </form>
      }
    >
      <section
        aria-label={m.chat_tab()}
        className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col"
      >
        <h1 className="sr-only">{m.chat_heading()}</h1>
        {messages.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-20 text-center mobile:px-0">
            <div className="grid size-16 place-items-center rounded-2xl bg-accent text-primary">
              <Sparkles className="size-8" aria-hidden="true" />
            </div>
            <p className="text-xs font-semibold tracking-eyebrow text-primary uppercase">
              {m.chat_eyebrow()}
            </p>
            <h2 className="max-w-xl text-page-title leading-tight font-bold tracking-tight text-heading">
              {m.chat_welcome()}
            </h2>
            <p className="max-w-lg leading-relaxed text-muted-foreground">{m.chat_description()}</p>
            {library.isPending && (
              <output className="text-muted-foreground">{m.library_loading()}</output>
            )}
            {library.isError && (
              <div role="alert">
                <p className="text-destructive">{m.library_load_error()}</p>
                <Button variant="ghost" size="sm" onClick={() => void library.refetch()}>
                  {m.search_retry()}
                </Button>
              </div>
            )}
            {emptyLibrary && (
              <div className="mt-2 rounded-xl border border-border bg-surface p-5">
                <p className="mb-3 text-muted-foreground">{m.library_follow_hint()}</p>
                <Link
                  to="/discover"
                  className="inline-flex items-center gap-2 font-semibold text-primary"
                >
                  {m.search_discover_tab()}
                  <ArrowUpRight className="size-4" aria-hidden="true" />
                </Link>
              </div>
            )}
          </div>
        )}

        <div
          role="log"
          aria-label={m.chat_conversation()}
          aria-live="polite"
          aria-relevant="additions"
          className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain pt-4 pr-1 pb-5"
        >
          {messages.map((message) => {
            if (message.role === 'user')
              return (
                <div
                  key={message.id}
                  className="ml-auto flex max-w-[70%] items-start gap-3 mobile:max-w-[95%]"
                >
                  <p className="rounded-2xl rounded-tr-md bg-accent px-5 py-3 leading-relaxed wrap-anywhere whitespace-pre-wrap">
                    {message.parts
                      .filter((part) => part.type === 'text')
                      .map((part) => part.content)
                      .join('')}
                  </p>
                </div>
              )
            const result = messageResult(message)
            if (!result) return null
            return (
              <div key={message.id} className="flex items-start gap-3 mobile:gap-2">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="w-fit max-w-full rounded-2xl rounded-tl-md border border-card-border bg-surface-muted/50 px-4 py-3 leading-relaxed">
                    {result.kind === 'clarification' ? (
                      <p className="whitespace-pre-wrap">{result.message}</p>
                    ) : (
                      <ResultSummary result={result} />
                    )}
                  </div>
                  {result.kind === 'results' && (
                    <>
                      {result.episodes.length > 0 && (
                        <ul
                          className="grid list-none gap-2 p-0"
                          aria-label={m.episodes_search_results()}
                        >
                          {result.episodes.map((episode) => (
                            <EpisodeCard
                              key={episode.id}
                              episode={episode}
                              compact
                              now={now}
                              pocketCasts={pocketCasts}
                              categories={episode.categories.flatMap((id) => {
                                const name = library.getCategoryName(id)
                                return name ? [name] : []
                              })}
                            />
                          ))}
                        </ul>
                      )}
                      <Link
                        to="/latest-episodes"
                        search={episodeChatSearchParams(result.filters)}
                        className="group flex items-center gap-3 rounded-xl border border-primary/25 bg-accent/50 p-3 text-primary no-underline transition-colors hover:bg-accent"
                      >
                        <List className="mx-1 size-6 shrink-0" aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold">{m.chat_see_more()}</span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {m.chat_see_more_hint()}
                          </span>
                        </span>
                        <ChevronRight
                          className="size-5 shrink-0 transition-transform group-hover:translate-x-1"
                          aria-hidden="true"
                        />
                      </Link>
                    </>
                  )}
                </div>
              </div>
            )
          })}
          {isLoading && (
            <output className="flex items-center gap-3 px-1 text-muted-foreground">
              <LoaderCircle className="size-5 animate-spin text-primary" aria-hidden="true" />
              {m.chat_searching()}
            </output>
          )}
          {!isLoading && !error && messages.length > 0 && !hasLatestResult && (
            <output className="rounded-xl border border-border bg-surface p-4">
              {stopped ? m.chat_stopped() : m.chat_interpretation_error()}
            </output>
          )}
          {error && (
            <div role="alert" className="rounded-xl border border-border bg-surface p-4">
              <p className="text-destructive">
                {timedOut || responseStatus === 504
                  ? m.chat_timeout()
                  : responseStatus === 400
                    ? m.chat_context_full()
                    : m.chat_error()}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setResponseStatus(null)
                    setStopped(false)
                    setTimedOut(false)
                    void reload()
                  }}
                >
                  {m.search_retry()}
                </Button>
                <Link
                  to={responseStatus === 401 ? '/signin' : '/latest-episodes'}
                  className="text-primary underline"
                >
                  {responseStatus === 401 ? m.auth_sign_in() : m.episodes_heading()}
                </Link>
              </div>
            </div>
          )}
          <div ref={bottom} />
        </div>

        <div className="z-10 mt-auto shrink-0 bg-background/90 pt-2 pb-3 backdrop-blur-md">
          <div className="rounded-2xl border border-card-border bg-surface p-2 shadow-elevated">
            <form
              className="flex items-stretch gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                submit(input)
              }}
            >
              <div className="flex min-w-0 flex-1 items-center rounded-xl border border-input bg-white focus-within:outline-2 focus-within:outline-ring">
                <textarea
                  rows={1}
                  className="max-h-32 min-h-11 w-full resize-y border-0 bg-transparent px-3 py-3 text-sm placeholder:text-muted-foreground focus:outline-none mobile:min-h-16"
                  aria-label={m.chat_input_label()}
                  placeholder={m.chat_placeholder()}
                  maxLength={episodeChatPromptLimit}
                  value={input}
                  disabled={disabled}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault()
                      submit(input)
                    }
                  }}
                />
                <Popover>
                  <PopoverTrigger
                    render={<Button type="button" variant="ghost" size="icon" className="m-0.5" />}
                    aria-label={m.chat_settings()}
                    title={m.chat_settings()}
                  >
                    <SlidersHorizontal className="size-5 text-primary" aria-hidden="true" />
                  </PopoverTrigger>
                  <PopoverContent side="top" align="end" className="w-96">
                    <h2 className="font-semibold">{m.chat_settings()}</h2>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {m.chat_supported_filters()}
                    </p>
                    <p className="mt-2 mb-4 text-xs text-muted-foreground">{m.chat_privacy()}</p>
                    <PocketCastsConnection integration={pocketCasts} />
                  </PopoverContent>
                </Popover>
              </div>
              {isLoading ? (
                <Button
                  type="button"
                  size="icon"
                  aria-label={m.chat_stop()}
                  className="h-auto min-h-11"
                  onClick={() => {
                    setStopped(true)
                    stop()
                  }}
                >
                  <Square className="size-4 fill-current" aria-hidden="true" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon"
                  aria-label={m.chat_send()}
                  className="h-auto min-h-11"
                  disabled={disabled || !input.trim()}
                >
                  <SendHorizontal className="size-5" aria-hidden="true" />
                </Button>
              )}
            </form>
          </div>
        </div>
      </section>
    </PodcastPageShell>
  )
}

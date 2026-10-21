Welcome to your new TanStack Start app!

# Getting Started

Install dependencies, configure `.env.local` using the reference below, then start
local PostgreSQL and the application:

```bash
pnpm install
pnpm db:setup
pnpm dev
```

`pnpm db:setup` requires Docker and applies migrations. If you already have a
PostgreSQL/pgvector database, use `pnpm db:migrate` instead.

## Environment variables

Keep local settings in `.env.local` at the workspace root. Database, migration,
and ingestion entry points load `.env.local` before `.env`; existing process/shell
variables take precedence over both. Docker Compose has its own rules, described
below. Never commit real credentials or expose server secrets with a `VITE_`
prefix. Each worktree needs its own local settings; Git does not copy ignored
environment files.

### Local configuration example

Create `.env.local` without overwriting an existing file. This example uses the
development Compose database defaults. Generate a secret with
`openssl rand -hex 32` and replace the auth-secret placeholder before running:

```dotenv
# Core application
DATABASE_URL=postgresql://podcast_checker:podcast_checker@127.0.0.1:5432/podcast_checker
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=replace-with-a-generated-secret-of-at-least-32-characters
INGESTION_SECRET=replace-with-a-separate-generated-secret-of-at-least-32-characters

# Optional: uncomment both for episode embeddings and semantic search
# CLOUDFLARE_ACCOUNT_ID=your-32-character-hex-account-id
# CLOUDFLARE_API_TOKEN=your-workers-ai-api-token

# Optional: enables automatic podcast categories and episode reranking
# OPENROUTER_API_KEY=your-openrouter-api-key
EPISODE_RERANKING_ENABLED=true

# Optional model overrides; omit them to use this branch's defaults
# PODCAST_CLASSIFICATION_MODEL=~typesafe/jev-latest
# EPISODE_RERANKING_MODEL=nvidia/llama-nemotron-rerank-vl-1b-v2:free

# Optional runtime settings
LOG_LEVEL=info
# DATABASE_POOL_MAX=2
```

AI credentials are optional for the basic app: Apple podcast discovery, following,
RSS imports, and title/description search do not require them. Without Cloudflare
credentials, embeddings remain pending and hybrid search falls back to text;
semantic-only search is unavailable. Without an OpenRouter key, automatic category
assignment and AI reranking are skipped. The two providers are independent: a text
search can still be reranked without Cloudflare, and semantic search can run without
OpenRouter.

### Database, authentication, and integrations

| Variable                       | Required for / default                                         | Notes                                                                                                                                                                                                           |
| ------------------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                 | Application, workers, and database-backed features; no default | PostgreSQL connection string. Use the host/port published by Docker locally and the pooled Neon URL for deployed functions. Setting only `DIRECT_DATABASE_URL` does not configure the app's runtime connection. |
| `DIRECT_DATABASE_URL`          | Optional; migrations fall back to `DATABASE_URL`               | Preferred connection for `pnpm db:migrate` and Drizzle administration. Use a direct, non-pooled Neon URL and preserve its TLS parameters.                                                                       |
| `DATABASE_POOL_MAX`            | Optional; `2`                                                  | Per-process pool size, integer from `1` to `20`.                                                                                                                                                                |
| `BETTER_AUTH_URL`              | Authentication; set explicitly for each environment            | Canonical origin, such as `http://localhost:3000` locally or your public HTTPS domain in production. Match the actual host and port.                                                                            |
| `BETTER_AUTH_SECRET`           | Required in production and for Pocket Casts token encryption   | Stable random secret of at least 32 characters. Keep it across restarts and deployments; changing it requires reconnecting Pocket Casts.                                                                        |
| `CLOUDFLARE_ACCOUNT_ID`        | Embeddings and semantic search                                 | Exactly 32 hexadecimal characters. Use together with `CLOUDFLARE_API_TOKEN`.                                                                                                                                    |
| `CLOUDFLARE_API_TOKEN`         | Embeddings and semantic search                                 | Workers AI Read and Edit access to the configured account. Used by background ingestion and query embedding.                                                                                                    |
| `OPENROUTER_API_KEY`           | Automatic podcast categories and episode reranking             | Shared server-side key for both features. Setting it can enable paid Jev category classification even when the episode reranker is free.                                                                        |
| `PODCAST_CLASSIFICATION_MODEL` | Optional; `~typesafe/jev-latest`                               | Podcast-category classification only. Must support OpenRouter's Decisions API, not chat completions or the rerank endpoint.                                                                                     |
| `EPISODE_RERANKING_ENABLED`    | Optional; enabled when an OpenRouter key is present            | Set the literal string `false` to disable reranking. `true` does not bypass the API-key requirement. Disabling this does not disable podcast classification.                                                    |
| `EPISODE_RERANKING_MODEL`      | Optional; branch-specific default below                        | Episode search only. The model must match the adapter in the branch you are running.                                                                                                                            |

There is no separate Pocket Casts API-key variable: connect your Pocket Casts
account through the UI. Apple podcast discovery needs no API key, and the current
embedding implementation does not use `OPENAI_API_KEY`. Registration is controlled
by the database's `signup_enabled` feature flag, not an environment variable.

### NVIDIA versus Jev episode ranking

| Working directory / branch                                | Default `EPISODE_RERANKING_MODEL`            | API                                                       |
| --------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------- |
| Primary NVIDIA implementation                             | `nvidia/llama-nemotron-rerank-vl-1b-v2:free` | OpenRouter Rerank API                                     |
| `episode-search-jev` worktree / `feat/episode-search-jev` | `typesafe/jev-1.14`                          | OpenRouter Decisions API through TanStack AI's `decide()` |

Omit `EPISODE_RERANKING_MODEL` to use the correct branch default. If copying local
settings into the Jev worktree, remove any NVIDIA override or replace it with:

```dotenv
EPISODE_RERANKING_ENABLED=true
EPISODE_RERANKING_MODEL=typesafe/jev-1.14
BETTER_AUTH_URL=http://localhost:3001
```

Keep `OPENROUTER_API_KEY` configured there and start that worktree with
`pnpm exec vite dev --port 3001`. Changing the model variable alone does **not**
switch the primary NVIDIA implementation to Jev: the two branches use different
API adapters. `PODCAST_CLASSIFICATION_MODEL` is unrelated to episode ranking and
can stay on Jev in either branch. Jev and paid model overrides incur OpenRouter
charges; the NVIDIA free variant is subject to provider availability and quotas.

### Ingestion and server settings

| Variable                       | Default | Notes                                                            |
| ------------------------------ | ------- | ---------------------------------------------------------------- |
| `PODCAST_REFRESH_MINUTES`      | `60`    | Refresh interval, integer from `1` to `10080`.                   |
| `PODCAST_EMBEDDING_BATCH_SIZE` | `16`    | Inputs per batch, integer from `1` to `32`.                      |
| `LOG_LEVEL`                    | `info`  | `trace`, `debug`, `info`, `warn`, `error`, `fatal`, or `silent`. |

Local development uses Vite on port 3000 with Netlify platform emulation.

### Docker Compose settings

These variables configure Compose interpolation, not AI providers:

| Variable            | Default           | Notes                                                                               |
| ------------------- | ----------------- | ----------------------------------------------------------------------------------- |
| `POSTGRES_USER`     | `podcast_checker` | Local database username; match it in `DATABASE_URL`.                                |
| `POSTGRES_DB`       | `podcast_checker` | Database name.                                                                      |
| `POSTGRES_PASSWORD` | `podcast_checker` | Local development default only; choose a strong production password.                |
| `POSTGRES_PORT`     | `5432`            | PostgreSQL port published on the host. Match it in a host-run app's `DATABASE_URL`. |

Compose interpolation reads the shell and `.env` by default, not `.env.local`.
Use `.env` or explicitly pass `docker compose --env-file .env.local ...` if changing
`POSTGRES_*` locally. Compose runs only the local database.
Changing `POSTGRES_*` does not rename users
or databases in an already-initialized PostgreSQL volume.

### Netlify, build, and test settings

- `INGESTION_SECRET`: required for deployed and locally emulated Netlify ingestion;
  generate a separate random secret of at least 32 characters.
- `URL`: supplied by Netlify and required as an HTTPS destination for scheduled
  ingestion dispatch. It is not a replacement for `BETTER_AUTH_URL`.
- Netlify is the only deployment adapter. `pnpm build:netlify` and
  `pnpm dev:netlify` are aliases for `pnpm build` and `pnpm dev`.
- `NODE_ENV` and Netlify's `CONTEXT` are normally platform-managed; `CONTEXT` is
  used as a log environment label. Netlify's `NODE_VERSION` is set to `24` in
  `netlify.toml`.
- `PODCAST_TEST_DATABASE_URL`: dedicated disposable PostgreSQL/pgvector database
  for integration tests. Those suites are skipped when unset; they apply migrations
  and modify test data, so never point it at production. Playwright uses the app's
  `DATABASE_URL` instead and supplies its own test auth URL/secret and server port.
  It runs the Netlify-emulated Vite server. Enable the signup database flag for that test app.
- `CI`: normally supplied by CI; enables Playwright's CI reporting/retry settings.

On Netlify, configure runtime secrets in the **Functions** scope and set
`DIRECT_DATABASE_URL` only on the external migration job when possible. Set
`PODCAST_REFRESH_MINUTES`, `PODCAST_EMBEDDING_BATCH_SIZE`, and `LOG_LEVEL` there too
if overriding defaults.

After changing settings, restart the development server or redeploy Netlify
as appropriate. Apply migrations before using new
database-backed features, including episode search snapshots.

## Automatic podcast categories

Set `OPENROUTER_API_KEY` on the server and run `pnpm db:migrate`. New follows
without a selected category are classified from their RSS channel title and
description, with publisher, RSS/iTunes categories (including subcategories), and
language as supporting context, using Jev directly through OpenRouter. The follow is saved first;
classification is attempted within a 20-second budget before returning the library.
Failures or uncertain matches leave the podcast uncategorised. Podcasts without
an RSS URL are left uncategorised. Existing follows and explicit category edits
do not trigger classification.

The default model is `~typesafe/jev-latest`: Jev itself classifies the podcast in
one request to OpenRouter's `POST /api/alpha/decisions`, using one Choice question
with the four categories and an explicit `none` option. `none` leaves the podcast
uncategorised. This bypasses TanStack AI's chat adapter because Jev's Decisions
API is not Chat Completions. `PODCAST_CLASSIFICATION_MODEL` can override the model
with a Decisions-compatible ID (for example, a pinned Jev version), not a chat
model or `typesafe/jev-router`. The existing OpenRouter API key still applies.

Edit `src/lib/podcast-classifiers.ts` to maintain the four classifiers (`sport`,
`story`, `history`, `web`), descriptions and example shows. The output schema is
derived from that configuration. When adding a classifier, also provision its
category for users; only an existing category belonging to the follower is assigned.
Manual category changes always take precedence over an in-flight classification.

`src/lib/podcast-follows.server.ts` owns follow saves, edits, unfollows, and the
automatic categorisation lifecycle. Its two operations return the refreshed
library; callers never coordinate categorisation tokens. Library queries remain
in `src/lib/podcast-library-query.server.ts`, and the existing authenticated
server functions in `src/lib/podcast-library.ts` retain their input validation.
Removing and re-adding a follow starts a new categorisation attempt; an older
attempt cannot change that follow or cancel its new attempt.

## Agent skills

`@tanstack/intent` is installed as a development dependency. Run `pnpm intent list`
to discover local skills and `pnpm intent load <package>#<skill>` to load one.
The package script selects the installed CLI explicitly because older TanStack
Devtools packages also expose an incompatible binary named `intent`.

## Git hooks

`pnpm install` installs the Husky pre-commit hook automatically. If dependencies
are already installed, run `pnpm prepare` once to enable it.

Before each commit, the hook runs Oxlint with automatic fixes on staged
JavaScript and TypeScript files, then Oxfmt on staged files it supports. Both
tools respect their existing ignore patterns. Fixes are staged automatically,
unstaged edits are preserved, and remaining lint errors block the commit.

Run `pnpm lint:staged` to run the same checks manually on staged files.
`pnpm check` checks linting and formatting across the project.

## Server logging

The web server, Netlify functions, and ingestion CLI use **Pino** to write
newline-delimited JSON to stdout. Netlify captures function logs automatically;
Docker logs are available with `docker compose logs -f app`. No external logging
service or worker-thread transport is required; writes are synchronous so logs
are not left buffered when a serverless invocation finishes.

Set `LOG_LEVEL` in the server environment (or `.env.local`) to `trace`, `debug`,
`info` (default), `warn`, `error`, `fatal`, or `silent`. On Netlify, include the
Functions scope and redeploy. Request completion timing measures time to response
headers, not consumption of a streaming response body.

- HTTP logs include `requestId`, `correlationId`, `method`, `pathname`, `status`,
  and `durationMs`. Responses expose `x-request-id` for support/debugging.
- Netlify ingestion logs also include `functionName`, `invocationId`, and
  `deployContext`. Dispatch forwards `x-correlation-id` to background ingestion:
  search both functions' logs for that value to follow one run.
- Server-function logs include `serverFunction`, `serverFunctionId`, and the
  same request context, including calls made during SSR. Redirects/not-found
  results are informational, validation failures are warnings, and other thrown
  errors are errors. RPC logging is independent of HTTP response status.
- Ingestion logs include feed/job IDs, batch sizes, skipped runs, and failures.
  Set `LOG_LEVEL=debug` to also see request-start events.

Use `getLogger()` from `src/lib/logger.ts` inside server-only code to inherit
the current async context, and `withLogContext({ feedId }, action)` to add fields:

```ts
getLogger().error({ event: 'ingestion.feed_failed', err, feedId }, 'Feed sync failed')
```

Never log raw requests, function arguments, credentials, search text, or upstream
response bodies. HTTP logging records only the pathname, not query strings or
headers. Common credential/payload fields are redacted as a safety net; error
serialization excludes arbitrary properties and SQL/validation input messages.
Keep custom error messages free of sensitive values as well. Pino is server-only
and is not included in the browser bundle.

`pnpm lint` also runs a type-aware deprecated-API check against the installed
dependency declarations, including editor-only `@deprecated` annotations. Run
`pnpm lint:deprecations` to execute that check on its own. Generated Paraglide and
route-tree files are excluded through the shared lint configuration.

# Building For Production

To build this application for production:

```bash
npm run build
```

## Tests

- `pnpm test` runs Vitest component tests with Testing Library.
- `pnpm test:watch` runs the component tests in watch mode.
- `pnpm test:follows` runs the follow lifecycle integration tests with Testcontainers.
  Docker must be running. The suite starts an isolated `pgvector/pgvector:pg18`
  container, applies migrations, and removes the container afterward; it never
  uses the application's database. RSS and model adapters are controlled in tests.
  The normal test run skips this suite unless `PODCAST_TEST_CONTAINERS=true` or
  `PODCAST_TEST_DATABASE_URL` is set. The latter supports an existing dedicated
  test database without starting a container.
- `pnpm test:search` runs episode-search integration tests in a separate
  Testcontainers pgvector database, with the same Docker and opt-in rules.
  Snapshot persistence, retrieval, and reranking policy run unchanged; tests
  control query embeddings and the external scoring adapter, not fallback policy.
- `pnpm exec playwright install chromium webkit` installs the browsers for end-to-end tests.
- `pnpm test:e2e` runs the Playwright starter suite and starts the app automatically.
- `pnpm test:e2e:ui` opens Playwright’s interactive test runner.

Component tests cover authentication, podcast search, following, category
assignment and filtering, retryable errors, and English/French localization.
The end-to-end suite also checks database-backed library persistence, account
isolation, keyboard controls, and mobile layout. Run `pnpm db:setup` first;
library tests create temporary accounts and remove them after each test.

## Logo and browser icons

The original artwork is in `public/logo.png`. Run `pnpm icons:generate` after
replacing it to regenerate the optimized header logo, 16px/32px PNG favicons,
multi-size ICO favicon, opaque 180px Apple touch icon, and monochrome Safari
pinned-tab SVG. All icon URLs are root-relative so they also work on French routes.

The Playwright suite runs in Chromium, desktop WebKit, and mobile Safari
emulation, including checks for logo rendering and delivery of browser icons.

## Authentication pages

- `/signin` provides email/password authentication; `/signup` also requires password confirmation.
- Sign-up is disabled by default. Apply `drizzle/0008_feature_flags.sql` with
  `pnpm db:migrate`. The PostgreSQL `feature_flag` table contains a
  `signup_enabled` row initialized to `false` (new flags also default to `false`).
  Enable registration with:

  ```sql
  UPDATE feature_flag SET enabled = true WHERE key = 'signup_enabled';
  ```

  Set it back to `false` to disable registration. No restart is required: the flag
  is read on auth-page navigation and every sign-up request. When disabled (or the
  row is missing), the sign-in page hides its registration link, `/signup`
  returns the standard HTTP 404 page, and the sign-up API returns a generic HTTP
  404 without disclosing the flag. Existing accounts
  can still sign in. Enable the flag on a dedicated test database before running
  the Playwright suite, which exercises registration and creates test accounts.

- `/discover` and `/latest-episodes` are authenticated pages; anonymous visitors go to `/signin`.
- Successful sign-in or sign-up navigates through `/`, which redirects to
  `/latest-episodes` when the account follows any podcasts, and `/discover` otherwise.
  Sign-out navigates to `/signin`.
- English is the default locale. French routes use the `/fr` prefix, and the
  language dropdown below the form preserves the current page when switching locales.
- Logged-in pages group language selection and sign-out in the header’s
  hamburger account menu, built with shadcn’s accessible dropdown components.

## Podcast discovery

The Discover tab searches Apple’s iTunes Search API for podcasts by name, host,
or topic. Searches run on form submission through an authenticated server
function, with a 10-second upstream timeout and up to 50 results. No API key is
required. The catalog currently uses the US storefront.

Results show artwork, podcast titles, publishers, and links to Apple Podcasts.
Loading, empty, and retryable error states are available in English and French.
TanStack Query caches searches for five minutes. Each result also includes its
Apple collection ID and RSS feed URL. Artwork is lazy-loaded and decoded
asynchronously; Apple CDN images use responsive sources matched to the card size
and screen pixel density.

## Following and organizing podcasts

- Click **Follow** on a search result to save it to your account’s library.
- **Add tags** opens a category picker. Choose existing categories or type a
  name and click **Create**, then **Follow & save** to follow and categorize
  the podcast together. Followed podcasts offer **Edit tags** instead.
  Pressing **Enter** in the picker selects an exact match (or the first filtered
  match), or creates and selects a new category if there are no matches. The
  input clears so you can add another tag before saving.
- The **Followed podcasts** sidebar lists saved shows and their category badges.
  Click its heading to view the whole library, a show to view that podcast,
  or a category to filter the library. The text filter matches show titles,
  publishers, and category names.
- **New category** creates a category without assigning a podcast. Category
  counts reflect followed shows; names are unique per account regardless of case.
- Clicking **Following** unfollows the podcast. When its last follow is removed,
  its feed, imported episodes, and embeddings are deleted together using database
  cascades. Following it again starts a fresh import and vectorization.
  Existing categories remain available.

Libraries and categories are stored in PostgreSQL and scoped to the authenticated
user. Apply `drizzle/0001_podcast_library.sql` with `pnpm db:migrate` when upgrading
an existing database (or use `pnpm db:setup` to start PostgreSQL and migrate).

## Latest episodes

The **Latest episodes** tab lists imported RSS episodes from the signed-in account’s
followed podcasts, grouped by publication day. Cards show artwork, podcast and episode
titles, publication time, duration, a description preview, and the podcast’s tags.

- Filter by podcast, tag, or date range (the last seven days by default).
- Sort newest or oldest first and load additional episodes in pages of 25.
- Select a podcast or category in the sidebar to filter its episodes.
- **Refresh episodes** reloads the stored episodes and library. The list also
  refreshes every 30 seconds while background imports run.
- Episodes with no publication date appear under **Unknown date** in **All time**.

### Pocket Casts Play Next

Click **Connect Pocket Casts** on Latest episodes and sign in with your Pocket
Casts email and password. Each episode then offers **Play next in Pocket Casts**,
which adds it immediately after the currently playing episode in your synced
Up Next queue. The app receives the change on its next Pocket Casts sync.
Disconnect removes the saved connection without changing your queue.

This integration uses the Pocket Casts Web Player's unofficial API. It resolves
the podcast by Apple ID and matches the episode by a unique RSS GUID, audio URL,
or title plus publication time. Episodes unavailable in the Pocket Casts catalog
return an error rather than queueing a guessed match. Queue updates use the
additive Play Next endpoint, preserving the remaining queue.

Apply the new database migration with `pnpm db:migrate`. Set `BETTER_AUTH_SECRET`
to a stable secret of at least 32 characters. It also encrypts the account's access
and refresh tokens at rest; changing it requires reconnecting Pocket Casts.
Passwords are exchanged server-side and are never saved. Expired access tokens
are refreshed automatically; rejected sessions prompt reconnection. Accounts
using only Apple/Google sign-in need a Pocket Casts password for this connection.

### Episode search

Use **Search episodes** on Latest episodes and press Enter or **Search**:

- **Text + semantic** (default) combines title/description matches with embedding
  similarity, including episodes whose wording differs from your query.
- **Title & description** searches full stored titles and cleaned descriptions,
  including episodes that have not finished embedding. It supports literal text
  and full-text word matching, and does not call an embedding API.
- **Semantic (embeddings)** embeds your query with the same Cloudflare Workers AI
  `@cf/qwen/qwen3-embedding-0.6b` model and 1,024 dimensions used for episodes, then ranks compatible, ready vectors
  by pgvector cosine similarity. Results below 0.3 cosine similarity are excluded.

Search respects podcast, tag, and date filters; choose **All time** to include
older episodes. Searches initially use **Most relevant** sorting; you can switch
to publication-date ordering. Clearing search returns to the episode list.
Semantic-only matches are labeled in results.

Semantic search uses the server’s `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN`. Episodes are sent as model documents; search queries use
the model's query input and a podcast-retrieval instruction. Query vectors are
cached for five minutes in a bounded in-memory cache to avoid repeated embedding
calls during pagination and filtering. Searches run on submission and do not poll.
If the embedding provider is unavailable, combined search shows text results with
an explanation; semantic-only search offers a retry or text search instead.

Embedding calls use TanStack AI's `embed()` with `createCloudflareEmbedding()`.
A small custom-fetch bridge preserves the Qwen model's native `documents`/`queries`
payloads, query instruction, caller cancellation and 60-second deadline. It validates
the provider envelope, row count and 1,024-dimensional vectors and sanitizes numeric
Cloudflare error codes before the adapter's lifecycle can report an error. These
compatibility checks remain app-owned because the generic Cloudflare adapter sends
`text` inputs and does not forward cancellation yet. The embedding model and input
preprocessing are unchanged; existing stored vectors do not need rebuilding.
The ingestion CLI uses `tsconfig.scripts.json` to avoid
tsx resolving an incomplete TypeScript source in TanStack AI's `fast-json-patch`
dependency. Netlify bundles the production functions.

#### Episode relevance reranking

Run `pnpm db:migrate` before starting this version. With `OPENROUTER_API_KEY` set,
**Most relevant** searches rerank the first 50 retrieved candidates using
`nvidia/llama-nemotron-rerank-vl-1b-v2:free` through OpenRouter's `/api/v1/rerank`.
Calls use TanStack AI's `rerank()` and the official `createOpenRouterRerank()`
adapter. The adapter's OpenRouter SDK handles response parsing, typed errors and
transient-error retries (a 1.5-second backoff budget inside the overall deadline).
There is no hand-written HTTP client or second retry loop. SDK debug output is
disabled to keep upstream response bodies out of application logs.
Text, semantic and hybrid modes keep their existing candidate membership; the
ranker receives the query and episode/podcast titles plus cleaned descriptions,
not embedding vectors. Documents are capped at 6,000 UTF-8 bytes; the UI's
500-character previews are not used for ranking. No transcripts or images are sent.

- `EPISODE_RERANKING_ENABLED=false` disables provider calls for a baseline comparison.
- `EPISODE_RERANKING_MODEL` overrides the model with another OpenRouter rerank model.
  Paid overrides can incur charges; there is no automatic paid-model fallback.
- The reranking operation has an **eight-second** deadline. Missing credentials,
  unavailable/free-tier capacity, invalid responses and timeouts preserve the
  original ranking. Equal scores preserve retrieval order. No results are hidden.
- Newest/oldest sorting and browsing without a query do not call the reranker.

The search page identifies the applied model or explicitly reports fallback/baseline
ranking. Server events `search.reranked` and `search.reranking_unavailable` include
duration, candidate count and available usage cost, but never queries or descriptions.

Authenticated search snapshots persist ordered episode IDs in PostgreSQL for
15 minutes, including fallback order. The top 50 are reranked and the remaining
matches keep their original order. Snapshots are scoped to the user, filters,
current follows, model, enabled state and ranking version. Repeated searches reuse
the snapshot; later pages reuse it across serverless instances without re-embedding
or reranking. Newly ingested episodes appear after expiry. Expired results offer a
retry that restarts pagination. Every page rechecks current follow access. Expired
snapshots are deleted when a new search snapshot is created, and user deletion
cascades to its snapshots. Only hashed search fingerprints, IDs and ranking
diagnostics are stored, not raw query text or document content.

`src/lib/episode-query.ts` retains the search interface and response serialization.
`src/lib/episode-search-snapshot.server.ts` owns fingerprinting, reuse, expiry,
creation, ranking-tail assembly, and snapshot-position pagination. SQL matching,
filtered follow access, candidate loading, and authorized hydration live in
`src/lib/episode-retrieval.server.ts`. Reranking policy and its provider adapter
remain separate. Fingerprints and stored snapshots are unchanged; no new migration
is needed for this refactor.

For comparison, the `episode-search-jev` worktree uses the same retrieval, document
limits and pagination, with a Jev Decisions adapter instead. See that worktree's
README for its provider details. Configure the same database and credentials in
both working directories, then run the primary app with `pnpm dev` and the other
with `pnpm exec vite dev --port 3001`. Compare identical queries, search mode,
podcast/tag filters and date range with ingestion paused for a controlled comparison.
Model/version-scoped snapshots prevent one ranker from reusing the other's results.
Check the ranking banner rather than assuming a successful search used AI ranking.

## Background RSS ingestion and episode embeddings

Following a podcast with an RSS URL atomically creates or links a shared feed
record. The record is a durable outbox: the web request does not fetch RSS, parse
XML, or call the embedding API. A Netlify scheduled function dispatches a bounded
background ingestion run every five minutes. Due feeds refresh hourly
by default, with conditional HTTP requests when supported.

### Run locally

Use **`docker-compose.dev.yml`** for PostgreSQL only, and run the app on your host
with `pnpm dev`. This file reuses the PostgreSQL service from `docker-compose.yml`
and the existing `postgres18_data` volume.
`pnpm db:setup` selects this development Compose file automatically.

The PostgreSQL service now uses **`pgvector/pgvector:pg18`**. It keeps the existing
`postgres18_data` volume at `/var/lib/postgresql`. Migration
`drizzle/0002_podcast_ingestion.sql` enables the `vector` extension, creates feed,
episode, and embedding tables, and queues feeds already in users' libraries.
The migration role must be able to enable `vector`.

1. Add your Cloudflare Workers AI credentials to `.env.local`:

   ```dotenv
   CLOUDFLARE_ACCOUNT_ID=your-32-character-account-id
   CLOUDFLARE_API_TOKEN=your-workers-ai-api-token
   ```

   In the Cloudflare dashboard, open **Workers AI → Use REST API** to copy the
   account ID and create a Workers AI API token. The token needs **Workers AI
   Read** and **Workers AI Edit** access to that account. Credentials stay on the
   server; the app calls Cloudflare's REST API from local or deployed functions.

2. Upgrade/start PostgreSQL and apply migrations:

   ```bash
   pnpm db:setup
   ```

3. Run the app with Netlify platform emulation:

   ```bash
   pnpm dev
   ```

### Deploy to Netlify with Neon

`pnpm build` uses the official Netlify TanStack Start adapter.
`netlify.toml` configures the build command,
`dist/client` publish directory, Node 24, and a five-minute ingestion schedule.
Apply database migrations explicitly before deployment.

#### 1. Keep local PostgreSQL; create Neon for production

Local development remains unchanged:

```bash
# Create .env.local using the Environment variables example above, if needed.
pnpm db:setup
pnpm dev
```

The existing `pgvector/pgvector:pg18` Docker service is an offline development
database, not a Neon dependency. The ordinary `pg` driver works with both Docker
Postgres and Neon, including transactions and pgvector; no Neon-specific driver
or emulator is required. Prefer matching PostgreSQL major versions locally and
in Neon when available.

[Neon Local](https://neon.com/docs/local/neon-local) is an optional Docker proxy
to **cloud** Neon branches (including ephemeral branches), not an offline Neon
emulator. It needs a Neon project, API key, and network access. It is unnecessary
for the current standard-Postgres integration.

Create a Neon database and copy both connection strings from its Connect dialog:

- **Pooled** (`-pooler` hostname): `DATABASE_URL` for web and background functions.
- **Direct** (no `-pooler`): `DIRECT_DATABASE_URL` for migrations and administration.

Preserve Neon's supplied TLS connection parameters. Do not disable certificate
verification. The app reuses a small `pg.Pool` (two connections per process by
default), with connection, idle, and query timeouts. `DATABASE_POOL_MAX` can be
set from 1 to 20; keep it small for serverless deployments. Neon's shared pooler
handles connections across instances.

#### 2. Apply migrations explicitly, before deploying

Run migrations from a trusted machine or CI with the **direct** Neon URL:

```bash
DIRECT_DATABASE_URL='postgresql://.../neondb?sslmode=require' pnpm db:migrate
```

The CLI prefers `DIRECT_DATABASE_URL`, falling back to `DATABASE_URL` locally.
Process environment values take precedence over `.env.local`. All existing
migrations apply to a new database, including `CREATE EXTENSION vector` and
`0007_serverless_ingestion_lease`. The migration role must be able to create the
extension and application tables. Migrations are deliberately **not** run during
Netlify builds, preview builds, cold starts, or requests. Apply future compatible
migrations once in a controlled release step before deploying dependent code.

This initializes a schema; it does **not** copy your current Docker data. If you
want to preserve it, perform a separate tested `pg_dump` / restore into Neon using
direct connections. Stop ingestion and writes during the final cutover, check
PostgreSQL version compatibility, and retain a backup. Keep `BETTER_AUTH_SECRET`
unchanged to preserve existing encrypted Pocket Casts tokens.

#### 3. Configure Netlify environment variables

Set these in the Netlify UI/CLI, not in committed files. Include the **Functions**
scope where scope controls are available:

| Variable                       | Production value                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| `DATABASE_URL`                 | Neon pooled connection string, including TLS parameters                                   |
| `BETTER_AUTH_URL`              | Canonical public HTTPS URL, matching your Netlify site/custom domain                      |
| `BETTER_AUTH_SECRET`           | Stable random secret of at least 32 characters                                            |
| `INGESTION_SECRET`             | Separate random secret of at least 32 characters (`openssl rand -hex 32`)                 |
| `CLOUDFLARE_ACCOUNT_ID`        | Workers AI account ID (optional for RSS-only ingestion)                                   |
| `CLOUDFLARE_API_TOKEN`         | Workers AI API token (optional for RSS-only ingestion)                                    |
| `OPENROUTER_API_KEY`           | Optional; enables podcast categorisation and episode reranking                            |
| `PODCAST_CLASSIFICATION_MODEL` | Optional; defaults to `~typesafe/jev-latest` for category decisions                       |
| `EPISODE_RERANKING_ENABLED`    | Optional; set `false` to disable reranking without disabling categorisation               |
| `EPISODE_RERANKING_MODEL`      | Optional; use this branch's default or a compatible model from the ranking profiles above |
| `DATABASE_POOL_MAX`            | Optional; `2` by default, allowed range `1`–`20`                                          |
| `LOG_LEVEL`                    | Optional; `info` by default                                                               |

`DIRECT_DATABASE_URL` is only needed by the external migration step, not deployed
functions. Netlify supplies `URL` automatically for the scheduled dispatcher's
destination. Keep it aligned with `BETTER_AUTH_URL`. Secret changes require a new
deploy. Never expose credentials through `VITE_*` variables.

**Isolate previews:** give preview/branch deploys a separate Neon branch/database,
their own auth URL, and separate secrets, or leave their database unconfigured.
Background ingestion refuses non-production and unpublished deploys, but normal
web requests in previews can still write to whatever database you configure.
Do not give previews the production database URL.

Connect the repository to Netlify and let it use `netlify.toml`. For a local
deployment build check:

```bash
pnpm build:netlify
```

#### Serverless ingestion behavior

Every five minutes, `podcast-dispatch` invokes `podcast-ingest-background` with a
server-only bearer secret. The dispatcher only waits for Netlify's `202 Accepted`;
the actual work runs in a background function, not inside the 30-second scheduled
function. Check background logs and database sync status for completion: the
initial 202 does not prove processing succeeded.

- A database lease admits one serverless run at a time, including retries and
  overlapping deploys. The lease uses ordinary SQL and works with Neon's
  transaction pooler; it does not depend on a persistent session/advisory lock.
- Each run attempts at most **five feeds** and **20 embedding batches** (16 inputs
  per batch by default). It stops starting work after an **eight-minute** budget,
  propagates cancellation to ingestion, and leaves ample time below Netlify's
  15-minute hard limit.
- The durable feed/embedding outbox remains the source of truth. Work left by a
  bounded run is picked up on the next scheduled run. Failed work retains its
  existing retry date/error; a provider failure stops further batches in that run.
- Successful runs release the lease. A terminated run recovers after the
  **20-minute** lease expires. Delivery is at least once:
  an API call interrupted before its result is committed can be repeated.
- Completed embeddings are skipped. Without Cloudflare credentials, RSS imports
  continue and embeddings remain pending.

#### Local Netlify emulation

`pnpm dev` uses the official adapter's platform emulation, including the functions
in `netlify/functions`. Set `BETTER_AUTH_URL=http://localhost:3000` and a separate
`INGESTION_SECRET` in `.env.local`. Use Node 24 to match production.
Scheduled jobs do not tick automatically locally. Trigger the dispatcher while
the dev server is running:

```bash
curl -X POST http://localhost:3000/.netlify/functions/podcast-dispatch
```

The emulator's `dev` context allows ingestion; the dispatcher sends an authenticated
request to the background function on the loopback `BETTER_AUTH_URL`. Published
production deploys use Netlify's HTTPS `URL`; preview deploys still skip ingestion.
Check terminal logs for completion after the background function accepts the request.
For a direct runner invocation without HTTP emulation, use `pnpm ingest:once`.

Netlify compute, requests, deploys, and bandwidth share its monthly credit
allowance; Cloudflare inference and Neon usage have separate quotas. A large
initial import can exceed free allowances even with bounded batches. Increase the
cron interval in `netlify.toml` if you prefer lower polling cost to import latency.

### Incremental behavior and load limits

- Shared public feed records prevent duplicate imports across users. User
  categories remain separate. Unfollowing the last entry for a feed deletes the
  feed and cascades to its episodes and embeddings.
- Episode identity is the feed plus GUID, falling back to enclosure URL, episode
  link, or publication date plus title. Repeated RSS items are upserted.
- **Only unembedded episodes call the embedding API.** Completed vectors remain
  unchanged on scheduled refreshes, including when an existing episode's title
  or description is edited. Display metadata still updates. Pending/failed
  episodes can adopt corrected text and retry; a hash guard rejects stale results.
- RSS items disappearing from a rolling feed remain in the database. Initial
  imports cover the available feed and supported `atom:link rel="next"` archive
  pages, bounded to 20 pages and 10 MiB per page.
- Episode titles prefer `itunes:title`; descriptions prefer substantive HTML
  show notes, then description/summary. HTML is converted to text; recognizable
  promotional paragraphs and credits are removed. Original descriptions/HTML
  remain available. Duplicate description variants are not concatenated.
- Each episode uses one combined title/description vector from Cloudflare Workers AI
  `@cf/qwen/qwen3-embedding-0.6b` (1,024 dimensions). Inputs are conservatively bounded
  to 7,500 UTF-8 bytes; full cleaned text is stored separately. The exact input,
  hash, model, preprocessing version, and timestamp are persisted.
- The database lease admits one bounded ingestion run at a time. Transactions
  import at most 50 episodes, and an embedding batch holds at most 16 inputs.
- Failed feeds and embeddings retain retry state for later scheduled runs.
  Completed embeddings are skipped on redelivery; an interrupted API request may
  still incur a repeated provider call before its result is committed.
- The library shows import/embedding progress and the last successful feed
  refresh. **Retry episode import** requests another attempt for a failed show.
- Provider errors retain Cloudflare's numeric error code without raw response
  messages: `3036` identifies an exhausted daily free neuron allowance, while
  `3040` indicates temporary model capacity exhaustion.
- Public HTTP(S) feed fetching validates redirect destinations and resolved IPs
  at connection time, applies time/size limits, and rejects XML document entities.

Ingestion configuration:

| Variable                       | Default | Allowed values |
| ------------------------------ | ------- | -------------- |
| `PODCAST_REFRESH_MINUTES`      | `60`    | 1–10080        |
| `PODCAST_EMBEDDING_BATCH_SIZE` | `16`    | 1–32           |

Feed and episode deduplication remains enforced by the database. Model changes or
re-embedding completed episodes require an explicit reindex migration; ordinary
RSS refreshes never do that automatically. Vector search should use the same
model and cosine distance; an HNSW index can be added when query volume warrants it.

### Cloudflare free allowance and switching existing data

Workers AI includes **10,000 neurons per day** on the Free plan, resetting at
**00:00 UTC**. The current published Qwen embedding rate is 1,075 neurons per
million input tokens. Both background imports and semantic queries consume this
account-level allowance. Request/capacity limits also apply. On the Free plan,
usage beyond the allowance fails and jobs remain retryable; upgrading to Workers
Paid enables billed usage beyond the daily free allocation. See
[Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
and the [model documentation](https://developers.cloudflare.com/workers-ai/models/qwen3-embedding-0.6b/).

Migration **`0003_cloudflare_embeddings.sql`** changes the vector column from 1,536
to 1,024 dimensions. Existing episode records and embedding input text are kept;
old vectors are invalidated, model-aware hashes are recomputed, and embeddings
are reset to pending for this one-time provider change.
Ordinary feed refreshes still skip completed vectors.

For an existing local database, run `pnpm db:migrate` and restart `pnpm dev` after
configuring the two Cloudflare variables. Apply production migrations explicitly.
The account does not need an OpenAI key or a Cloudflare-hosted application.

### Ingestion tests

`pnpm test` includes parser, normalization, and public-address validation tests.
Run the durable ingestion tests against a dedicated database on the pgvector
service:

```bash
docker compose -f docker-compose.dev.yml exec -T postgres createdb -U podcast_checker podcast_checker_ingestion_test
PODCAST_TEST_DATABASE_URL=postgresql://podcast_checker:podcast_checker@localhost:5432/podcast_checker_ingestion_test pnpm exec vitest run src/lib/podcast-ingestion.integration.test.ts
```

The integration suite applies migrations, uses real PostgreSQL/pgvector,
and mocks RSS/embedding providers to avoid API costs. It checks new-only
embedding, repeated syncs, retries, stale results, conditional requests, archive
retention, unfollowing, and ingestion lease recovery. It removes its own test
records afterward.

## File naming

- React component files use PascalCase, such as `PodcastSearch.tsx` and `PasswordInput.tsx`.
- Component tests match their component filenames, such as `PodcastSearch.test.tsx`.
- Non-component files use kebab-case, such as `podcast-search.ts` and `podcast-artwork.ts`.
- File-based routes follow TanStack Router’s filename conventions.

## Styling

This project uses [Tailwind CSS](https://tailwindcss.com/) for styling.

Shared shadcn/ui components use [Base UI](https://base-ui.com/react/) primitives.
`components.json` selects the `base-nova` preset for future component generation.
Compose triggers and close controls with `render={<Button />}`. Popovers and menus
use a portal, positioner, and popup; their viewport sizing uses `--available-height`.

- Use Tailwind's spacing, typography, and radius scales for component styles
  (`gap-4`, `px-6`, `text-lg`, `rounded-lg`) instead of one-off pixel values.
- Shared colors, fluid heading sizes, and artwork dimensions are theme tokens in
  `src/styles.css`. Keep arbitrary values for structural layouts, gradients, or
  browser-specific behavior that standard utilities cannot express.
- The `laptop:`, `tablet:`, and `mobile:` variants apply at widths up to 1200,
  900, and 480px respectively.
- Oxfmt sorts Tailwind classes in JSX and `cn(...)` using this theme. Run
  `pnpm format` to apply sorting; `pnpm format:check` verifies it.

### Removing Tailwind CSS

If you prefer not to use Tailwind CSS:

1. Remove the demo pages in `src/routes/demo/`
2. Replace the Tailwind import in `src/styles.css` with your own styles
3. Remove `tailwindcss()` from the plugins array in `vite.config.ts`
4. Remove `@tailwindcss/vite` and `tailwindcss` from `package.json`

# TanStack Chat Application

Am example chat application built with TanStack Start, TanStack Store, and Claude AI.

## .env Updates

```env
ANTHROPIC_API_KEY=your_anthropic_api_key
```

## ✨ Features

### AI Capabilities

- 🤖 Powered by Claude 3.5 Sonnet
- 📝 Rich markdown formatting with syntax highlighting
- 🎯 Customizable system prompts for tailored AI behavior
- 🔄 Real-time message updates and streaming responses (coming soon)

### User Experience

- 🎨 Modern UI with Tailwind CSS and Lucide icons
- 🔍 Conversation management and history
- 🔐 Secure API key management
- 📋 Markdown rendering with code highlighting

### Technical Features

- 📦 Centralized state management with TanStack Store
- 🔌 Extensible architecture for multiple AI providers
- 🛠️ TypeScript for type safety

## Architecture

### Tech Stack

- **Frontend Framework**: TanStack Start
- **Routing**: TanStack Router
- **State Management**: TanStack Store
- **Styling**: Tailwind CSS
- **AI Integration**: Anthropic's Claude API

## Paraglide i18n

Paraglide JS provides localized routing and message formatting.

- Edit source translations in `messages/en.json` and `messages/fr.json`.
- Supported locales and the message file pattern are configured in `project.inlang/settings.json`.
- URLs are localized through the Paraglide Vite plugin and router `rewrite` hooks.
- Message functions and the locale runtime are generated in `src/paraglide`. Do not edit these files directly.

### Compiling messages

The Paraglide Vite plugin in `vite.config.ts` compiles messages automatically when you run `pnpm dev` or `pnpm build`. A production build includes the compiled messages, so **no separate translation compilation step is required**.

To regenerate the message files without starting Vite or building the app, run:

```bash
pnpm exec paraglide-js compile \
  --project ./project.inlang \
  --outdir ./src/paraglide \
  --strategy url baseLocale
```

Compilation turns existing translations into JavaScript functions; it does not translate text into other languages.

## Setting up Better Auth

1. Generate and set the `BETTER_AUTH_SECRET` environment variable in your `.env.local`:

   ```bash
   npx -y @better-auth/cli secret
   ```

2. Visit the [Better Auth documentation](https://www.better-auth.com) to unlock the full potential of authentication in your app.

### Local PostgreSQL with Docker Compose

The app persists Better Auth users, accounts, and sessions through Drizzle and
PostgreSQL. Start Docker Desktop before initializing the database.

The `postgres` service uses PostgreSQL 18 with pgvector, a health check, and the persistent
`postgres18_data` volume mounted at `/var/lib/postgresql`, following the
PostgreSQL 18 image’s storage layout. It listens on `127.0.0.1:5432` with the local development defaults
`podcast_checker` for the database, username, and password.

Set this value in your existing `.env.local`:

```env
DATABASE_URL=postgresql://podcast_checker:podcast_checker@localhost:5432/podcast_checker
```

See the deployment and ingestion sections above for the app's other environment
variables. The app and Drizzle
CLI both load `.env.local` and `.env`, preserving values already set in the
process environment. Compose defaults can be overridden using `POSTGRES_DB`,
`POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_PORT` in your shell or `.env`;
update `DATABASE_URL` to match any overrides.

Start PostgreSQL and run the app:

```bash
docker compose -f docker-compose.dev.yml up -d --wait postgres
pnpm db:migrate
pnpm dev
```

On a fresh data volume, PostgreSQL automatically runs
`docker/postgres/10-init-migrations.sh` through `/docker-entrypoint-initdb.d`.
The script applies the SQL migrations listed in `drizzle/meta/_journal.json`
in journal order and records their SHA-256 hashes and timestamps in
`drizzle.__drizzle_migrations`, so subsequent Drizzle migrations recognize
them as already applied. Each migration and its history entry run in one
transaction, and SQL errors stop initialization.

Initialization scripts run **only when the data volume is empty**, not on
container restarts. For an existing volume, or to start PostgreSQL and apply
any pending migrations in one command, use:

```bash
pnpm db:setup
pnpm dev
```

`db:setup` starts only PostgreSQL through `docker-compose.dev.yml`, waits for it
to become healthy, then runs `db:migrate`.
The initial migration in `drizzle/0000_auth.sql` creates the user, account,
session, and verification tables, including their constraints and indexes.

Volumes originally created with `postgres:18-alpine` need migration
`0004_repair_library_indexes` after switching to the Debian-based pgvector image.
The change from musl to glibc changes text sorting, leaving old indexes unable to
reliably find existing keys. This can allow duplicate tags despite their primary
key and `ON CONFLICT` handling. Run `pnpm db:migrate` to merge duplicate category
identities without changing podcast assignments and rebuild application indexes.
The repair is transactional and locks tables while rebuilding their indexes.

Migration `0006_default_podcast_categories` gives every account the default
categories `sport`, `story`, `history`, and `web`. Each default uses its
normalized name as a fixed ID, so the account/category primary key makes the
seed idempotent; a `NOT EXISTS` check also skips equivalent names that differ
only in case or surrounding whitespace. A trigger seeds the same defaults for
users created afterwards.

After changing the schema, generate and apply a new migration:

```bash
pnpm db:generate
pnpm db:migrate
```

Restart the app after changing `.env.local`. Check the database with
`docker compose -f docker-compose.dev.yml ps` or
`docker compose -f docker-compose.dev.yml logs postgres`. Use
`docker compose -f docker-compose.dev.yml stop postgres` to stop it while keeping
its data. The full Docker deployment uses `docker compose up -d --build` instead.

### Authentication validation

- Frontend: requires an email and password; uses the browser’s email validation;
  and, on sign-up, requires matching password confirmation and limits passwords
  to 8–128 characters. Mismatch and API errors are
  translated into English and French.
- Backend: Better Auth validates email format and request types, checks sign-up
  passwords are 8–128 characters, normalizes email addresses, rejects duplicate
  accounts, and hashes passwords. Sign-in checks the submitted password against
  the stored hash and rejects passwords longer than 128 characters.
- Password confirmation is a frontend check. The backend receives one password
  and applies its validation independently of the browser.

## Routing

This project uses [TanStack Router](https://tanstack.com/router) with file-based routing. Routes are managed as files in `src/routes`.

### Adding A Route

To add a new route to your application just add a new file in the `./src/routes` directory.

TanStack will automatically generate the content of the route file for you.

Now that you have two routes you can use a `Link` component to navigate between them.

### Adding Links

To use SPA (Single Page Application) navigation you will need to import the `Link` component from `@tanstack/react-router`.

```tsx
import { Link } from '@tanstack/react-router'
```

Then anywhere in your JSX you can use it like so:

```tsx
<Link to="/about">About</Link>
```

This will create a link that will navigate to the `/about` route.

More information on the `Link` component can be found in the [Link documentation](https://tanstack.com/router/v1/docs/framework/react/api/router/linkComponent).

### Using A Layout

In the File Based Routing setup the layout is located in `src/routes/__root.tsx`. Anything you add to the root route will appear in all the routes. The route content will appear in the JSX where you render `{children}` in the `shellComponent`.

Here is an example layout that includes a header:

```tsx
import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'My App' },
    ],
  }),
  shellComponent: ({ children }) => (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <header>
          <nav>
            <Link to="/">Home</Link>
            <Link to="/about">About</Link>
          </nav>
        </header>
        {children}
        <Scripts />
      </body>
    </html>
  ),
})
```

More information on layouts can be found in the [Layouts documentation](https://tanstack.com/router/latest/docs/framework/react/guide/routing-concepts#layouts).

## Server Functions

TanStack Start provides server functions that allow you to write server-side code that seamlessly integrates with your client components.

```tsx
import { createServerFn } from '@tanstack/react-start'

const getServerTime = createServerFn({
  method: 'GET',
}).handler(async () => {
  return new Date().toISOString()
})

// Use in a component
function MyComponent() {
  const [time, setTime] = useState('')

  useEffect(() => {
    getServerTime().then(setTime)
  }, [])

  return <div>Server time: {time}</div>
}
```

## API Routes

You can create API routes by using the `server` property in your route definitions:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

export const Route = createFileRoute('/api/hello')({
  server: {
    handlers: {
      GET: () => json({ message: 'Hello, World!' }),
    },
  },
})
```

## Data Fetching

There are multiple ways to fetch data in your application. You can use TanStack Query to fetch data from a server. But you can also use the `loader` functionality built into TanStack Router to load the data for a route before it's rendered.

For example:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/people')({
  loader: async () => {
    const response = await fetch('https://swapi.dev/api/people')
    return response.json()
  },
  component: PeopleComponent,
})

function PeopleComponent() {
  const data = Route.useLoaderData()
  return (
    <ul>
      {data.results.map((person) => (
        <li key={person.name}>{person.name}</li>
      ))}
    </ul>
  )
}
```

Loaders simplify your data fetching logic dramatically. Check out more information in the [Loader documentation](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading#loader-parameters).

# Learn More

You can learn more about all of the offerings from TanStack in the [TanStack documentation](https://tanstack.com).

For TanStack Start specific documentation, visit [TanStack Start](https://tanstack.com/start).

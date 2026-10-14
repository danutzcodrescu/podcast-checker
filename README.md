Welcome to your new TanStack Start app!

# Getting Started

To run this application:

```bash
pnpm install
pnpm dev
```

## Git hooks

`pnpm install` installs the Husky pre-commit hook automatically. If dependencies
are already installed, run `pnpm prepare` once to enable it.

Before each commit, the hook runs Oxlint with automatic fixes on staged
JavaScript and TypeScript files, then Oxfmt on staged files it supports. Both
tools respect their existing ignore patterns. Fixes are staged automatically,
unstaged edits are preserved, and remaining lint errors block the commit.

Run `pnpm lint:staged` to run the same checks manually on staged files.
`pnpm check` checks linting and formatting across the project.

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

## Background RSS ingestion and episode embeddings

Following a podcast with an RSS URL atomically creates or links a shared feed
record. The record is a durable outbox: the web request does not fetch RSS, parse
XML, or call the embedding API. A Nitro startup plugin starts a **Node worker
thread inside the app container**, keeping RSS parsing off the web server's event
loop. The thread dispatches outbox records every five seconds into PostgreSQL-backed
**pg-boss** queues. A persistent
once-a-minute dispatch schedule provides a backstop. Due feeds refresh hourly
by default, with conditional HTTP requests when supported.

### Run locally

Use **`docker-compose.dev.yml`** for PostgreSQL only, and run the app on your host
with `pnpm dev`. This file reuses the PostgreSQL service from `docker-compose.yml`
and the existing `postgres18_data` volume without including the app build service.
`pnpm db:setup` selects this development Compose file automatically.

The PostgreSQL service now uses **`pgvector/pgvector:pg18`**. It keeps the existing
`postgres18_data` volume at `/var/lib/postgresql`. Migration
`drizzle/0002_podcast_ingestion.sql` enables the `vector` extension, creates feed,
episode, and embedding tables, and queues feeds already in users' libraries.
pg-boss manages its own `pgboss` schema when the worker starts; it needs no extra
PostgreSQL extension. The database role must be able to create that schema, and
the migration role must be able to enable `vector`.

1. Add your Cloudflare Workers AI credentials to `.env.local`:

   ```dotenv
   CLOUDFLARE_ACCOUNT_ID=your-32-character-account-id
   CLOUDFLARE_API_TOKEN=your-workers-ai-api-token
   ```

   In the Cloudflare dashboard, open **Workers AI → Use REST API** to copy the
   account ID and create a Workers AI API token. The token needs **Workers AI
   Read** and **Workers AI Edit** access to that account. Credentials stay on the
   server; the app calls Cloudflare's REST API directly from your machine or VPS.

2. Upgrade/start PostgreSQL and apply migrations:

   ```bash
   pnpm db:setup
   ```

3. Run the app; it automatically starts the worker thread:

   ```bash
   pnpm dev
   ```

### Deploy to a VPS with Docker Compose

The default **`docker-compose.yml`** runs two services: **`app`** (TanStack Start/Nitro plus the worker thread)
and **`postgres`** (PostgreSQL 18 plus pgvector). There is no separate worker
container. The multi-stage Dockerfile bundles all three Node entry points—web
server, worker, and migrations—into `.output`; the runtime image contains only
the built output and migrations, without source code or development dependencies.

Configure `.env` on the VPS, for example:

```dotenv
POSTGRES_USER=podcast_checker
POSTGRES_DB=podcast_checker
POSTGRES_PASSWORD=replace-with-your-database-password
BETTER_AUTH_SECRET=replace-with-a-long-random-secret
BETTER_AUTH_URL=https://podcasts.example.com
CLOUDFLARE_ACCOUNT_ID=your-32-character-account-id
CLOUDFLARE_API_TOKEN=your-workers-ai-api-token
APP_PORT=3000
```

Then deploy:

```bash
docker compose up -d --build
docker compose logs -f app
```

The app reads `.env` then `.env.local` and connects to `postgres:5432`. Compose
substitution of `POSTGRES_*` and `APP_PORT` uses `.env` or the shell. The app runs
migrations before starting the web server and worker, including on an existing
database volume. Startup fails if migrations fail. Its HTTP port is bound to
`127.0.0.1:3000` on the VPS; point your host reverse proxy (Caddy/nginx) there for
HTTPS, and set `BETTER_AUTH_URL` to the public URL. A containerized reverse proxy
on the same Compose network can use `app:3000` instead.

The supervisor restarts a crashed worker thread with capped exponential backoff.
On shutdown, Nitro requests a graceful worker stop and waits up to 75 seconds;
unfinished jobs remain recoverable through pg-boss. The server's shutdown budget
is 85 seconds and Compose allows 90 seconds. Node 24 is used in Docker; local
execution requires Node 22.19 or newer. Without valid Cloudflare credentials,
episode metadata still imports and the embedding queue consumer is paused;
pending episodes are retained. Recreate the app container after
changing its environment.

For a local production run, execute `pnpm build && pnpm start` from the project
root. This also applies migrations before starting the server. Development uses
a thread-local TypeScript loader; production executes the bundled JavaScript
worker directly. Set `PODCAST_WORKER_ENABLED=false` to disable automatic ingestion
for tests or local debugging (the Playwright server does this). Compose enables
the worker explicitly.

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
- Feed sync and embedding queues deduplicate queued/active work per feed or
  episode. Defaults are **one feed sync and one embedding batch at a time**.
  Transactions import at most 50 episodes, and an embedding batch holds at most
  16 inputs. Every worker polls at bounded intervals rather than spawning a
  task per followed podcast.
- Jobs retry five times with exponential backoff. Failed feed syncs and failed
  embeddings are also eligible for later dispatch. pg-boss heartbeats and job
  expiration recover work after worker crashes. Completed embeddings are skipped
  on redelivery; an interrupted API request may still incur a repeated provider
  call before its result is committed, as with any at-least-once job system.
- The library shows import/embedding progress and the last successful feed
  refresh. **Retry episode import** requests another attempt for a failed show.
- Provider errors retain Cloudflare's numeric error code without raw response
  messages: `3036` identifies an exhausted daily free neuron allowance, while
  `3040` indicates temporary model capacity exhaustion.
- Public HTTP(S) feed fetching validates redirect destinations and resolved IPs
  at connection time, applies time/size limits, and rejects XML document entities.

Configuration (per app container / worker thread):

| Variable                        | Default | Allowed values |
| ------------------------------- | ------- | -------------- |
| `PODCAST_REFRESH_MINUTES`       | `60`    | 1–10080        |
| `PODCAST_FEED_CONCURRENCY`      | `1`     | 1–8            |
| `PODCAST_EMBEDDING_CONCURRENCY` | `1`     | 1–8            |
| `PODCAST_EMBEDDING_BATCH_SIZE`  | `16`    | 1–32           |

Increasing app replicas multiplies embedding API concurrency. Feed and
episode deduplication remains enforced by the database. Model changes or
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
are reset to pending for this one-time provider change. The worker uses a new
Cloudflare embedding queue and retires waiting OpenAI jobs, preserving failed
and completed queue history. Ordinary feed refreshes still skip completed vectors.

For an existing local database, run `pnpm db:migrate` and restart `pnpm dev` after
configuring the two Cloudflare variables. Docker applies the migration before
starting the app automatically. The account does not need an OpenAI key or a
Cloudflare-hosted application; PostgreSQL and the app can remain on your VPS.

### Ingestion tests

`pnpm test` includes parser, normalization, and public-address validation tests.
Run the durable ingestion tests against a dedicated database on the pgvector
service:

```bash
docker compose -f docker-compose.dev.yml exec -T postgres createdb -U podcast_checker podcast_checker_ingestion_test
PODCAST_TEST_DATABASE_URL=postgresql://podcast_checker:podcast_checker@localhost:5432/podcast_checker_ingestion_test pnpm exec vitest run src/lib/podcast-ingestion.integration.test.ts
```

The integration suite applies migrations, uses real PostgreSQL/pgvector and
pg-boss, and mocks RSS/embedding providers to avoid API costs. It checks new-only
embedding, repeated syncs, retries, stale results, conditional requests, archive
retention, unfollowing, and durable queue deduplication. It removes its own test
records and queue schema afterward.

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

## Deploy with Nitro

This project uses Nitro as a generic server adapter, so it can run on any Node-compatible host.

```bash
pnpm build
pnpm start
```

For the VPS deployment, use the Docker Compose instructions above. A manual Node
deployment needs `.output/` and `drizzle/` in the working directory, with database
and API credentials supplied through the environment. The server starts its
background worker thread automatically.

For host-specific presets (Vercel, Netlify, Cloudflare, AWS Lambda, etc.) and tuning, see https://v3.nitro.build/deploy.

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

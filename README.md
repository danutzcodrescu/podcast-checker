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
- `/` is the authenticated Discover page. Its route calls a server function
  protected by `requireAuth` middleware; anonymous visitors go to `/signin`.
- Successful sign-in or sign-up navigates to `/`; sign-out navigates to `/signin`.
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
- Clicking **Following** unfollows the podcast. Existing categories remain available.

Libraries and categories are stored in PostgreSQL and scoped to the authenticated
user. Apply `drizzle/0001_podcast_library.sql` with `pnpm db:migrate` when upgrading
an existing database (or use `pnpm db:setup` to start PostgreSQL and migrate).

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
npm run build
node dist/server/index.mjs
```

The build output is a self-contained Node server. To deploy, push the `dist/` directory to your host (Render, Fly.io, your own VPS, etc.) and run the server command above.

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

The `postgres` service uses PostgreSQL 18, a health check, and the persistent
`postgres18_data` volume mounted at `/var/lib/postgresql`, following the
PostgreSQL 18 image’s storage layout. It listens on `127.0.0.1:5432` with the local development defaults
`podcast_checker` for the database, username, and password.

Set this value in your existing `.env.local`:

```env
DATABASE_URL=postgresql://podcast_checker:podcast_checker@localhost:5432/podcast_checker
```

See `.env.example` for the app’s other environment variables. The app and Drizzle
CLI both load `.env.local` and `.env`, preserving values already set in the
process environment. Compose defaults can be overridden using `POSTGRES_DB`,
`POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_PORT` in your shell or `.env`;
update `DATABASE_URL` to match any overrides.

Start PostgreSQL and run the app:

```bash
docker compose up -d --wait postgres
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

`db:setup` waits for PostgreSQL to become healthy, then runs `db:migrate`.
The initial migration in `drizzle/0000_auth.sql` creates the user, account,
session, and verification tables, including their constraints and indexes.

After changing the schema, generate and apply a new migration:

```bash
pnpm db:generate
pnpm db:migrate
```

Restart the app after changing `.env.local`. Check the database with
`docker compose ps` or `docker compose logs postgres`. Use `docker compose stop`
to stop it while keeping its data.

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

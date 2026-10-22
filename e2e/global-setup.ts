import { execFileSync } from 'node:child_process'

export default function globalSetup() {
  // Build once for all workers. This deliberately cannot reach an application database.
  execFileSync('pnpm', ['build'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: 'postgresql://build:build@127.0.0.1:1/build_only',
    },
  })
}

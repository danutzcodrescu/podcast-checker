import { defineConfig, loadEnv } from 'vite'
import { sentryTanstackStart } from '@sentry/tanstackstart-react/vite'
import { devtools } from '@tanstack/devtools-vite'
import { paraglideVitePlugin } from '@inlang/paraglide-js'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { redact } from '@tanstack/redact/vite'

import viteReact, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import netlify from '@netlify/vite-plugin-tanstack-start'

const config = defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const uploadSourceMaps = Boolean(env.SENTRY_AUTH_TOKEN && env.SENTRY_ORG && env.SENTRY_PROJECT)

  return {
    resolve: { tsconfigPaths: true },
    ssr: { noExternal: true },
    plugins: [
      devtools(),
      paraglideVitePlugin({
        project: './project.inlang',
        outdir: './src/paraglide',
        strategy: ['url', 'baseLocale'],
      }),
      tailwindcss(),
      tanstackStart(),
      netlify({ dev: { edgeFunctions: { enabled: false } } }),
      viteReact(),
      babel({ presets: [reactCompilerPreset()] }),
      redact(),
      sentryTanstackStart({
        org: env.SENTRY_ORG,
        project: env.SENTRY_PROJECT,
        authToken: env.SENTRY_AUTH_TOKEN,
        telemetry: false,
        autoInstrumentMiddleware: false,
        release: { create: uploadSourceMaps, finalize: uploadSourceMaps },
        sourcemaps: { disable: !uploadSourceMaps },
      }),
    ],
  }
})

export default config

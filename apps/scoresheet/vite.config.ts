import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import { VitePWA } from 'vite-plugin-pwa'

const isTauri = !!process.env.TAURI_ENV_PLATFORM
// The web build is served under /qzr/ so verse-vault can take the root of www.versevault.ca.
const webBase = '/qzr/scoresheet/'

export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    ...(!isTauri
      ? [
          VitePWA({
            // Scope, start_url, and the SW base default to Vite's `base` (webBase).
            registerType: 'autoUpdate',
            manifest: {
              name: 'qzr-sheet',
              short_name: 'qzr-sheet',
              description: 'Bible Quiz scoresheet',
              theme_color: '#1a1a2e',
              background_color: '#1a1a2e',
              display: 'standalone',
              // Explicit id: the install identity no longer depends on start_url.
              id: webBase,
              icons: [
                {
                  src: 'pwa-64x64.png',
                  sizes: '64x64',
                  type: 'image/png',
                },
                {
                  src: 'pwa-192x192.png',
                  sizes: '192x192',
                  type: 'image/png',
                },
                {
                  src: 'pwa-512x512.png',
                  sizes: '512x512',
                  type: 'image/png',
                },
                {
                  src: 'maskable-icon-512x512.png',
                  sizes: '512x512',
                  type: 'image/png',
                  purpose: 'maskable',
                },
              ],
            },
            workbox: {
              globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
              navigateFallback: `${webBase}index.html`,
              navigateFallbackAllowlist: [new RegExp(`^${webBase}`)],
            },
          }),
        ]
      : []),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
    __IS_TAURI__: JSON.stringify(isTauri),
    __API_URL__: JSON.stringify(
      process.env.NODE_ENV === 'production'
        ? isTauri
          ? 'https://www.versevault.ca'
          : '/qzr'
        : 'http://localhost:8787',
    ),
  },
  server: { port: 5173 },
  base: isTauri ? '/' : webBase,
  build: {
    outDir: isTauri ? 'dist' : `dist${webBase}`,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
})


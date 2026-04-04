import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import { VitePWA } from 'vite-plugin-pwa'

const isTauri = !!process.env.TAURI_ENV_PLATFORM

export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    ...(!isTauri
      ? [
          VitePWA({
            registerType: 'autoUpdate',
            scope: '/scoresheet/',
            base: '/scoresheet/',
            manifest: {
              name: 'qzr-sheet',
              short_name: 'qzr-sheet',
              description: 'Bible Quiz scoresheet',
              theme_color: '#1a1a2e',
              background_color: '#1a1a2e',
              display: 'standalone',
              start_url: '/scoresheet/',
              scope: '/scoresheet/',
              icons: [
                {
                  src: '/scoresheet/pwa-64x64.png',
                  sizes: '64x64',
                  type: 'image/png',
                },
                {
                  src: '/scoresheet/pwa-192x192.png',
                  sizes: '192x192',
                  type: 'image/png',
                },
                {
                  src: '/scoresheet/pwa-512x512.png',
                  sizes: '512x512',
                  type: 'image/png',
                },
                {
                  src: '/scoresheet/maskable-icon-512x512.png',
                  sizes: '512x512',
                  type: 'image/png',
                  purpose: 'maskable',
                },
              ],
            },
            workbox: {
              globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
              navigateFallback: '/scoresheet/index.html',
              navigateFallbackAllowlist: [/^\/scoresheet/],
            },
          }),
        ]
      : []),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
    __API_URL__: JSON.stringify(
      isTauri
        ? 'https://www.versevault.ca'
        : process.env.NODE_ENV === 'production'
          ? ''
          : 'http://localhost:8787',
    ),
  },
  server: { port: 5173 },
  base: isTauri ? '/' : '/scoresheet/',
  build: {
    outDir: isTauri ? 'dist' : 'dist/scoresheet',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
})


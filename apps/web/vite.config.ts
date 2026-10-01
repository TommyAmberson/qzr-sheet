import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

const isProd = process.env.NODE_ENV === 'production'
// qzr is served under /qzr/ so verse-vault can take the root of www.versevault.ca.
const prefix = '/qzr'

export default defineConfig({
  plugins: [vue(), vueDevTools()],
  define: {
    __SCORESHEET_URL__: JSON.stringify(
      `${isProd ? '' : 'http://localhost:5173'}${prefix}/scoresheet/`,
    ),
    // The API answers at both /qzr/api and /api; dev hits the local root mount.
    __API_URL__: JSON.stringify(isProd ? prefix : 'http://localhost:8787'),
  },
  base: `${prefix}/`,
  build: { outDir: `dist${prefix}` },
  server: { port: 5174 },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})

import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

const isProd = process.env.NODE_ENV === 'production'

export default defineConfig({
  plugins: [vue(), vueDevTools()],
  define: {
    __SCORESHEET_URL__: JSON.stringify(isProd ? '/scoresheet/' : 'http://localhost:5173'),
  },
  server: { port: 5174 },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})

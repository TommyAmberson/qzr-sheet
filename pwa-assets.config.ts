import { defineConfig, minimalPreset } from '@vite-pwa/assets-generator/config'

export default defineConfig({
  preset: {
    ...minimalPreset,
    apple: false,
  },
  images: ['src-tauri/icons/icon.png'],
  outDir: 'public',
})

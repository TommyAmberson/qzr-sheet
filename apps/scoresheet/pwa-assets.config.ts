import { defineConfig } from '@vite-pwa/assets-generator/config'

// The source is the Tauri app icon, a rounded tile with transparent corners.
// Maskable and Apple icons are flattened onto the tile's own colour, so the
// corners blend in rather than showing the generator's default white.
// favicon.ico is not generated here: public/favicon.ico is drawn from
// public/favicon.svg, whose larger letters hold up better at 16px.
const tile = { background: '#1a1816' }

export default defineConfig({
  preset: {
    transparent: {
      sizes: [64, 192, 512],
    },
    // Padding keeps "qzr" inside the circle Android may crop maskable icons to.
    maskable: {
      sizes: [512],
      padding: 0.2,
      resizeOptions: tile,
    },
    apple: {
      sizes: [180],
      padding: 0,
      resizeOptions: tile,
    },
  },
  images: ['public/icon.png'],
})

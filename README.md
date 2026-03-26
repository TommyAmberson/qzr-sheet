# Quizmeet Scoresheet

A digital scoresheet for Quizmeet tournaments. Replaces paper sheets and spreadsheets with a modern,
portable app.

## Development Roadmap

### Phase 0: Foundation (Complete)

* [x] Tauri 2 + Vue 3 + Vite template setup
* [x] Native dev environment (`pnpm tauri dev`)

### Phase 1: Core UI

* [x] Table layout
* [x] Templated result cells (C/E/F)
* [x] Live scoring calculations
* [x] Question highlighting (complete etc.)
* [x] Quiz validation and explanation
* [ ] Overtime support

### Phase 1.5: UX Polish (optional)

* [ ] Tablet-optimized touch UI
* [ ] Drag-drop quizzer reordering
* [ ] Hidden A/B question columns
* [ ] Loading/error states

### Phase 2: Data Management

* [ ] Save results as JSON
* [ ] ODS/LibreOffice import/export
* [ ] Local storage backup

### Phase 3: Quizmeet Integration

* [ ] Quizmeet admin dashboard
* [ ] Load teams/quizzers from API

### Phase 4: Distribution

* [ ] GitHub releases (.exe/.app/.deb/.rpm)
* [ ] PWA manifest + web deployment
* [ ] Auto-updater

## Recommended Browser Setup

* Chromium-based browsers (Chrome, Edge, Brave, etc.):
  * [Vue.js devtools](https://chromewebstore.google.com/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd)
  * [Turn on Custom Object Formatter in Chrome DevTools](http://bit.ly/object-formatters)
* Firefox:
  * [Vue.js devtools](https://addons.mozilla.org/en-US/firefox/addon/vue-js-devtools/)
  * [Turn on Custom Object Formatter in Firefox DevTools](https://fxdx.dev/firefox-devtools-custom-object-formatters/)

## Type Support for `.vue` Imports in TS

TypeScript cannot handle type information for `.vue` imports by default, so we replace the `tsc` CLI
with `vue-tsc` for type checking. In editors, we need
[Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) to make the TypeScript
language service aware of `.vue` types.

## Customize configuration

See [Vite Configuration Reference](https://vite.dev/config/).

## Project Setup

```sh
pnpm i
```

### Compile and Hot-Reload for Development

```sh
pnpm run dev
```

or with backend server:

```sh
pnpm tauri dev
```

### Type-Check, Compile and Minify for Production

```sh
pnpm tauri build
```

### Run Unit Tests with [Vitest](https://vitest.dev/)

```sh
pnpm run test:unit
```

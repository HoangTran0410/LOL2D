import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';
// @ts-expect-error — a build script, deliberately plain .mjs with no types.
import { buildVersion } from './scripts/version.mjs';

const version: string = buildVersion();

export default defineConfig({
  root: '.',
  base: './',
  plugins: [
    vue(),
    VitePWA({
      /**
       * `prompt`, not `autoUpdate`: this is a game, and a service worker that
       * swaps itself in mid-match would reload the page out from under a fight.
       * The new build waits, and `UpdatePrompt.vue` offers it on the menu.
       */
      registerType: 'prompt',
      /**
       * The registration lives in `src/pwa/updates.ts` instead of an injected
       * script, because the prompt above needs the callbacks it returns.
       */
      injectRegister: null,
      /** Referenced by the manifest rather than by index.html, so name them. */
      includeAssets: [
        'favicon/favicon.ico',
        'favicon/favicon-16x16.png',
        'favicon/favicon-32x32.png',
        'favicon/apple-touch-icon.png',
        'favicon/safari-pinned-tab.svg',
      ],
      manifest: {
        name: 'LOL2D',
        short_name: 'LOL2D',
        description: 'Game 2D lấy cảm hứng từ League of Legends, chạy thẳng trong trình duyệt.',
        lang: 'vi',
        theme_color: '#0a1428',
        background_color: '#0a1428',
        display: 'standalone',
        /**
         * The game is landscape. Android honours this for an installed app,
         * which is the one place it can rotate the screen without the
         * fullscreen + `screen.orientation.lock` dance `DomUtils` does; iOS
         * ignores it, and `OrientationHint.vue` covers that.
         */
        orientation: 'landscape',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'favicon/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'favicon/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'favicon/android-chrome-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        /**
         * Everything the game needs to start with no network — including
         * `vendor/`, which is why p5 and stats.js were taken off their CDNs
         * (see `scripts/copy-vendor.mjs`). Champion art is the bulk of it and
         * the reason the precache is a few megabytes: a match that cannot draw
         * its champions offline is not an installed game.
         */
        /**
         * `webp` is here and `jpg` deliberately is not. The menu used to rotate
         * six full-bleed JPEGs, ~1.1MB, and the glob has never listed `jpg`, so
         * they were the one visible thing an offline launch did not have. One
         * 88KB WebP replaces the lot and is cheap enough to precache, which is
         * what makes the installed app look the same with the network off.
         * The three `Screenshot_*.jpg` still in `assets/` stay excluded — they
         * are store art nothing in the game renders.
         */
        globPatterns: ['**/*.{js,css,html,ico,png,webp,svg,json,webmanifest,woff2}'],
        /**
         * `assets/source-manifest.json` is provenance for the wiki importer —
         * 110KB that `scripts/wiki/check-abilities.mjs` reads off disk and no
         * running game ever fetches. It reaches `dist/` only because the asset
         * manifest generator walks all of `assets/`, and the `json` glob above
         * then made every install download it.
         */
        globIgnores: ['**/source-manifest-*.json'],
        /** The menu chunk alone is ~830KB; the default 2MB cap is too tight to trust. */
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        /**
         * Font Awesome is the one thing still on a CDN, deliberately: a missing
         * icon is a missing icon, not a blank screen. Cached on first sight so
         * the second launch has it offline. Opaque cross-origin responses carry
         * a status of 0, hence the explicit allowance.
         */
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cdnjs\.cloudflare\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'cdn-fontawesome',
              expiration: { maxEntries: 24, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        /**
         * Off in dev on purpose. A service worker caching a hot-reloading app
         * turns every "why is my change not showing" into a cache hunt; the
         * build is where this feature is exercised (`npm run preview`).
         */
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  define: {
    __VUE_OPTIONS_API__: true,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
    /**
     * The commit's own clock — `2026.8.17.15.0`. See `scripts/version.mjs` for
     * why it is not `package.json`'s version, and why it is computed here
     * rather than written to a file.
     */
    __APP_VERSION__: JSON.stringify(version),
  },
  assetsInclude: ['**/*.json'],
  build: {
    target: 'esnext',
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        /**
         * Chunks split by **how often they change**, which is what a returning
         * player's cache actually cares about.
         *
         * `assetManifest.ts` is the reason this exists. It is one generated
         * module holding all ~410 asset URLs, and adding a single champion icon
         * rewrites it — which, folded into the entry chunk, meant re-downloading
         * 161KB of application code for one new PNG. On its own it is ~31KB, and
         * nothing else is invalidated with it.
         *
         * Vue and the physics libraries move on their own release schedule
         * rather than with this repo, so they are worth the same treatment: a
         * normal commit no longer touches them at all.
         *
         * The images themselves were never the problem — Vite hashes those on
         * content, so `ahri_q-ViZcqiii.png` keeps its name across builds and the
         * service worker precaches all ~380 of them with `revision: null`,
         * meaning the URL *is* the version and an unchanged file is never
         * re-fetched.
         */
        manualChunks(id) {
          /**
           * `AssetManager` rides with the manifest it wraps. Both are needed
           * before the first frame, both change rarely, and — the reason this
           * line exists — leaving `AssetManager` unassigned let Rollup hoist it
           * into the `game` chunk as a shared module, so the entry imported one
           * binding out of a megabyte and preloaded the lot before the menu
           * could draw.
           */
          if (
            id.includes('src/generated/assetManifest') ||
            id.includes('src/managers/AssetManager')
          ) {
            return 'asset-manifest';
          }
          /**
           * The match itself, in one deliberately-named chunk. Rollup already
           * hoisted it into a shared chunk of its own once `GameScene` and
           * `SetupScene` became dynamic imports, but named it after whichever
           * module happened to lead — `TouchControls-*.js` — which is both
           * meaningless to read and free to change when the module graph
           * shifts. Naming it pins the filename to its contents.
           *
           * It is also the tripwire: nothing on the menu's path may import
           * `src/game/`, or this whole megabyte lands back in front of the logo.
           * `tests/scenes/menuBootPath.test.ts` is that rule.
           */
          if (id.includes('/src/game/')) return 'game';
          if (id.includes('node_modules/@vue/') || id.includes('node_modules/vue/')) {
            return 'vendor-vue';
          }
          if (
            id.includes('node_modules/detect-collisions') ||
            id.includes('node_modules/sat/') ||
            id.includes('node_modules/poly-decomp')
          ) {
            return 'vendor-physics';
          }
          return undefined;
        },
      },
    },
  },
});

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
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json,webmanifest,woff2}'],
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
  },
});

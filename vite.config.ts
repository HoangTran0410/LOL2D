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
           * Dependency-free helpers used on both sides of a scene boundary.
           *
           * Left unassigned, a shared module goes wherever Rollup decides, and
           * it decided `game` for all three — so `MenuScene`'s chunk statically
           * imported the 1.1MB match chunk to get `DomUtils.preventZoom`, and
           * the pregame screen imported it to format a cooldown. One binding
           * each, a megabyte apiece.
           *
           * All three are pure functions with no imports of their own, so this
           * chunk is ~4KB and safe anywhere. `collide.utils` and
           * `optimized.utils` are deliberately excluded: the first pulls
           * poly-decomp, and the second runs on the entry path before p5 loads.
           */
          if (/src\/utils\/(index|format\.utils|dom\.utils)\.ts$/.test(id)) return 'shared';
          /**
           * Vite's own `__vitePreload` runtime, which every dynamic import in
           * the app calls.
           *
           * Unassigned it goes wherever Rollup puts it, and once
           * `spellModules.ts` arrived with 238 dynamic imports in one module,
           * "wherever" became the `game` chunk — so `MenuScene` imported a
           * single helper function out of the match chunk and dragged the whole
           * thing back onto the menu. Exactly the failure the two boot-path
           * tests exist for, and exactly the one they cannot see: the source
           * imports were clean, because this module is not in the source.
           */
          if (id.includes('vite/preload-helper')) return 'shared';
          /**
           * `packAsset` — the cast that lets a pack's own asset key through
           * `AssetManager.get`, typed against core's generated `AssetKey`
           * union. It lives under `src/game/config/`, which the pregame
           * carve-out below would otherwise claim, but `ContentApi.ts`
           * (pinned `game`, by the rule right after this one) imports it
           * too — `Champion.ts` needs the same crossing and cannot import
           * `spellCatalog.ts` to get it without recreating the
           * `Champion.ts -> spellCatalog.ts -> registry.ts -> install.ts ->
           * ContentApi.ts -> Champion.ts` cycle (see `packAsset.ts`'s own
           * header). Left unassigned, this two-line leaf would be hoisted
           * into whichever of `pregame`/`game` Rollup resolves first —
           * exactly the trap `vite/preload-helper` above and the
           * `src/content/` rule below both call out. Its own chunk is
           * cheaper than either duplicating it back into two places or
           * reopening the cycle.
           */
          if (id.includes('src/game/config/packAsset')) return 'shared';
          /**
           * The content pack machinery — `src/content/` and the reference pack
           * under `packs/reference/` — split by whether the file still names
           * `ContentApi.ts` as a *value*, ahead of the pregame carve-out and
           * the generic `/src/game/` rule below.
           *
           * Batch 2 pinned this whole directory to `game`, because
           * `spellCatalog.ts` read the roster and display data through
           * `contentRegistry()` (`registry.ts`), and that module's own
           * dependency chain — `install.ts` -> `ContentApi.ts` — statically
           * imported the ~80 real engine modules a content pack needs to
           * build real spell classes (24 buffs, the combat and vfx helpers,
           * the spell-object base classes: see `ContentApi.ts`'s own
           * header). Left unassigned, that chain was reachable from *both*
           * `pregame` (via `spellCatalog.ts`) and `game` (via
           * `spellRegistry.ts`), and Rollup's cycle resolution for that
           * shape folded the whole chain, engine imports included, into
           * `pregame`: `DamageReflect`, `TrueSight`, `ParticleSystem` and
           * `MissileSpellObject` all measurably moved chunks that way.
           *
           * Batch 3 is the fix the old comment here said batch 2 was
           * deferring: the pack contract split into a data half
           * (`ContentPackData` — manifest, champions, spell display, maps)
           * and a code half (`ContentPackCode` — spells), and `install.ts`
           * no longer value-imports `ContentApi.ts` at all — `registry.ts`
           * builds the api and hands it in as a parameter instead. That
           * leaves exactly two files in this directory that still reach
           * `ContentApi.ts` as a value: `ContentApi.ts` itself, and
           * `registry.ts`, whose `contentRegistry()` is the one place that
           * calls `buildContentApi()`. Every other file here — `catalog.ts`,
           * `install.ts`, `PackRegistry.ts`, `validate.ts`, `ContentPack.ts`,
           * `bundledPack.ts`, and all of `packs/reference/` (its spell files
           * take `ContentApi` as a *parameter* of their exported factory,
           * never an import — `tests/content/contentApiChunk.test.ts` walks
           * this exact closure) — never names the engine surface, so pinning
           * them to `pregame` no longer drags it along. `spellCatalog.ts`
           * and `pregameCatalog.ts` were moved onto `contentCatalog()`
           * (`catalog.ts`) for the same reason: they only ever read data.
           *
           * The one edge this does not close: `registry.ts` (`game`) still
           * imports `catalog.ts` (`pregame`) for the shared registry
           * instance — a `game -> pregame` edge, required, since installing
           * the code half means completing the same `PackRegistry` the data
           * half already built. `preset.ts`'s pre-existing `CHAMPION_KITS`
           * import is the other one, unrelated to content and not this
           * batch's to change. Both run the same direction, so — unlike
           * batch 2 — there is no longer a `pregame -> game` edge to close
           * the cycle: `vite build` no longer prints `Circular chunk:
           * pregame -> game -> pregame`.
           *
           * **Whoever writes batch 4's chunk rule: `pregame` now carries real
           * spell-behaviour code, not just data.** `packs/reference/` is
           * pinned here as a whole file per module, and a pack's own file —
           * `packs/reference/spells/Vera_Q.ts` and its three siblings — mixes
           * the tuning constants `data.spellDisplay` needs with the
           * `onHit`/`draw`/damage logic only `code` ever calls; Vite cannot
           * split one file's exports across two chunks, so the whole thing
           * rides along. Measured at ~3.9KB for the reference pack's four
           * spells — harmless, and the reason `scripts/check-chunks.mjs`'s
           * engine-leak check now requires the `Name:` object-literal-key
           * shape rather than a bare substring match (a `class extends
           * api.MissileSpellObject` property access in exactly this file
           * tripped the old, looser check). **It would not be harmless at
           * 240** — the Riot pack batch 4 moves into `packs/riot/`. Pinning
           * that whole directory here the same way would put every spell's
           * real implementation into the chunk the menu downloads first,
           * which is precisely the regression this task closed, reopened
           * from a different file. Batch 4's pack will need its `data` and
           * `code` kept in genuinely separate files (or its own manualChunks
           * rule that pins spell implementation files to `game` regardless
           * of which pack directory they live under) — do not pin it here by
           * analogy with `packs/reference/`.
           */
          if (id.includes('/src/content/ContentApi') || id.includes('/src/content/registry')) {
            return 'game';
          }
          if (id.includes('/src/content/') || id.includes('/packs/reference/')) return 'pregame';
          /**
           * The pregame screen's data layer, carved out of `src/game/` ahead of
           * the `game` rule below.
           *
           * These modules sit under `src/game/` because that is what they are
           * *about* — a match's config, its saved kits, its spell catalogue,
           * its touch settings — but none of them can execute anything. The
           * rule below is a path test, so without this carve-out the setup
           * screen importing `PregameConfig` was enough to pull the megabyte:
           * `SetupScene` reached `preset.ts`, `preset.ts` reached
           * `import * as AllSpells`, and rendering a roster of names and icons
           * loaded all 238 spell modules.
           *
           * `config/spellCatalog.ts` is the piece that made this possible —
           * generated display data instead of 238 constructors. See its header,
           * and `tests/scenes/pregameBootPath.test.ts`, which is what stops
           * a single stray import putting it all back.
           */
          if (
            id.includes('src/game/config/') ||
            id.includes('src/game/constants') ||
            id.includes('src/game/input/touchPreferences') ||
            id.includes('src/generated/spellCatalog') ||
            // The picker components themselves. They are *shared* — the in-game
            // practice panel opens the same `LoadoutEditorModal` — and a shared
            // module goes wherever Rollup puts it, which was `game`. So the
            // setup screen was importing its own roster back out of the match.
            // Pinned to the side that can stand alone; the game chunk depends
            // on this one anyway, through `PregameConfig`.
            id.includes('src/scenes/setup/') ||
            // The match-config panel, which is now mounted in *both* places —
            // over the menu and over a running match — so it is shared exactly
            // the way the picker above it is, and would otherwise be hoisted
            // into `game` and dragged back onto the menu.
            //
            // `MatchDirectorSource` is the deliberate exception and the whole
            // point of the seam: it is the only file in that directory that
            // touches `MatchDirector`, `AIChampion` and `Camera`, so it belongs
            // to the match. `tests/scenes/matchConfigChunk.test.ts` is what
            // keeps the rest of the directory able to live out here.
            (id.includes('src/game/hud/config/') && !id.includes('MatchDirectorSource'))
          ) {
            return 'pregame';
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
          /**
           * One chunk per champion, so a match fetches the kits it is playing.
           *
           * `preset.ts` no longer imports the spell barrel; `spellModules.ts`
           * holds a dynamic import per id and `spellRegistry.ts` pulls the ones
           * a `MatchPlan` names. Rollup would otherwise emit 238 chunks — one
           * per file — which is 238 requests for a six-champion match. Grouping
           * by the filename's champion prefix makes it one request per champion,
           * and each champion's files are an island: only `spells/index.ts` ever
           * imported across them, and nothing imports that any more.
           *
           * It also fixes the cache granularity the old single chunk had:
           * retuning one ability used to invalidate all 295KB (gzipped) of the
           * game chunk for every returning player.
           */
          // `coreSpells/` is core and falls through to the `game` chunk below;
          // only the content directory is chunked per champion.
          //
          // `Recall` is the one content file that is not per-champion: it
          // presupposes a fountain, not a kit, so it moved back to `spells/`
          // (see that file's own header) — but `preset.ts` still imports it
          // eagerly for every match this batch, exactly like `BasicAttack`.
          // Left to the regex below it would land in its own `spell-common`
          // chunk that nothing ever *dynamically* imports, which is exactly
          // the static edge `chunks:check`'s `game` rule exists to catch.
          // Carved out ahead of the regex so it bundles with `game` instead.
          if (id.endsWith('src/game/gameObject/spells/Recall.ts')) return 'game';
          const spell =
            /src\/game\/gameObject\/spells\/([A-Za-z0-9]+?)(?:_[QWER][0-9]*)?\.ts$/.exec(id);
          if (spell) {
            // Summoner spells and the basic attack have no champion prefix to
            // group by, and every kit can hold them — one shared chunk rather
            // than six chunks of one file.
            const champion = /_[QWER][0-9]*\.ts$/.test(id) ? spell[1].toLowerCase() : 'common';
            return `spell-${champion}`;
          }
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

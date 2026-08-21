/**
 * The installed app's update channel.
 *
 * A service worker gives the game two things it did not have: it opens with no
 * network, and it can tell the player a newer build exists. The second is only
 * useful because of the first — a cached app will happily serve last month's
 * build forever, and without a prompt the player has no way to know and no
 * gesture that would fix it. "Hard refresh" is not an answer on a phone.
 *
 * `registerType: 'prompt'` in `vite.config.ts` is what makes this a decision
 * rather than an event: the new worker installs and then *waits*. Nothing
 * reloads until `applyUpdate()` is called, because a reload mid-match is worse
 * than a stale build. `MenuScene.vue` puts that choice on the menu, which
 * is the one screen where losing the page costs nothing.
 *
 * Deliberately a plain module with a Vue `ref`, not a component or a composable:
 * registration happens once for the whole page, well before any scene mounts,
 * and every scene that comes and goes has to read the *same* answer. See the
 * `<script setup>` note in CLAUDE.md for why that cannot live in a component.
 *
 * **Why `updateReady` alone used to take 10-20 seconds to light up.** The
 * browser's own registration check is fast — `navigator.serviceWorker.register()`
 * fetches `sw.js` and byte-compares it essentially immediately, measured under
 * a second. What actually takes the time is what happens *after* a difference
 * is found: `workbox-precaching` downloads every changed precache entry one at
 * a time, deliberately serial —
 * https://github.com/GoogleChrome/workbox/issues/2528 — and only fires the
 * `installed`/"waiting" transition `updateReady` waits for once every last one
 * has landed. A real deploy here commonly touches a few dozen files (every
 * per-champion `spell-*.js` chunk imports the shared `game` chunk by its
 * hashed filename, so *any* change under `src/game/` changes that filename and
 * cascades into invalidating every spell chunk's own hash, even when no spell
 * itself changed a line — see the report). Measured against a real two-commit
 * gap (65 changed files, ~1.2MB) on a throttled connection: ~19.4 seconds from
 * reopening the app to `updateReady` — squarely in the reported range, and
 * long after a player already pressed Play.
 *
 * `updateDownloading` is the fast half fixing that: `updatefound` on the
 * registration — the same signal that starts the slow download above — fires
 * within about a second of opening the app, well before the download
 * finishes. It cannot safely stand in for `updateReady` (pressing "cập nhật"
 * on a build that has not finished downloading has nothing to skip-wait to),
 * but it can tell the player "an update exists and is on its way" as soon as
 * that is actually known, instead of only once it is fully ready.
 */
import { ref } from 'vue';

/** A newer build is installed and waiting for permission to take over. */
export const updateReady = ref(false);

/**
 * A newer build has been detected on the server and is downloading in the
 * background — set from `updatefound`, well before `updateReady`. See the
 * header comment above for why the two are seconds apart rather than the
 * same event twice.
 */
export const updateDownloading = ref(false);

/** The app has been cached and will now open without a network. */
export const offlineReady = ref(false);

/** Set by `registerServiceWorker`; null until then, and on browsers without one. */
let applyWaitingUpdate: ((reload?: boolean) => Promise<void>) | null = null;

/**
 * How often to ask the server whether a newer build exists.
 *
 * The browser checks on its own when the page loads and roughly daily after
 * that, which for a game someone leaves open in a tab means "never". An hour
 * is frequent enough that a fix lands the same session and rare enough to be
 * invisible: it is one conditional request for a file of a few kilobytes.
 */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * How long `updateDownloading` is allowed to stay lit without the install it
 * is reporting on ever reaching `installed` or `redundant`.
 *
 * Nothing about the real update is gated on this — `updateReady` still
 * follows the worker's own state regardless. This only stops the "đang tải
 * bản cập nhật" message from hanging on screen forever if a connection
 * stalls mid-download without the browser ever declaring the attempt
 * `redundant` itself.
 */
export const UPDATE_DOWNLOAD_STALL_MS = 2 * 60 * 1000;

/**
 * A minimal shape for the installing worker: just enough to watch it finish,
 * so this can be exercised in Vitest with a plain fake instead of a real
 * `ServiceWorker` (which, like the rest of this module's browser API surface,
 * does not exist in a Node test run).
 */
interface InstallingWorkerLike {
  readonly state: string;
  addEventListener(type: 'statechange', listener: () => void): void;
}

/**
 * Lights `updateDownloading` for as long as `installing` is still installing,
 * and turns it back off the moment that worker either finishes
 * (`installed`/`redundant`) or `UPDATE_DOWNLOAD_STALL_MS` gives up on it.
 *
 * Split out from `registerServiceWorker` because it is the one piece of this
 * file with real branching to get right, and — unlike the registration call
 * around it — needs nothing from `virtual:pwa-register` to test.
 */
export function trackDownloadingUpdate(
  installing: InstallingWorkerLike,
  setTimeoutFn: typeof setTimeout = setTimeout,
  clearTimeoutFn: typeof clearTimeout = clearTimeout
): void {
  updateDownloading.value = true;
  const giveUp = setTimeoutFn(() => {
    updateDownloading.value = false;
  }, UPDATE_DOWNLOAD_STALL_MS);
  installing.addEventListener('statechange', () => {
    if (installing.state === 'installed' || installing.state === 'redundant') {
      clearTimeoutFn(giveUp);
      updateDownloading.value = false;
    }
  });
}

/**
 * Registers the worker and starts the update poll.
 *
 * Safe to call anywhere — it no-ops in a browser without service workers, on
 * `http://` origins other than localhost (where they are forbidden outright),
 * and in dev, where `devOptions.enabled` is false and the virtual module
 * registers nothing.
 */
export async function registerServiceWorker(): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  // Dynamic, and the string is deliberately not extracted to a constant: this
  // is a Vite virtual module, resolved at build time, and it does not exist in
  // a plain Node/Vitest run. Importing it at module scope would take the whole
  // HUD's test suite down with it.
  const { registerSW } = await import('virtual:pwa-register');

  applyWaitingUpdate = registerSW({
    onNeedRefresh() {
      updateReady.value = true;
      updateDownloading.value = false;
    },
    onOfflineReady() {
      offlineReady.value = true;
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;

      // `updatefound` is the fast signal — see the header comment. Only
      // worth surfacing as "an update exists" when something is already
      // controlling the page: a bare `installing` worker with no controller
      // is the very first install, which is `onOfflineReady`'s story, not an
      // update to anything the player has already opened.
      const watchInstallingWorker = (): void => {
        const installing = registration.installing;
        if (!installing || !navigator.serviceWorker.controller) return;
        trackDownloadingUpdate(installing);
      };
      // The install this very `register()` call kicked off can already be
      // under way by the time this callback runs, so check once immediately
      // in addition to listening for the next one.
      registration.addEventListener('updatefound', watchInstallingWorker);
      watchInstallingWorker();

      setInterval(() => {
        // Offline, `update()` rejects; that is the expected case for an
        // installed app and says nothing worth reporting.
        registration.update().catch(() => {});
      }, UPDATE_CHECK_INTERVAL_MS);
    },
  });
}

/**
 * Hands over to the waiting build and reloads.
 *
 * The reload is the worker's, not ours: `registerSW`'s callback posts
 * SKIP_WAITING and reloads once the new worker has actually taken control, so
 * the page that comes back is the new one rather than the old one served from
 * a cache mid-swap.
 */
export async function applyUpdate(): Promise<void> {
  updateReady.value = false;
  await applyWaitingUpdate?.(true);
}

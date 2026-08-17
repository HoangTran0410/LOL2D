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
 * than a stale build. `UpdatePrompt.vue` puts that choice on the menu, which
 * is the one screen where losing the page costs nothing.
 *
 * Deliberately a plain module with a Vue `ref`, not a component or a composable:
 * registration happens once for the whole page, well before any scene mounts,
 * and every scene that comes and goes has to read the *same* answer. See the
 * `<script setup>` note in CLAUDE.md for why that cannot live in a component.
 */
import { ref } from 'vue';

/** A newer build is installed and waiting for permission to take over. */
export const updateReady = ref(false);

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
    },
    onOfflineReady() {
      offlineReady.value = true;
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
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

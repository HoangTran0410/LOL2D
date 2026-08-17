<script setup lang="ts">
/**
 * "Turn the phone sideways."
 *
 * The only thing a browser can do about orientation on an iPhone. Chrome on
 * Android has `screen.orientation.lock`, which `DomUtils.goFullscreen` chains
 * onto its fullscreen request — so there, the fullscreen button in the
 * practice panel *is* the auto-rotate. iOS Safari has neither that API nor the
 * Fullscreen API at all, so there is nothing to call and this is the whole
 * answer. It earns its place on Android too: a player who never presses
 * fullscreen never gets the lock either.
 *
 * Only in touch mode, never on a merely narrow desktop window: `hud.touchUi`
 * is the same flag the rest of the HUD switches on, and a tall browser window
 * on a laptop reports `orientation: portrait` while being perfectly playable.
 *
 * **Dismissable on purpose.** A phone with rotation locked in its OS settings
 * physically cannot answer this prompt, and an overlay it cannot clear is a
 * game that will not start. So the hint is a request, not a gate — the player
 * can wave it off and keep playing in portrait for the rest of the match. It
 * does not come back on the next rotation because the flag outlives them: this
 * component stays mounted and switches its own contents, rather than being
 * `v-if`'d from the parent, which would rebuild the flag every time the phone
 * turned. (See the `<script setup>` note in CLAUDE.md — top-level state here
 * is per *mount*, and a mount is exactly what a parent `v-if` costs you.)
 */
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue';
import type { HudInteractions } from './hudInteractions';

const hud = inject<HudInteractions>('hud')!;

const portrait = ref(false);
const dismissed = ref(false);

const visible = computed(() => hud.touchUi && portrait.value && !dismissed.value);

let query: MediaQueryList | null = null;

const syncOrientation = (): void => {
  portrait.value = Boolean(query?.matches);
};

onMounted(() => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  query = window.matchMedia('(orientation: portrait)');
  syncOrientation();
  // `addListener` is the deprecated spelling, still the only one Safari below
  // 14 has — and old iOS is exactly the audience for this component.
  if (query.addEventListener) query.addEventListener('change', syncOrientation);
  else (query as MediaQueryList).addListener(syncOrientation);
});

onBeforeUnmount(() => {
  if (!query) return;
  if (query.removeEventListener) query.removeEventListener('change', syncOrientation);
  else (query as MediaQueryList).removeListener(syncOrientation);
});
</script>

<template>
  <div v-if="visible" class="orientation-hint">
    <div class="orientation-hint-card">
      <i class="fas fa-mobile-screen-button" aria-hidden="true"></i>
      <p class="orientation-hint-title">Xoay ngang máy để chơi</p>
      <p class="orientation-hint-note">
        Bật <strong>Toàn màn hình</strong> trong bảng luyện tập để máy tự xoay và giữ ngang.
      </p>
      <button
        type="button"
        class="orientation-hint-dismiss"
        id="orientation-hint-dismiss"
        @click="dismissed = true"
        @touchend.prevent="dismissed = true"
      >
        Vẫn chơi dọc
      </button>
    </div>
  </div>
</template>

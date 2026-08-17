<script setup lang="ts">
/**
 * The HUD app's root component: the corner control, plus a switch between
 * `DesktopHudView` and `MobileHudView` on `hud.touchUi` — the same flag
 * `Game.applyTouchUiClass` uses, not a viewport breakpoint (see
 * `styles/hud.css`'s "Touch layout" section for why).
 *
 * There used to be a second, always-visible button here — an in-game
 * mouse/touch mode toggle. It moved to the pregame setup screen's Settings
 * tab: a global preference a player sets roughly once does not earn
 * permanent on-screen real estate, doubly so right after the bottom-HUD
 * strip came out specifically to reclaim screen space. See
 * `TouchControls.ts`'s `touchModePreference`/`setTouchModePreference` for
 * the tri-state ('auto' | 'touch' | 'pointer') that setting now reads and
 * writes, and `?touch=1` for how this HUD's own touch-mode e2e coverage
 * keeps working without that button — the query parameter resolves ahead of
 * the stored preference, independent of any UI control.
 *
 * The one control left is the way into the practice panel, and it renders in
 * both modes. It started touch-only, because `MobileHudView` has no
 * bottom-HUD strip (each equipped icon is its own tap target into the panel)
 * while `DesktopHudView` still does. But the strip's icons open the panel
 * *pre-aimed at one slot* — they are a shortcut into it, not an announcement
 * that it exists, and a mouse player who never thought to click their own
 * spell bar had no way to find the panel at all. So: same button, same entry
 * point, both modes. It still hides behind the panel itself, which occupies
 * the same corner.
 *
 * `hud` (the shared `HudInteractions`, created once per game) arrives as a
 * prop from `InGameHUD.ts` rather than being constructed here, because it
 * needs the `Game` instance the lifecycle wrapper owns. It is `provide()`d
 * from here so `DesktopHudView`, `MobileHudView` and the practice panel can
 * all `inject('hud')` the same reactive object instead of three independent
 * copies that could drift.
 *
 * `state` (the read-only `HudState` snapshot) is *not* a prop: it changes on
 * every tick of `InGameHUD.ts`'s 20Hz loop, well after this component has
 * mounted, so it lives in local state and is pushed in through `setState`,
 * exposed below for the lifecycle wrapper to call.
 */
import { provide, ref } from 'vue';
import type { HudInteractions } from './hudInteractions';
import type { HudState } from './hudState';
import DesktopHudView from './DesktopHudView.vue';
import MobileHudView from './MobileHudView.vue';
import OrientationHint from './OrientationHint.vue';

const props = defineProps<{ hud: HudInteractions }>();

provide('hud', props.hud);

const state = ref<HudState | null>(null);

/**
 * Exposed so `InGameHUD.ts` can drive the screen and so the e2e scripts
 * (`tests/e2e/drive-mobile-hud.mjs`, `drive-touch-controls.mjs`) can reach
 * `hud` off `game.inGameHUD.vueInstance.hud` the same way they always have —
 * that property is load-bearing for those scripts, not incidental.
 */
defineExpose({
  hud: props.hud,
  setState: (next: HudState | null) => {
    state.value = next;
  },
});
</script>

<template>
  <!-- Hidden behind the panel: it lives in the top-right corner too (its
       own close button), and this would otherwise sit on top of it — the
       only way out of the modal. -->
  <button
    v-if="!hud.showSpellsPicker"
    class="corner-btn spell-picker-btn"
    @click="hud.openSpellPicker()"
    @touchend.prevent="hud.openSpellPicker()"
    title="Bảng luyện tập"
  >
    <i class="fa-solid fa-wand-magic-sparkles"></i>
  </button>

  <DesktopHudView v-if="state && !hud.touchUi" :state="state" />
  <MobileHudView v-if="state && hud.touchUi" />

  <!-- Unconditional on purpose: it decides for itself whether to show, and a
       `v-if` here would remount it — and reset its dismissal — on every turn
       of the phone. -->
  <OrientationHint />
</template>

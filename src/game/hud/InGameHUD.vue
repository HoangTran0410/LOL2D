<script setup lang="ts">
/**
 * The HUD app's root component: the always-visible touch/mouse mode toggle,
 * plus a switch between `DesktopHudView` and `MobileHudView` on `hud.touchUi`
 * — the same flag the on-screen toggle and `Game.applyTouchUiClass` already
 * use, not a viewport breakpoint (see `styles/hud.css`'s "Touch layout"
 * section for why).
 *
 * `hud` (the shared `HudInteractions`, created once per game) arrives as a
 * prop from `InGameHUD.ts` rather than being constructed here, because it
 * needs the `Game` instance the lifecycle wrapper owns. It is `provide()`d
 * from here so `DesktopHudView`, `MobileHudView` and `SpellPickerModal` can
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
  <!-- Hidden behind the picker: both live in the top-right corner, and the
       toggle would otherwise sit on top of the picker's close button, which
       is the only way out of it. -->
  <button
    v-if="!hud.showSpellsPicker"
    class="touch-toggle"
    :class="hud.touchUi ? 'on' : ''"
    @click="hud.toggleTouchUi()"
    @touchend.prevent="hud.toggleTouchUi()"
    :title="hud.touchUi ? 'Chuyển sang chuột và bàn phím' : 'Chuyển sang điều khiển cảm ứng'"
  >
    <i class="fa-solid fa-gamepad"></i>
  </button>

  <DesktopHudView v-if="state && !hud.touchUi" :state="state" />
  <MobileHudView v-if="state && hud.touchUi" :state="state" />
</template>

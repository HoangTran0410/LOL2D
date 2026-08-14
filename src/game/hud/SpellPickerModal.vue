<script setup lang="ts">
/**
 * The "pick a spell" modal. One component, shared by `DesktopHudView` and
 * `MobileHudView` — the loadout it lets you assemble is the same game feature
 * in both modes, and CSS alone (`body.touch-ui .spell-picker` in
 * `styles/hud.css`) already does the resizing a phone needs. Forking this
 * into two copies would just be two places to keep the champion roster
 * markup in sync for no reason.
 *
 * What *is* mode-specific is reachability, and all of it is handled here:
 *
 *   - every actionable element binds both `@click` (the mouse) and a
 *     touch-native handler (see `hudInteractions.ts`'s file comment for why
 *     `click` alone does not fire under a real thumb);
 *   - the list scrolls by hand (`scrollTouchStart`/`scrollTouchMove`) because
 *     the same reason click is suppressed — `GameScene`'s canvas-wide
 *     `preventDefault()` on touch — also suppresses the browser's native
 *     touch-scroll, everywhere on the page, not just on the canvas.
 *
 * The close button sits in a `.close-btn-anchor` — a zero-height,
 * `position: sticky` wrapper — rather than directly in `.spell-picker`.
 * It used to be a plain `position: absolute` child of the scrolling
 * `.spell-picker` itself, which meant scrolling down through the roster
 * scrolled the close button away with it: the one way out of the modal
 * became unreachable exactly when a long roster gave a player the most
 * reason to want it. Caught by driving a real scroll gesture in
 * `tests/e2e/drive-mobile-hud.mjs` and then trying to tap the button
 * afterwards, not by reading the markup.
 *
 * A first fix split the modal into a fixed shell plus a `flex: 1 1 0`
 * scrolling body — the standard "sticky header" flex pattern. It does not
 * work here: `.spell-picker`'s height is `max-height`-capped but otherwise
 * intrinsic (auto), and `flex-grow` only has space to distribute once a flex
 * container is *already* pinned to a size larger than its content demands.
 * With nothing forcing that, the `flex-basis: 0` body resolved to zero
 * height and the whole list disappeared — worse than the bug it was meant to
 * fix, and only visible by actually loading the page, not from the CSS
 * alone. `position: sticky` sidesteps the whole question: it needs nothing
 * from its container but *a* scrolling ancestor, which `.spell-picker`
 * (unchanged, still just `overflow-y: auto` on itself) already is.
 *
 * The slot selector (`.slot-picker`, touch-ui only) is the other mode-
 * specific piece. On the desktop it is redundant — the bottom-HUD strip has
 * one tap target per equipped spell, so which slot you are replacing is
 * already decided by which icon you clicked before the picker even opened.
 * That strip does not exist in touch mode any more (see `InGameHUD.vue`),
 * so its one entry point — the corner button, `hud.openSpellPicker()` —
 * cannot know which slot the player wants either. This row is how they
 * choose, without leaving the modal.
 */
import { inject } from 'vue';
import type { HudInteractions } from './hudInteractions';
import type { HudState } from './hudState';

defineProps<{ state: HudState }>();

const hud = inject<HudInteractions>('hud')!;

let scrollTouchId: number | null = null;
let scrollStartY = 0;
let scrollStartTop = 0;

function scrollTouchStart(event: TouchEvent): void {
  const touch = event.touches[0];
  if (!touch) return;
  scrollTouchId = touch.identifier;
  scrollStartY = touch.clientY;
  scrollStartTop = (event.currentTarget as HTMLElement).scrollTop;
}

function scrollTouchMove(event: TouchEvent): void {
  const touch = [...event.touches].find(t => t.identifier === scrollTouchId);
  if (!touch) return;
  const dy = touch.clientY - scrollStartY;
  (event.currentTarget as HTMLElement).scrollTop = scrollStartTop - dy;
}
</script>

<template>
  <div class="spell-picker" @touchstart="scrollTouchStart" @touchmove="scrollTouchMove">
    <img alt="background" class="background-picker" :src="hud.backgroundPicker ?? undefined" />
    <div class="close-btn-anchor">
      <button
        class="close-btn"
        @click="hud.closeSpellPicker()"
        @touchend.prevent="hud.closeSpellPicker()"
      >
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
    <p class="title">Chọn chiêu thức</p>

    <!-- Touch-only: picks which equipped slot the tap below will replace.
         See the file comment for why this only exists in touch mode. -->
    <div class="slot-picker" v-if="hud.touchUi">
      <button
        v-for="(spell, index) of state.spells"
        :key="index"
        type="button"
        class="slot-pill"
        :class="{ active: hud.spellIndexToSwap === index }"
        @click="hud.spellIndexToSwap = index"
        @touchend.prevent="hud.spellIndexToSwap = index"
      >
        <img :src="spell.image" alt="spell" />
        <span class="slot-pill-key">{{ spell.hotKey }}</span>
      </button>
    </div>

    <p>
      Chế độ (mới):
      <span class="tooltip">
        <input
          type="checkbox"
          id="oneForAll"
          :checked="hud.oneForAll"
          @click="hud.oneForAll = !hud.oneForAll"
          @touchend.prevent="hud.oneForAll = !hud.oneForAll"
        />
        <label for="oneForAll">ONE spell for ALL</label>
        <span class="tooltiptext">Tất cả đều chỉ dùng 1 chiêu thức</span>
      </span>

      <span class="tooltip">
        <input
          type="checkbox"
          id="cloneMySpell"
          :checked="hud.cloneMySpell"
          @click="hud.cloneMySpell = !hud.cloneMySpell"
          @touchend.prevent="hud.cloneMySpell = !hud.cloneMySpell"
        />
        <label for="cloneMySpell">Clone my spells</label>
        <span class="tooltiptext">Tất cả đều dùng bộ chiêu thức giống bạn</span>
      </span>
    </p>

    <div class="list">
      <div
        class="group"
        v-for="group of hud.spellGroups"
        :key="group.name"
        @mouseover="hud.mouseoverGroup(group)"
      >
        <div class="group-header">
          <img v-if="group.image" :src="group.image" alt="spell" />
          <p>{{ group.name }}</p>
        </div>
        <div
          v-for="spell of group.spells"
          :key="spell.name"
          class="spell"
          @click="hud.pick(spell)"
          @mouseover="hud.mouseover(spell, $event)"
          @mouseout="hud.mouseout(spell)"
          @touchstart="hud.touchSpellStart(spell, $event)"
          @touchmove="hud.touchSpellMove($event)"
          @touchend.prevent="hud.touchSpellEnd(() => hud.pick(spell))"
          @touchcancel="hud.cancelLongPress()"
        >
          <img :src="spell.image" alt="spell" />
        </div>
      </div>
    </div>

    <div class="change-logs">
      <p class="title">Lịch sử cập nhật</p>

      <p>2024-09-12:</p>
      <ul>
        <li>MỚI: Graves W - Bom mù</li>
        <li>MỚI: Cơ chế giảm tầm nhìn</li>
        <li>CẬP NHẬT: Teemo R nay có thể nảy</li>
        <li>CẬP NHẬT: Giảm thời gian đợi Q2 của yasuo - tích cộng dồn nhanh hơn</li>
        <li>Cập nhật hình ảnh các bộ chiêu thức</li>
      </ul>
    </div>
  </div>
</template>

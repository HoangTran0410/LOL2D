<script setup lang="ts">
/**
 * The "pick a spell" screen — the Chiêu thức tab of `PracticePanel.vue`, and
 * no longer a modal in its own right. The panel owns the framing (the fixed
 * centred `.practice-panel` box, its hextech border, the tab bar that names
 * this tab); `.spell-picker` kept `overflow-y: auto` and is still the element
 * that scrolls. That division is load-bearing, not tidiness — see the sticky
 * header note below.
 *
 * One component, shared by `DesktopHudView` and `MobileHudView` (through the
 * panel) — the loadout it lets you assemble is the same game feature in both
 * modes, and CSS alone (`body.touch-ui .spell-picker` in `styles/hud.css`)
 * already does the resizing a phone needs. Forking this into two copies would
 * just be two places to keep the champion roster markup in sync for no
 * reason.
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
 * The slot row lives in a `position: sticky` `.picker-header`, so it stays
 * pinned to the top while the roster scrolls beneath it. `position: sticky`
 * needs nothing from its container but *a* scrolling ancestor, which
 * `.spell-picker` (just `overflow-y: auto` on itself) already is — a flex
 * "sticky header" shell was tried first and silently collapsed the list,
 * because `.spell-picker`'s height was `max-height`-capped but otherwise
 * intrinsic, so a `flex: 1 1 0` body had no pinned size to grow into.
 * Keeping the slot row on screen matters most: it is where you choose which
 * slot to replace and (now) the way out, so scrolling a long roster must not
 * carry it off. Regressions here are caught by scrolling for real in
 * `tests/e2e/drive-mobile-hud.mjs`, not by reading the markup.
 *
 * The tab shell does *not* repeat that mistake, and is the other shape of it:
 * the flex column is `.practice-panel`, one level up, and `.spell-picker` is
 * a `flex: 1 1 auto; min-height: 0` item inside it. `flex-basis: auto` means
 * its hypothetical size is still its (huge) content height, so the panel
 * grows to its own `max-height` and the picker shrinks into what is left —
 * ending up with a *definite* height to scroll inside, which is exactly what
 * the collapsed version never had.
 *
 * The title row that used to sit above the slot row is gone: the tab bar's
 * selected "Chiêu thức" says the same thing, and on a landscape phone two
 * rows of chrome above the roster costs a shelf.
 *
 * The slot selector (`.slot-picker`) is shown in both modes now. The desktop
 * bottom-HUD strip still pre-selects a slot by which icon opened the picker,
 * but picks are batched — you can retarget a different slot and try another
 * spell any number of times before committing — so the in-modal row has to be
 * there on the desktop too, not just as the touch corner button's only way to
 * choose a slot. Each pill previews the *staged* choice (`hud.draftSpells`)
 * over what is currently equipped. The Huỷ / Xác nhận buttons sit at the end
 * of this same row rather than a separate footer, to spend as little vertical
 * space on chrome as possible — "Huỷ" is also the only close affordance now
 * (the old corner X was redundant with it).
 *
 * Nothing is applied to the game on a pick any more: `hud.pick` only stages
 * into `draftSpells`; "Xác nhận" (`hud.confirmPicks`) commits the lot, "Huỷ"
 * (`hud.closeSpellPicker`) discards it. This is what lets a player keep
 * changing their mind — the old picker applied and closed on the first tap.
 * See `hudInteractions.ts`.
 *
 * A champion's shelf header is itself a button: it stages that champion's
 * whole kit into Q/W/E/R in one tap (`hud.pickKit`), which is the four taps
 * plus four slot changes it used to take. Only shelves that *are* a champion
 * get it — see `SpellGroupDisplay.kit`. The same picker is now reachable with
 * a mouse as well as a thumb: `InGameHUD.vue`'s corner button is no longer
 * touch-only, so this modal is the one loadout screen in both modes rather
 * than the desktop's bottom-strip icons being a separate way in.
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
    <!-- Sticky header (see the file comment): stays pinned while the roster
         scrolls under it, so the slot row — and the way out — never scrolls
         off. -->
    <div class="picker-header">
      <!-- Slot selector + the commit/discard actions in one row. Each pill
           previews its *staged* choice (`draftSpells`) over what is equipped;
           the two buttons live here rather than a separate footer to save
           vertical space. -->
      <div class="slot-picker">
        <button v-for="(spell, index) of state.spells" :key="index" type="button" class="slot-pill"
          :class="{ active: hud.spellIndexToSwap === index, staged: !!hud.draftSpells[index] }"
          @click="hud.spellIndexToSwap = index" @touchend.prevent="hud.spellIndexToSwap = index">
          <img :src="hud.draftSpells[index]?.image ?? spell.image" alt="spell" />
          <span class="slot-pill-key">{{ spell.hotKey }}</span>
        </button>

        <button type="button" class="picker-btn cancel" @click="hud.closeSpellPicker()"
          @touchend.prevent="hud.closeSpellPicker()">
          Huỷ
        </button>
        <button type="button" class="picker-btn confirm" @click="hud.confirmPicks()"
          @touchend.prevent="hud.confirmPicks()">
          Xác nhận
        </button>
      </div>

    </div>

    <div class="list">
      <p class="picker-modes">
        Chế độ:
        <span class="tooltip">
          <input type="checkbox" id="oneForAll" :checked="hud.oneForAll" @click="hud.oneForAll = !hud.oneForAll"
            @touchend.prevent="hud.oneForAll = !hud.oneForAll" />
          <label for="oneForAll">ONE spell for ALL</label>
          <span class="tooltiptext">Tất cả đều chỉ dùng 1 chiêu thức</span>
        </span>

        <span class="tooltip">
          <input type="checkbox" id="cloneMySpell" :checked="hud.cloneMySpell"
            @click="hud.cloneMySpell = !hud.cloneMySpell" @touchend.prevent="hud.cloneMySpell = !hud.cloneMySpell" />
          <label for="cloneMySpell">Clone my spells</label>
          <span class="tooltiptext">Tất cả đều dùng bộ chiêu thức giống bạn</span>
        </span>
      </p>
      <div class="group" v-for="group of hud.spellGroups" :key="group.name" :data-champion="group.name">
        <!-- The shelf header is the "give me this whole champion" button
             wherever the shelf *is* a champion (`group.kit`, see
             `hudInteractions.ts`). The two shelves that aren't — the basic
             attack and the summoner spells — render the same header as an
             inert div, and so does every shelf under `oneForAll`, whose one
             -spell-everywhere meaning a kit contradicts. -->
        <button v-if="group.kit.length && !hud.oneForAll" type="button" class="group-header group-header-btn"
          :title="'Dùng cả bộ chiêu ' + group.name" @click="hud.pickKit(group)"
          @touchend.prevent="hud.pickKit(group)">
          <img v-if="group.image" :src="group.image" alt="spell" />
          <p>{{ group.name }}</p>
          <span class="kit-apply-hint">Dùng bộ</span>
        </button>
        <div v-else class="group-header">
          <img v-if="group.image" :src="group.image" alt="spell" />
          <p>{{ group.name }}</p>
        </div>
        <!-- The icons wrap inside the shelf rather than being direct children
             of it, so the shelf can be a fixed-width cell in `.list`'s grid
             (see `.spell-picker .list` in styles/hud.css) with the heading
             above the icons instead of beside them. `.catalog-group-row` in
             the pregame roster is the same wrapper for the same reason. -->
        <div class="group-row">
          <div v-for="spell of group.spells" :key="spell.name" class="spell" @click="hud.pick(spell)"
            @mouseover="hud.mouseover(spell, $event)" @mouseout="hud.mouseout(spell)"
            @touchstart="hud.touchSpellStart(spell, $event)" @touchmove="hud.touchSpellMove($event)"
            @touchend.prevent="hud.touchSpellEnd(() => hud.pick(spell))" @touchcancel="hud.cancelLongPress()">
            <img :src="spell.image" alt="spell" />
          </div>
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

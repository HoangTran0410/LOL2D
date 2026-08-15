<script setup lang="ts">
/**
 * The in-game practice panel: four tabs over one paused match.
 *
 * This is the old `SpellPickerModal` grown a tab bar. That modal was the only
 * thing in the game you could change without quitting to the setup screen, and
 * it could change exactly one thing — your own seven slots. Everything else
 * that shapes a match (who you are fighting, how many, cooldowns, whether the
 * jungle exists) meant abandoning the match and rebuilding it.
 *
 * Every tab writes through `hud.director` (`MatchDirector`), never into
 * `localStorage`: the panel reshapes *this* match and leaves the setup
 * screen's stored configuration alone. The one exception is the saved-kit
 * library, which the player fills on purpose, by name.
 *
 * The tab bar is `.pregame-tabs` from styles/pregame-scene.css, not a copy of
 * it — both stylesheets load globally (index.html:22-27) and the two screens
 * share the `--hextech-*` palette, so the setup screen's tabs and these are
 * one control with one definition. `body.touch-ui .pregame-tab`'s 44px
 * minimum comes with it, for free and for the same reason.
 *
 * ## This component owns the modal shell; the tabs own only their bodies
 *
 * `.practice-panel` is the fixed, centred, hextech-framed box that
 * `.spell-picker` used to be. The picker kept `overflow-y: auto` and its
 * `position: sticky` `.picker-header`, and gave up only the chrome — because
 * it is still the element that scrolls, which
 * `tests/e2e/drive-mobile-hud.mjs` scrolls by hand and asserts on. Read
 * `SpellPickerModal.vue`'s file comment before touching either: a "sticky
 * header" flex shell *inside* the picker was tried once and silently
 * collapsed the roster. What is here is the other shape — the flex column is
 * the shell around the scroller, so the scroller is a flex *item* with a
 * definite height to fill rather than a container with an intrinsic one.
 *
 * There is no separate title row. The selected tab is the title: a "CHIÊU
 * THỨC" tab above a heading that read "Chọn chiêu thức" was the same word
 * twice, and on the 390px-tall landscape phone this panel has to survive,
 * two rows of chrome above the roster is most of a shelf.
 *
 * `v-show` on the spell tab, `v-if` on the other three. The picker owns two
 * pieces of state a re-mount would throw away — its scroll position and the
 * staged `draftSpells` behind Huỷ / Xác nhận — and a player who checks the
 * roster tab mid-pick must come back to the picks they had. The other three
 * read their state from the director when they mount, so they cost nothing to
 * rebuild and gain nothing from being kept alive.
 *
 * ## The close button belongs to the shell, not to a tab
 *
 * Huỷ / Xác nhận live inside `SpellPickerModal`'s slot row, because that is
 * what they act on — staged spell picks. `v-show` takes them off screen with
 * the rest of that tab, which for three of the four tabs left the panel with
 * **no way out at all**: it covers the match, the match is paused under it,
 * and the only exit was to work out that you must first switch back to Chiêu
 * thức. So the shell carries its own close, always visible, on the tab row.
 *
 * It calls `closeSpellPicker`, the same discard-and-close that Huỷ does. That
 * is the honest verb: leaving via this button abandons staged picks exactly as
 * Huỷ would. It does not undo a rules or world change, because those never
 * staged in the first place — see the spec's Task 9 correction.
 */
import { inject, ref } from 'vue';
import type { HudInteractions } from './hudInteractions';
import type { HudState } from './hudState';
import SpellPickerModal from './SpellPickerModal.vue';
import RosterTab from './practice/RosterTab.vue';
import RulesTab from './practice/RulesTab.vue';
import WorldTab from './practice/WorldTab.vue';

defineProps<{ state: HudState }>();

const hud = inject<HudInteractions>('hud')!;

const TABS = [
  { id: 'spells', label: 'Chiêu thức' },
  { id: 'roster', label: 'Đấu thủ' },
  { id: 'rules', label: 'Trận đấu' },
  { id: 'world', label: 'Thế giới' },
] as const;

const tab = ref<(typeof TABS)[number]['id']>('spells');
</script>

<template>
  <div class="practice-panel">
    <div class="pregame-tabs practice-tabs">
      <button
        v-for="item of TABS"
        :key="item.id"
        type="button"
        class="pregame-tab practice-tab"
        :class="{ selected: tab === item.id }"
        :id="`practice-tab-${item.id}`"
        @click="tab = item.id"
        @touchend.prevent="tab = item.id"
      >
        {{ item.label }}
      </button>

      <!-- The shell's own way out, on every tab. See the file comment: the
           picker's Huỷ disappears with its tab, and three of the four tabs
           had no exit from a panel that covers a paused match. -->
      <button
        type="button"
        class="practice-close"
        id="practice-close"
        title="Đóng"
        @click="hud.closeSpellPicker()"
        @touchend.prevent="hud.closeSpellPicker()"
      >
        <i class="fas fa-times"></i>
      </button>
    </div>

    <SpellPickerModal v-show="tab === 'spells'" :state="state" />
    <RosterTab v-if="tab === 'roster'" />
    <RulesTab v-if="tab === 'rules'" />
    <WorldTab v-if="tab === 'world'" />
  </div>
</template>

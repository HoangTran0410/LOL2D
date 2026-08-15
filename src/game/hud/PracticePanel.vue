<script setup lang="ts">
/**
 * The in-game practice panel: three tabs over one paused match.
 *
 * This grew out of the old `SpellPickerModal`, which was the only thing in the
 * game you could change without quitting to the setup screen, and could change
 * exactly one thing — your own seven slots. Everything else that shapes a
 * match (who you are fighting, how many, cooldowns, whether the jungle exists)
 * meant abandoning the match and rebuilding it.
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
 * `.practice-panel` is the fixed, centred, hextech-framed box; each tab body
 * (`.practice-tab-body`) is the flex *item* that scrolls inside it, with a
 * definite height to fill rather than an intrinsic one. That division is
 * load-bearing: the deleted picker once tried the other shape — a "sticky
 * header" flex shell *inside* the scroller — and silently collapsed its own
 * list, because a `flex: 1 1 0` body inside a `max-height`-capped, otherwise
 * intrinsic box has no pinned size to grow into.
 *
 * There is no separate title row. The selected tab is the title: a tab label
 * above a heading repeating it was the same word twice, and on the 390px-tall
 * landscape phone this panel has to survive, two rows of chrome above the
 * content is most of a shelf.
 *
 * `v-if` on every tab, with nothing kept alive. Each reads its state from the
 * director (or the camera) when it mounts, so a re-mount costs nothing and
 * loses nothing — there is no staged, uncommitted edit that survives a tab
 * switch now that the picker's draft is gone. `RosterTab`'s loadout editor
 * does stage a champion swap behind its own Huỷ / Xác nhận, but it covers the
 * tab row while it is open, so there is no way to switch tabs out from under
 * it.
 *
 * ## The close button belongs to the shell, not to a tab
 *
 * The panel covers the match and the match is paused under it, so every tab
 * needs a way out and no tab owns one. The shell carries its own close,
 * always visible, at the end of the tab row. (It used to be the picker's own
 * "Huỷ", which disappeared with its tab and left the other three with no exit
 * at all.)
 *
 * It calls `closeSpellPicker`, which discards nothing the panel is holding —
 * rules, world and roster edits all apply on the spot, and the one staged edit
 * left (the loadout editor's) is unreachable while this button is.
 */
import { inject, ref } from 'vue';
import type { HudInteractions } from './hudInteractions';
import RosterTab from './practice/RosterTab.vue';
import RulesTab from './practice/RulesTab.vue';
import WorldTab from './practice/WorldTab.vue';

const hud = inject<HudInteractions>('hud')!;

const TABS = [
  { id: 'roster', label: 'Đấu thủ' },
  { id: 'rules', label: 'Trận đấu' },
  { id: 'world', label: 'Thế giới' },
] as const;

const tab = ref<(typeof TABS)[number]['id']>('roster');
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

      <!-- The shell's own way out, on every tab. See the file comment: no tab
           owns an exit from a panel that covers a paused match. -->
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

    <RosterTab v-if="tab === 'roster'" />
    <RulesTab v-if="tab === 'rules'" />
    <WorldTab v-if="tab === 'world'" />
  </div>
</template>

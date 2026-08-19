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
 * `localStorage` directly: a tab reshapes *this* match, and the director
 * persists what it changed to `lol2d:pregameConfig:v1` afterwards, so the
 * match you shaped is the one you get back on reload. That is a reversal of
 * the rule this panel was built to — see `MatchDirector`'s file comment for
 * what changed and what did not. What did not: cheats and debug layers are
 * session state and are never stored. The saved-kit library is the one thing
 * a tab stores on its own, because the player fills it on purpose, by name.
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
import { inject } from 'vue';
import type { HudInteractions } from './hudInteractions';
import RosterTab from './practice/RosterTab.vue';
import RulesTab from './practice/RulesTab.vue';
import CheatTab from './practice/CheatTab.vue';
import { activePracticeTab, type PracticeTabId } from './practice/panelTab';

const hud = inject<HudInteractions>('hud')!;

const TABS: { id: PracticeTabId; label: string }[] = [
  // The id stays `roster` (the DOM id `practice-tab-roster` and its e2e
  // selectors with it); the label is "Đội" because the tab is now about sides
  // and per-champion setup, not a flat list of contestants.
  { id: 'roster', label: 'Đội' },
  { id: 'rules', label: 'Trận đấu' },
  { id: 'cheats', label: 'Gian lận' },
];

/**
 * Held in `practice/panelTab.ts` rather than here, so the selected tab
 * survives the panel being closed — see that file for why a `ref` at the top
 * of `<script setup>` would not have.
 */
const tab = activePracticeTab;
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
      >
        <i class="fas fa-times"></i>
      </button>
    </div>

    <RosterTab v-if="tab === 'roster'" />
    <RulesTab v-if="tab === 'rules'" />
    <CheatTab v-if="tab === 'cheats'" />
  </div>
</template>

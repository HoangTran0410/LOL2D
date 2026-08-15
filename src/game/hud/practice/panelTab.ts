import { ref } from 'vue';

/**
 * Which practice-panel tab is selected, held outside the component.
 *
 * Both HUD views mount `PracticePanel` with `v-if`, so closing the panel
 * unmounts it — and `<script setup>` *is* the setup function, so a `ref`
 * declared at its top level is rebuilt on every mount. Declaring it there
 * looks like module scope and is not. Hence this file: a module is the only
 * place in a `.vue` component's orbit whose state genuinely outlives the
 * instance.
 *
 * Deliberately not persisted to `localStorage`, even though the panel does
 * persist now: `MatchDirector` writes the *match* — the roster, the rules, the
 * world — after every mutation, and which tab you had open is not one of
 * those. It is a fact about the last few seconds, not a setting (see
 * `MatchDirector`'s file comment for where that line is drawn, and why cheats
 * sit on this side of it too).
 *
 * It does outlive a whole match — quit to the menu, start a new game, and the
 * panel opens where you left it. That is intended rather than a leak: it is
 * one small string, and resetting a player's place between matches would be a
 * behaviour nobody asked for.
 */
export type PracticeTabId = 'roster' | 'rules' | 'cheats';

export const activePracticeTab = ref<PracticeTabId>('roster');

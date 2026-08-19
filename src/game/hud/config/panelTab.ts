import { ref } from 'vue';

/**
 * Which match-config tab is selected, held outside the component.
 *
 * Both HUD views mount the panel with `v-if`, so closing it unmounts it — and
 * `<script setup>` *is* the setup function, so a `ref` declared at its top
 * level is rebuilt on every mount. Declaring it there looks like module scope
 * and is not. Hence this file: a module is the only place in a `.vue`
 * component's orbit whose state genuinely outlives the instance.
 *
 * Deliberately not persisted, even though everything the panel *edits* now is:
 * which tab you had open is a fact about the last few seconds, not a setting.
 *
 * It does outlive a whole match, and now a scene as well — configure from the
 * menu, start the match, press Escape, and the panel opens where you left it.
 * That is intended: it is one small string, and resetting a player's place
 * between two views of the same panel would be a behaviour nobody asked for.
 *
 * `'cheats'` is gone. The per-unit cheats live on each champion's row on Đội,
 * and the two global ones (reveal map, the debug layers) moved to Cài đặt
 * beside the other display settings — three tabs is the hard limit, because
 * `.pregame-tab` is `flex: 1` and a 390px landscape phone holds three plus the
 * close button.
 */
export type PanelTabId = 'roster' | 'rules' | 'settings';

export const activePanelTab = ref<PanelTabId>('roster');

import { ref } from 'vue';

/**
 * Whether the loadout editor's roster is showing champion tiles or every
 * ability icon, held outside the component and remembered between sessions.
 *
 * Outside, because `LoadoutEditorModal` is mounted with `v-if` and
 * `<script setup>` *is* the setup function — a `ref` at its top level looks
 * like module scope and is rebuilt on every open, so the toggle would forget
 * itself the moment the modal closed. Same trap `panelTab.ts` documents.
 *
 * Persisted, unlike that one. Which tab you had open is a fact about the last
 * few seconds; whether you want the grid is a setting, and the roster is ~50
 * shelves deep — a player who wants tiles wants them every time. Its own key,
 * not a field on the pregame config: `lol2d:pregameConfig:v1` is the match,
 * and a test asserts exactly which sections it holds.
 */
export type KitRosterView = 'compact' | 'expanded';

export const KIT_ROSTER_VIEW_KEY = 'lol2d:kitRosterView:v1';

const DEFAULT_VIEW: KitRosterView = 'compact';

/**
 * Anything that is not one of the two known values reads as the default —
 * storage is hand-editable and outlives a rename, and an unrecognised string
 * must not leave the roster in a third state that renders neither layout.
 */
export const loadKitRosterView = (): KitRosterView => {
  try {
    const stored = localStorage.getItem(KIT_ROSTER_VIEW_KEY);
    return stored === 'compact' || stored === 'expanded' ? stored : DEFAULT_VIEW;
  } catch {
    // Private mode, a blocked origin, a quota-less iframe: the roster still has
    // to render. Same tolerance the rest of the storage seams take.
    return DEFAULT_VIEW;
  }
};

export const kitRosterView = ref<KitRosterView>(loadKitRosterView());

export const setKitRosterView = (view: KitRosterView): void => {
  kitRosterView.value = view;
  try {
    localStorage.setItem(KIT_ROSTER_VIEW_KEY, view);
  } catch {
    // Writing is best-effort for the same reason reading is: the choice still
    // holds for this session, it just will not outlive it.
  }
};

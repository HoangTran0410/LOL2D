import { inject, provide, type InjectionKey } from 'vue';
import type { SlotChoice } from '../../game/config/PregameConfig';
import type { SpellClass } from './types';

/**
 * The two overlays this screen shows on top of everything else — the spell
 * detail panel and the catalogue picker — are each a single shared instance,
 * reused by the player's loadout editor and by whichever bot row is
 * expanded (see the doc comment on `SetupScene.ts`'s old `mountLoadoutEditor`
 * for why: "one implementation, reused, rather than one player-specific copy
 * and one bot-specific copy").
 *
 * A spell icon that wants to open the detail panel, or a custom slot that
 * wants to open the picker, can sit arbitrarily deep under `SetupScene.vue`
 * (champion card -> champion grid -> loadout editor -> bot row -> bot
 * accordion). Provide/inject is used instead of threading an event through
 * every one of those layers, since this is a singleton service the whole
 * tree shares, not state that belongs to any one branch of it.
 */
export interface PregameOverlays {
  /** Opens the shared spell-detail panel for one spell. */
  openSpellDetail(spellClass: SpellClass): void;
  /** Opens the shared catalogue picker; `onPick` fires once, with the chosen id or `'random'`. */
  openCatalogPicker(onPick: (choice: SlotChoice) => void): void;
}

const key: InjectionKey<PregameOverlays> = Symbol('pregame-overlays');

/** Called once, by `SetupScene.vue`. */
export const providePregameOverlays = (overlays: PregameOverlays): void => {
  provide(key, overlays);
};

/** Called by any descendant that needs to open one of the two overlays. */
export const usePregameOverlays = (): PregameOverlays => {
  const overlays = inject(key);
  if (!overlays) {
    throw new Error('usePregameOverlays() called outside a SetupScene.vue subtree');
  }
  return overlays;
};

/**
 * The one spell core itself constructs.
 *
 * Not a shorter list of content — a different kind of thing. Every pack
 * presupposes that a champion can swing, and `preset.ts` falls back to
 * `BasicAttack` for any slot it cannot resolve. Leaving it under `spells/`
 * meant the engine imported out of the directory that is about to become a
 * separate repository.
 *
 * `Recall` is not here. It presupposes a fountain to return to, and a
 * fountain is map content — a battle-royale map has none. It lives under
 * `spells/` like any other pack-supplied spell, and `preset.ts` is the layer
 * that decides a normal match's champions get one (see `Champion.recall`).
 *
 * `scripts/generate-spell-catalog.mjs` reads this barrel alongside the content
 * one, so this still appears in the picker and keeps its id.
 */
export { default as BasicAttack } from './BasicAttack';

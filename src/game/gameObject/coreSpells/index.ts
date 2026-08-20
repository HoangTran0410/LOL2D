/**
 * The spells core itself constructs.
 *
 * Not a shorter list of content — a different kind of thing. Every pack
 * presupposes that a champion can swing and can go home, and `Champion.ts`
 * builds `recall` in a field initialiser while `preset.ts` falls back to
 * `BasicAttack` for any slot it cannot resolve. Leaving them under `spells/`
 * meant the engine imported out of the directory that is about to become a
 * separate repository.
 *
 * `scripts/generate-spell-catalog.mjs` reads this barrel alongside the content
 * one, so both still appear in the picker and keep their ids.
 */
export { default as BasicAttack } from './BasicAttack';
export { default as Recall } from './Recall';

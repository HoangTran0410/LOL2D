/**
 * Core mechanism, constructed by core itself rather than resolved through a
 * pack — not a shorter list of content, a different kind of thing. Every
 * pack presupposes that a champion can swing, and `preset.ts` falls back to
 * `BasicAttack` for any slot it cannot resolve. Leaving it under `spells/`
 * meant the engine imported out of the directory that is about to become a
 * separate repository.
 *
 * `Recall.ts` lives in this directory too (batch 5 task 1 — it moved back
 * from `packs/riot/spells/`, alongside `BasicAttack`, on the same reasoning:
 * every current map grants a way home the way every kit grants a swing, and
 * `preset.ts`'s `attachRecall` already built one for every champion
 * synchronously, before the async spell-registry path even exists). **It is
 * deliberately not re-exported from this barrel.** `scripts/generate-spell-
 * catalog.mjs` regex-parses this file's own re-export lines — literally, not
 * comment-aware, so this paragraph is written to avoid the shape itself — to
 * build the picker's catalogue; that is what puts `BasicAttack` in front of
 * a player and keeps its id, and Recall must never be catalogued:
 * it is not in `spells[]`, not offered by the loadout editor and not a
 * `'random'` slot could ever draw (see `CLAUDE.md` and
 * `tests/game/spellRegistry.test.ts`'s `leaves Recall out of the pool`).
 * Re-exporting it here the way `BasicAttack` is exported would hand the
 * generator a factory (`(api: ContentApi) => SpellClass`, not a plain
 * class — Recall still takes the injected `ContentApi`, unlike `BasicAttack`,
 * because `packs/riot/data.ts` still names every champion's way home as the
 * string `'Recall'` and `src/content/install.ts` still has to fold a real
 * class onto that id for `PackRegistry`'s own pairing check) and crash the
 * catalogue build; even fixed to a plain class, cataloguing it would put
 * "Hồi Thành" in the random-roll pool, which is the exact regression
 * `tests/content/recallIsCore.test.ts` pins against. `preset.ts` and
 * `install.ts` both import `./Recall` directly, not through this barrel.
 */
export { default as BasicAttack } from './BasicAttack';

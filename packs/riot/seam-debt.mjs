/**
 * This pack's own known seam debt (spec §8.1: the rule lives with the
 * engine, the population lives with the content). `scripts/check-seams.mjs`
 * discovers this file automatically — it is a sibling of whatever root the
 * pack's `check-seams` script points at (`./spells` here) — and passes its
 * `seamDebt` export as the one `options` object `checkSeams(root, options)`
 * shares across all thirteen seams (`@moba2d/core`'s `src/seams/index.ts`).
 *
 * Every entry below was proven against the real tree
 * (`node scripts/check-seams.mjs ./spells` from this pack's own directory,
 * before this file existed) and matches `tests/seams/exported-seams.test.ts`'s
 * "checkSeams against this repo's own pack, with its known debt declared"
 * case one-for-one — this file is that same debt, moved from a core test
 * into the pack's own build step.
 *
 * `checkSeams` hands this one object to every seam; a seam that does not
 * read a given field (`grandfathered`, `noPressOverride`) simply ignores
 * it, which is what lets `grandfathered` below carry two seams' worth of
 * names — `castspec-frozen` matches by file basename, `spell-object-
 * display-box` by class name, and neither domain collides with the other.
 */

/** `castspec-frozen`: cast specs that still read live state on every cast
 *  (`this.shotsRemaining`-shaped fields), pre-dating the rule. File
 *  basenames.
 *
 *  `spell-object-display-box`: `SpellObject` subclasses reporting a
 *  zero-area box, pre-dating the extent rule. Class names, not file names —
 *  `Flash_Object` lives in `Flash.ts`, `Heal_Object` in `Heal.ts`,
 *  `LeeSin_R_Object` in `LeeSin_R.ts`.
 */
const GRANDFATHERED = new Set([
  // castspec-frozen
  'Janna_Q.ts',
  'Janna_R.ts',
  'Lux_R.ts',
  'Malzahar_R.ts',
  'MasterYi_W.ts',
  'Pantheon_Q.ts',
  'Rammus_Q.ts',
  'Riven_Q.ts',
  'Varus_Q.ts',
  'Vayne_Q.ts',
  // spell-object-display-box
  'Flash_Object',
  'Heal_Object',
  'LeeSin_R_Object',
]);

/** `unit-target-team`: `Annie_Q.ts` resolves correctly on the path the game
 *  actually uses without its own `press()` override — see
 *  `UnitTargetTeamOptions.noPressOverride`'s own doc comment. */
const NO_PRESS_OVERRIDE = new Set(['Annie_Q.ts']);

/**
 * Basenames left out of the walk entirely, for every seam at once:
 *
 * - `index.ts` — the spell barrel. Not itself a spell.
 * - `_EmptyExample.ts` — the scaffolding template `npm run spell:new` copies
 *   from. Not itself a spell either, and `targeting-mode-declared` is the
 *   one seam narrow enough (`DEFINES_SPELL_CLASS`) that this pair usually
 *   would not need stating — except this template *does* extend `Spell`
 *   without declaring how it aims, on purpose, since it is not meant to be
 *   cast.
 * - `Blitzcrank_E.ts` — `world-mouse-in-spell-code` has no `grandfathered`
 *   field (unlike the seams above), so `skip` is the only lever this rule
 *   honours. `tests/game/integration/SpellAimIntegration.test.ts` still
 *   pins the exact offending line in core's own suite; this is a broader
 *   exemption (the whole file, from every seam) than that one line, which
 *   is a real trade-off of using `skip` here rather than a purpose-built
 *   exemption — accepted because today Blitzcrank_E.ts carries no other
 *   violation.
 */
const SKIP = new Set(['index.ts', '_EmptyExample.ts', 'Blitzcrank_E.ts']);

export const seamDebt = {
  skip: SKIP,
  grandfathered: GRANDFATHERED,
  noPressOverride: NO_PRESS_OVERRIDE,
};

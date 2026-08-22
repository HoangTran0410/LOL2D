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
 * read a given field simply ignores it. `grandfathered` and
 * `grandfatheredClasses` are deliberately two separate fields, not one
 * shared name — fix round 3: `castspec-frozen` matches by file basename
 * and `spell-object-display-box` by class name, and each seam now also
 * checks its own exemption entries for staleness (an entry that matched
 * nothing this run). Sharing one `grandfathered` field would have made
 * every entry meant for the *other* seam look stale to whichever seam
 * read it, since a class name never matches a file basename.
 *
 * Every entry here is checked for staleness on every run — see
 * `src/seams/index.ts`'s own "An exemption that matches nothing is also a
 * violation" section. This file has none, as of the last measurement
 * (task 6 fix round 3): every entry below currently suppresses a real
 * would-be violation.
 */

/** `castspec-frozen`: cast specs that still read live state on every cast
 *  (`this.shotsRemaining`-shaped fields), pre-dating the rule. File
 *  basenames. */
const GRANDFATHERED = new Set([
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
]);

/** `spell-object-display-box`: `SpellObject` subclasses reporting a
 *  zero-area box, pre-dating the extent rule. Class names, not file
 *  names — `Flash_Object` lives in `Flash.ts`, `Heal_Object` in
 *  `Heal.ts`, `LeeSin_R_Object` in `LeeSin_R.ts`. */
const GRANDFATHERED_CLASSES = new Set(['Flash_Object', 'Heal_Object', 'LeeSin_R_Object']);

/** `unit-target-team`: `Annie_Q.ts` resolves correctly on the path the game
 *  actually uses without its own `press()` override — see
 *  `UnitTargetTeamOptions.noPressOverride`'s own doc comment. */
const NO_PRESS_OVERRIDE = new Set(['Annie_Q.ts']);

/**
 * `world-mouse-in-spell-code`: known offending lines, one per entry
 * (`"<file>:<1-indexed line number>"`). `Blitzcrank_E.ts:83` is
 * `tests/game/integration/SpellAimIntegration.test.ts`'s own pinned example
 * (`const angle = VectorUtils.getAngle(this.owner.position,
 * this.game.worldMouse);`). Fix round 1 of content-pack-extraction batch 5
 * task 6: this used to be folded into `skip` below, because the seam had no
 * line-level exemption field — which exempted the *whole file* from *every*
 * seam, not just this one line, a real loss of coverage on a file that has
 * already needed pinning once. `WorldMouseInSpellCodeOptions.pinned` closes
 * that gap; only this exact line is exempt now, from only this one rule —
 * checked against that exact line on every run (fix round 3), not just the
 * file, so a future edit that shifts this line's number would surface as a
 * stale entry rather than silently exempting whatever moved into line 83.
 */
const PINNED = new Set(['Blitzcrank_E.ts:83']);

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
 */
const SKIP = new Set(['index.ts', '_EmptyExample.ts']);

export const seamDebt = {
  skip: SKIP,
  grandfathered: GRANDFATHERED,
  grandfatheredClasses: GRANDFATHERED_CLASSES,
  noPressOverride: NO_PRESS_OVERRIDE,
  pinned: PINNED,
};

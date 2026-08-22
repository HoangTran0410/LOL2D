/**
 * This pack's own known seam debt (spec §8.1: the rule lives with the
 * engine, the population lives with the content). The CLI discovers this
 * file automatically — it lives **inside** the tree the pack's
 * `check-seams` script points at, so `moba2d-check-seams ./spells` reads
 * `./spells/seam-debt.mjs` and `moba2d-check-seams ./monsters` would read
 * its own, independently (fix round 3: as a sibling of the target's
 * *parent* both trees discovered the same file, and every entry meant for
 * one applied to the other). It is passed as the one `options` object
 * `checkSeams(root, options)` shares across all thirteen seams
 * (`@moba2d/core`'s `src/seams/index.ts`). The fourteenth rule,
 * `pack-core-boundary`, takes no options at all — it has never had an
 * exception and a pack naming a core internal is a pack that cannot leave
 * this repository.
 *
 * Every entry below was proven against the real tree
 * (`node scripts/check-seams.mjs ./spells` from this pack's own directory,
 * before this file existed) and matches `tests/seams/exported-seams.test.ts`'s
 * "checkSeams against this repo's own pack, with its known debt declared"
 * case one-for-one — this file is that same debt, moved from a core test
 * into the pack's own build step.
 *
 * `checkSeams` hands this one object to every seam; a seam that does not
 * read a given field simply ignores it. No two seams may name their set
 * the same thing — `grandfathered` (`castspec-frozen`),
 * `grandfatheredClasses` (`spell-object-display-box`) and
 * `grandfatheredTests` (`spell-runtime-drive`) are three separate fields
 * for that reason: each seam checks its own entries for staleness, so a
 * shared name would make every entry meant for the *other* seam look
 * stale to whichever seam read it. `tests/seams/seamOptionFields.test.ts`
 * enforces it on core's side, so a pack can never be handed two seams
 * fighting over one field name.
 *
 * A file entry is matched by its path relative to the scanned root **or**
 * by a bare basename at any depth (fix round 4 — the two conventions that
 * used to coexist here made a live exemption in a subdirectory report as
 * stale). `PINNED` below is a line entry, which additionally carries the
 * line's own code: a licence is issued to a line, not to a line number.
 *
 * Every entry here except `SKIP` is checked for staleness on every run —
 * "did this specific entry suppress a real would-be violation this run" —
 * and reported if it did not. `SKIP` is checked for existence only, and
 * `src/seams/index.ts`'s "An exemption that matches nothing is also a
 * violation" section says why that is the right question for it (fix round
 * 4 corrected both headers, which had claimed consumption checking for all
 * of them). This file is clean on both counts as of the last measurement.
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
 *
 * An entry carries the line's own code as well as its number (fix round 4).
 * With the number alone the licence outlived the thing it was issued for:
 * replacing line 83 with an entirely different `this.game.worldMouse` read
 * left `check-seams` printing `scanned 237 file(s), clean`. The entry now
 * reads as the violation the CLI would print, with the file in front, so
 * pinning a line is copying the reported line rather than counting lines.
 */
const PINNED = new Set([
  'Blitzcrank_E.ts:83:const angle = VectorUtils.getAngle(this.owner.position, this.game.worldMouse);',
]);

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

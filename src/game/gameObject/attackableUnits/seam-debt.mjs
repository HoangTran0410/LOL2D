/**
 * Core's own known seam debt for **this one directory**, in the same shape
 * and read by the same mechanism a pack's debt is (`scripts/check-seams.mjs`
 * loads `<scanned tree>/seam-debt.mjs`). `@moba2d/core`'s own `check-seams`
 * script points at `./src/game/gameObject/attackableUnits`, so this file is
 * what it reads.
 *
 * ## Why this directory has debt at all, and why it is no longer excluded
 *
 * Content-pack-extraction batch 5 task 6 fix round 4. Until now
 * `attackableUnits/` was left out of core's `check-seams` wholesale, on the
 * grounds that it is unit-side plumbing rather than spell-authored code and
 * that three of the thirteen rules have legitimate exceptions here. Both
 * halves were true, and the conclusion still cost more than it bought:
 * **five of the seven files in this directory carry no exception at all**
 * (`AIChampion`, `Minion`, `Monster`, `Pet`, `DummyChampion`), and a
 * directory-level exclusion is a permanent hole under them — a future
 * `stats.mana` write or a fog-flag read in any of the five would have been
 * checked by nothing.
 *
 * So the exceptions are stated one at a time instead, each one visible, each
 * one reporting itself the day it stops being true (`kind:
 * 'stale-exemption'`). Two of the three seams involved grew the field to say
 * it with: `mana-spend`'s `pinnedManaLines` and `target-vision`'s
 * `grandfatheredFogReads`, both modelled on the per-line `pinned` that
 * `world-mouse-in-spell-code` already had.
 *
 * Every entry below is a **line**, not just a line number: `"<file>:<line>:
 * <the line's own code, trimmed>"`. An edit that moves one of these lines,
 * or rewrites it, reports the entry stale rather than silently transferring
 * the licence to whatever now sits at that number. Renumbering is the
 * expected maintenance cost and it is the point — copy the line the CLI
 * prints back into this file.
 */

/**
 * `mana-spend`: the two sanctioned reads/writes of a mana stat outside
 * `Spell.spendMana()`.
 *
 * - `AttackableUnit.restoreMana()` — granting is not billing (CLAUDE.md).
 *   A refill must *not* be zeroed by URF's `manaFree`, which is exactly what
 *   routing it through the spell-side seam would do, so it lives on the unit
 *   beside `takeHeal()`.
 * - `Champion.drawHealthBar()` — a read of the current value to draw the
 *   bar. Not a spend at all; the rule's regex cannot tell a HUD read from a
 *   charge, and this is the one place in core where that matters.
 */
const PINNED_MANA_LINES = new Set([
  'AttackableUnit.ts:495:this.stats.mana.baseValue = constrain(this.stats.mana.baseValue + amount, 0, max);',
  'Champion.ts:389:let mana = this.stats.mana.value;',
]);

/**
 * `target-vision`: `AttackableUnit` is where `visibleToPlayerTeam` is
 * *declared* — `FogOfWar.calculateSight` writes it and the draw cull, the
 * minimap and the debug overlay read it. The rule bans a spell deciding
 * *targeting* from that flag; the flag itself has to live somewhere.
 * A file entry, since the declaration and its doc comment are the whole
 * reason the file matches.
 */
const GRANDFATHERED_FOG_READS = new Set(['AttackableUnit.ts']);

/**
 * `world-mouse-in-spell-code`: `AttackableUnit.drawDir()` — the white line
 * drawn from the player's own champion toward the cursor. The rule exists
 * because a *spell* reading the cursor fires at wherever a thumb rests on a
 * phone; drawing the player's own aim indicator is the one legitimate read,
 * and it is a draw, not an acquisition.
 */
const PINNED = new Set([
  'AttackableUnit.ts:282:if (!this.isDead && this.game.worldMouse) {',
  'AttackableUnit.ts:287:let mouseDir = p5.Vector.sub(this.game.worldMouse, pos).setMag(size / 2 + 2);',
]);

export const seamDebt = {
  pinnedManaLines: PINNED_MANA_LINES,
  grandfatheredFogReads: GRANDFATHERED_FOG_READS,
  pinned: PINNED,
};

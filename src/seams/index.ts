/**
 * `@lol2d/core/seams` — the engine's static-scan rules, exported as runnable
 * functions rather than left inlined inside `tests/game/spells/*-seam.test.ts`.
 *
 * ## Why this exists
 *
 * Every rule in this directory catches a mistake `tsc` cannot see — a
 * *shape*, not a type error (a buff's `deactivate()` instead of
 * `deactivateBuff()`, a mana spend that skips the URF-aware seam, a cast spec
 * that reads live state). Before the content-pack split, these lived only as
 * Vitest source scans over `src/game/gameObject/spells/`. Now that a pack's
 * spell code can live anywhere — `packs/riot/spells/` in this repo, a
 * separate repo entirely once batch 5 publishes packs as their own package —
 * the rule has to be callable against **whatever tree the caller hands it**,
 * not hard-coded to one path inside this repo.
 *
 * "The rule lives with the engine that owns it, so it evolves with the
 * engine; the population lives with the content. A pack that violates a
 * rule fails **its own** build, not the engine's." (spec §8.1)
 *
 * ## Shape
 *
 * Every seam is `(root: string, options?) => SeamViolation[]` — a pure
 * function over a directory tree, no framework dependency, importable from a
 * plain Node script or a Vitest test equally. `checkSeams(root)` runs all of
 * them and returns one combined list, each violation tagged with the seam
 * that raised it.
 *
 * ## What is and is not in this module
 *
 * Thirteen of the fifteen seams named in the content-pack extraction's task 9
 * are here, in the shape a pack's own spell tree can run against directly.
 * Two are deliberately **not** exported:
 *
 * - `cc-buff-icons` (`tests/game/spells/cc-buff-icons.test.ts`) is a
 *   hand-written before/after list of *this* pack's own champions — a
 *   regression test for a specific historical mistake, not a pattern any
 *   pack's code could violate in a new way. It stays a test in this pack's
 *   own tree.
 * - `attack-gate` (`tests/game/attackableUnits/attack-gate-seam.test.ts`)
 *   checks core's own `Minion`/`Monster`/`Turret` — units a content pack
 *   does not currently author at all. It is an engine invariant, not a
 *   content-authoring rule, and stays a core-only test.
 *
 * Both are still proven to catch their violation (see task-9-report.md); they
 * are just not part of what a pack calls through this entry point.
 *
 * ## Usage
 *
 * ```ts
 * import { checkSeams } from '@/seams';
 *
 * const violations = checkSeams('./packs/riot/spells');
 * if (violations.length > 0) {
 *   for (const v of violations) console.error(`${v.seamId} ${v.file}: ${v.message}`);
 *   process.exit(1);
 * }
 * ```
 *
 * `scripts/check-seams.mjs` wraps exactly this as a CLI (`node
 * scripts/check-seams.mjs <root>`), the working form of the spec's
 * `lol2d-check-seams ./src`. What is **not** decided here, on a task-9
 * ruling: whether that CLI becomes an installed `bin`, what package publishes
 * it, and how `packs/riot/` — which gets no `package.json` from this task —
 * ends up invoking it. That is batch 5's call.
 */
import type { Seam, SeamCheckOptions, SeamViolation } from './types';
import { checkManaSpend } from './manaSpend';
import { checkDashOnUpdate } from './dashOnUpdate';
import { checkTargetVision } from './targetVision';
import { checkUnitTargetTeam } from './unitTargetTeam';
import { checkCastSpecFrozen } from './castSpecFrozen';
import { checkCooldowns } from './cooldowns';
import { checkTargetingModeDeclared } from './targetingModeDeclared';
import { checkTerrainField } from './terrainField';
import { checkBuffDeactivate } from './buffDeactivate';
import { checkStatResourceModifier } from './statResourceModifier';
import { checkSpellObjectDisplayBox } from './spellObjectDisplayBox';
import { checkSpellRuntimeDrive } from './spellRuntimeDrive';
import { checkWorldMouseInSpellCode } from './worldMouseInSpellCode';

export type { Seam, SeamCheck, SeamCheckOptions, SeamViolation } from './types';
export { checkManaSpend } from './manaSpend';
export { checkDashOnUpdate } from './dashOnUpdate';
export { checkTargetVision } from './targetVision';
export { checkUnitTargetTeam, type UnitTargetTeamOptions } from './unitTargetTeam';
export { checkCastSpecFrozen, type CastSpecFrozenOptions } from './castSpecFrozen';
export { checkCooldowns, type CooldownsOptions } from './cooldowns';
export { checkTargetingModeDeclared } from './targetingModeDeclared';
export { checkTerrainField } from './terrainField';
export { checkBuffDeactivate } from './buffDeactivate';
export { checkStatResourceModifier } from './statResourceModifier';
export {
  checkSpellObjectDisplayBox,
  type SpellObjectDisplayBoxOptions,
} from './spellObjectDisplayBox';
export { checkSpellRuntimeDrive, type SpellRuntimeDriveOptions } from './spellRuntimeDrive';
export { checkWorldMouseInSpellCode } from './worldMouseInSpellCode';

/** Every seam this module exports, named for reporting. */
export const seams: Seam[] = [
  {
    id: 'mana-spend',
    summary: 'a spell bills mana only through Spell.spendMana(), never stats.mana directly',
    check: checkManaSpend,
  },
  {
    id: 'dash-onupdate',
    summary: 'a spell hooks a dash frame with onDashUpdate, never assigns onUpdate',
    check: checkDashOnUpdate,
  },
  {
    id: 'target-vision',
    summary: 'an auto-locking spell filters its query with PredefinedFilters.visibleTo',
    check: checkTargetVision,
  },
  {
    id: 'unit-target-team',
    summary: 'a UNIT spell declares targetTeam and refuses an unresolved context',
    check: checkUnitTargetTeam,
  },
  {
    id: 'castspec-frozen',
    summary: 'castSpec is built from constants, never live state read on every cast',
    check: checkCastSpecFrozen,
  },
  {
    id: 'cooldowns',
    summary: 'no numeric spell cooldown exceeds the match pace ceiling',
    check: checkCooldowns,
  },
  {
    id: 'targeting-mode-declared',
    summary: 'every spell declares how it is aimed',
    check: checkTargetingModeDeclared,
  },
  {
    id: 'terrain-field',
    summary: 'a spell asks about walls only through sweepToWall, never the half-answers',
    check: checkTerrainField,
  },
  {
    id: 'buff-deactivate',
    summary: 'a buff is ended with deactivateBuff(), never the Spell-only deactivate()',
    check: checkBuffDeactivate,
  },
  {
    id: 'stat-resource-modifier',
    summary: 'current health and mana are never modified as ordinary stats',
    check: checkStatResourceModifier,
  },
  {
    id: 'spell-object-display-box',
    summary: 'every SpellObject subclass states the extent it paints',
    check: checkSpellObjectDisplayBox,
  },
  {
    id: 'spell-runtime-drive',
    summary: 'a spell test presses the spell, it does not call a runtime hook directly',
    check: checkSpellRuntimeDrive,
  },
  {
    id: 'world-mouse-in-spell-code',
    summary: 'a spell aims from its own target, never game.worldMouse',
    check: checkWorldMouseInSpellCode,
  },
];

export interface TaggedSeamViolation extends SeamViolation {
  seamId: string;
}

/** Runs every seam in `seams` against `root` and returns one combined list. */
export function checkSeams(root: string, options?: SeamCheckOptions): TaggedSeamViolation[] {
  return seams.flatMap(seam =>
    seam.check(root, options).map(violation => ({ seamId: seam.id, ...violation }))
  );
}

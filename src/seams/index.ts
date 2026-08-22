/**
 * `@moba2d/core/seams` — the engine's static-scan rules, exported as
 * runnable functions rather than left inlined inside
 * `tests/game/spells/*-seam.test.ts`.
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
 * `moba2d-check-seams ./src`. `package.json` names the package
 * `@moba2d/core` and declares that CLI as its `bin` (`moba2d-check-seams`)
 * — decided in batch 5 task 3. `packs/riot/package.json` and
 * `packs/reference/package.json` each run it against their own `./spells`
 * (and, for `packs/riot`, `./monsters`) — batch 5 task 6.
 *
 * ## Core checks its own tree too
 *
 * Core authors spell-shaped code of its own — `src/game/gameObject/
 * coreSpells/` (`BasicAttack`, `Recall`), `spellObjects/` and `buffs/` —
 * and every one of these thirteen rules applies to it exactly as it does to
 * a pack's. Root `package.json`'s own `check-seams` script runs the CLI
 * against those three directories (task 6 fix round 2: two hand-written
 * core tests had been *deleted* for having zero population today —
 * `coreSpells/` authors no `UNIT`-targeted spell and none that reads the
 * fog draw flag — which is correct only as long as something else still
 * catches the day that changes. This is that something else, run through
 * `verify` rather than left implicit).
 *
 * `attackableUnits/` is in that list too since fix round 4, and how it got
 * there is the point. It was excluded wholesale — it is unit-side plumbing,
 * not spell-authored code, and three rules have legitimate exceptions there
 * that a pack's spell tree never needs: `AttackableUnit.restoreMana` and
 * `Champion`'s health-bar read are the sanctioned non-`Spell.spendMana()`
 * mana paths ("granting is not billing"), `visibleToPlayerTeam` is
 * `FogOfWar`'s own draw flag *declared* there, and `drawDir`'s two
 * `game.worldMouse` reads are the player's own cursor, the one place in the
 * engine allowed to read it. But those five exceptions live in **two of the
 * directory's seven files**, and a directory-level exclusion is a permanent
 * hole for the other five: `AIChampion`, `Minion`, `Monster`, `Pet` and
 * `DummyChampion` are clean today and were not being checked by anything.
 * So the five exceptions are now five individually visible entries in
 * `src/game/gameObject/attackableUnits/seam-debt.mjs` — two pinned mana
 * lines, one pinned fog-flag file, two pinned cursor lines — each of which
 * reports itself stale the day it stops being true, and the whole directory
 * is under all thirteen rules like every other tree. That is what the
 * per-line `pinned` machinery bought.
 *
 * ## An exemption that matches nothing is also a violation
 *
 * Seven fields are every licence this module hands out to break a rule:
 * the shared `skip`, plus `grandfathered` (`castspec-frozen`),
 * `grandfatheredClasses` (`spell-object-display-box`), `grandfatheredTests`
 * (`spell-runtime-drive`), `grandfatheredFogReads` (`target-vision`),
 * `noPressOverride` (`unit-target-team`), `pinned`
 * (`world-mouse-in-spell-code`) and `pinnedManaLines` (`mana-spend`).
 * `maxMs` (`cooldowns`) is a threshold, not a licence. No two of those
 * names may collide, because `checkSeams(root, options)` hands **one**
 * options object to every seam: fix round 3 found two seams both calling
 * their set `grandfathered`, which made each report the other's entries
 * stale, and fix round 4 found a third (`spell-runtime-drive`) still
 * sharing the name. `tests/seams/seamOptionFields.test.ts` is what makes
 * the next collision impossible rather than merely fixed.
 *
 * Fix round 3 (task 6): a licence nobody ever revokes is how a seam
 * quietly stops meaning anything — the sharpest case is a `pinned`
 * `file:line` entry outliving the exact line it names, since the file
 * stays silently exempt at whatever now sits at that number. Every seam
 * that reads an exemption set now computes each entry's underlying
 * condition *regardless* of the exemption, and reports any entry that
 * never actually suppressed a real would-be violation — tagged `kind:
 * 'stale-exemption'` on the same `SeamViolation` shape, distinct from an
 * ordinary `kind: 'violation'` (the default), because "you broke a rule"
 * and "you are exempting something that no longer offends" are opposite
 * problems with opposite fixes. Both kinds fail `checkSeams`'s caller the
 * same way (a non-empty list), by design: an unrevoked licence is exactly
 * as much a reason to stop and look as a fresh violation is.
 *
 * **`skip` is the one exception, and it is an existence check** — checked
 * once, centrally (`staleSkipEntries` in `shared.ts`), since every seam
 * honours it identically. This paragraph used to claim consumption
 * checking for all five sets and was wrong about `skip` (fix round 4): a
 * `skip` entry names a file that is not spell-shaped code at all — a
 * barrel, a scaffolding template — so "did it suppress a violation" is not
 * what it means, and demanding one would report the correct, quiet answer
 * as stale. What can go stale about it is the file being renamed or
 * deleted, and that is what is reported.
 *
 * Every entry, in every set, is matched the same way: **the path relative
 * to the scanned root, or a bare basename matching at any depth**
 * (`exemptionFor` in `shared.ts`; `grandfatheredClasses` is the exception
 * that proves it, being keyed by class name and having no path at all).
 * Fix round 4: `skip` was basename-keyed and the seam-specific sets were
 * path-keyed, nothing said so, and a file in a subdirectory made a live,
 * load-bearing exemption report as stale while the violation it exempted
 * went red.
 */
import type { Seam, SeamCheckOptions, SeamViolation } from './types';
import { staleSkipEntries, walkTsFiles } from './shared';
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
import { checkPackCoreBoundary } from './packCoreBoundary';
import { checkPackAssetKey } from './packAssetKey';

export type { Seam, SeamCheck, SeamCheckOptions, SeamViolation } from './types';
export { staleSkipEntries } from './shared';
export { checkManaSpend, type ManaSpendOptions } from './manaSpend';
export { checkDashOnUpdate } from './dashOnUpdate';
export { checkTargetVision, type TargetVisionOptions } from './targetVision';
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
export {
  checkWorldMouseInSpellCode,
  type WorldMouseInSpellCodeOptions,
} from './worldMouseInSpellCode';
export { checkPackCoreBoundary } from './packCoreBoundary';
export { checkPackAssetKey } from './packAssetKey';
export { scanImports, type ImportKind, type ImportReference } from './importScan';

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

/**
 * The fourteenth rule, deliberately **not** in `seams` above: it is scoped
 * to a *package* rather than to whatever tree the caller points at, and it
 * does not apply to core's own trees at all (`@/...` is how core's source
 * refers to itself). `scripts/check-seams.mjs` runs it against the package
 * that owns the scanned tree, whenever that package is not core — see
 * `packCoreBoundary.ts`'s own header for why the rule had to move to this
 * side at all, and `owningPackage` in the CLI for how the question "whose
 * tree is this" is answered without a flag a pack could set for itself.
 */
export const packCoreBoundarySeam: Seam = {
  id: 'pack-core-boundary',
  summary: 'a pack reaches core through its public content subpaths and nowhere else',
  check: checkPackCoreBoundary,
};

/**
 * The fifteenth rule, package-scoped for the same reason as the fourteenth:
 * `api.asset()` is called from a pack's `pack.ts`, its maps and its monster
 * factories as readily as from a spell, and none of those sit under the tree
 * the CLI is pointed at. It used to be `tests/content/packAssetKeyBoundary.
 * test.ts` — a scan of all of `packs/` living in **core's** suite, so a
 * violation planted in a pack spell reddened core's build. See
 * `packAssetKey.ts`'s own header.
 */
export const packAssetKeySeam: Seam = {
  id: 'pack-asset-key',
  summary: "a pack resolves art through its own manifest, never a bare key from core's",
  check: checkPackAssetKey,
};

export interface TaggedSeamViolation extends SeamViolation {
  seamId: string;
}

/**
 * Every file `checkSeams(root, options)` walks — every seam does its own
 * `walkTsFiles(root, options)` internally, all reaching the same tree, so
 * one more walk with the same arguments answers for the whole set.
 *
 * Exists because `checkSeams` returning `[]` means two different things a
 * caller cannot tell apart from the return value alone: "scanned N files,
 * found nothing" and "root does not exist, or every file matched `skip`" —
 * an empty tree prints the same "clean" a genuinely clean pack does. This
 * repo's own recurring failure mode (`corePacksBoundary.test.ts`'s and
 * `TeamBlackboard.lanes.test.ts`'s own "finds files to scan, or this proves
 * nothing" guards exist for exactly this), now handed to every pack author
 * through the CLI's default output (`scripts/check-seams.mjs`) instead of
 * left to each caller to reinvent.
 */
export function scannedSeamFiles(root: string, options?: SeamCheckOptions): string[] {
  return walkTsFiles(root, options);
}

/**
 * Runs every seam in `seams` against `root` and returns one combined list,
 * plus `options.skip`'s own stale-exemption check (fix round 3) — `skip` is
 * shared, honoured identically by every seam via `walkTsFiles`, so it is
 * checked once here (`seamId: 'skip'`) rather than once per seam, which
 * would report the same dead entry thirteen times.
 */
export function checkSeams(root: string, options?: SeamCheckOptions): TaggedSeamViolation[] {
  const fromSeams = seams.flatMap(seam =>
    seam.check(root, options).map(violation => ({ seamId: seam.id, ...violation }))
  );
  const fromSkip = staleSkipEntries(root, options).map(violation => ({
    seamId: 'skip',
    ...violation,
  }));
  return [...fromSeams, ...fromSkip];
}

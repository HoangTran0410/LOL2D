/**
 * A spell asks about walls one way.
 *
 * Five abilities used to ask five different ways, and all five were wrong in
 * different places. Camille's grapple and Nautilus's anchor tested their own
 * position once a frame and took the first sample that came back inside — up to
 * a frame of travel *past* the surface, so Camille latched onto a point inside
 * the wall and dashed to it. Xin Zhao's shove and Vayne's condemn marched fixed
 * 20px steps, stopping that far short of a wall or stepping over one thinner
 * than a stride. Janna's monsoon intersected polygon edges, which finds nothing
 * when the victim starts inside a wall and blew them clean through it.
 *
 * `sweepToWall` is the one way now. It sweeps a body from A toward B and says
 * where a wall of either kind first stops it — map polygons and spell-made
 * slabs together, sub-pixel, and unable to skip anything because it advances by
 * the distance the field guarantees is clear.
 *
 * The pieces underneath are still exported, because `TerrainField` is built out
 * of them and `Anivia_W`/`JarvanIV_R` implement `DynamicWall` themselves. This
 * scan is what stops the next terrain-reading spell from reaching past the seam
 * to half an answer, the way `mana-spend-seam` and `target-vision` do for
 * their own.
 *
 * ## The BAN scan that used to live here is `check-seams` now, on both sides
 *
 * `src/seams/terrainField.ts` is that rule, exported. `packs/riot`'s own
 * `check-seams` runs it over `./spells` and `./monsters`, and core's own
 * `npm run check-seams` (in `verify`) runs it over `coreSpells/`,
 * `spellObjects/`, `buffs/` and `attackableUnits/` — so a pack violation
 * reddens the pack's build and a core violation reddens core's, and neither
 * needs a hand-written copy of the rule here. Batch 5 task 6 fix round 1
 * collapsed ten such duplicates into that CLI and the next commit gave core
 * its own invocation, which re-created the duplication from the other side;
 * the whole-branch review is what noticed. Proven before deleting: a planted
 * `pointInWall(this.game, 1, 2)` in `buffs/` and in `spellObjects/` produces
 * `terrain-field :: pointInWall` and exit 1 from each.
 *
 * Deleting it also retires two things the review flagged with it: a `> 20`
 * absolute floor over a population that was `spellObjects` 4 + `buffs` 24 +
 * `monsters` **0** (so `buffs/` alone cleared it and `spellObjects/`
 * dropping out was invisible), and a `SCANNED` entry naming
 * `src/game/gameObject/monsters`, a directory that has not existed since
 * batch 5 task 2.
 *
 * ## What stays, and why the CLI cannot take it
 *
 * The "is reached by every spell that needs terrain" pin: it names five
 * specific pack spells by path, the same way `cc-buff-icons.test.ts` pins
 * this pack's own champions — content-specific regression history, and the
 * *positive* direction, which a ban cannot express at all (a spell can
 * satisfy a ban by asking nothing). It is a pin about riot's content living
 * in core's suite, and it should travel with `tests/packs/riot/` when the
 * pack becomes a repository of its own.
 *
 * Task 7 note: that pin still hardcoded `packs/riot/spells` directly and
 * threw `ENOENT` the moment that directory left the tree, which is exactly
 * the failure task 8 needs `npm run verify` to survive — a pin about riot's
 * five spells has nothing to check once riot is not installed, so it now
 * skips (a legitimate "nothing to check") rather than crashing, and stays
 * loud if riot claims to be installed but one of the five files is gone.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packIsInstalled, requireRoot } from '../../support/installedPacks';

const REPO_ROOT = process.cwd();
const PACKS_DIR = join(REPO_ROOT, 'packs');
const RIOT_INSTALLED = packIsInstalled('riot');
const SPELL_DIR = join(PACKS_DIR, 'riot/spells');

/** Comments stripped, or the pin below reads its own prose as an answer. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the terrain seam', () => {
  it('is reached by every spell that needs terrain, when riot is installed', () => {
    // The other direction, and the one a ban alone cannot cover: a spell could
    // satisfy the ban by asking nothing at all. These five are the
    // abilities whose behaviour is defined by where a wall is, and each of them
    // has been wrong about it in a shipped build.
    //
    // content-pack-extraction batch 5 task 7: this pin names five specific
    // files under `packs/riot/spells` directly, which used to throw ENOENT
    // the moment that directory left the tree (task 8) — a pin about riot's
    // own content has nothing to check once riot is not installed, so that
    // is a legitimate skip. Installed-but-missing (the pack claims to be
    // here but one of these five files is gone) stays a real, loud failure.
    if (!RIOT_INSTALLED) return;
    requireRoot(SPELL_DIR, 'terrain-field-seam: packs/riot/spells');
    const mustSweep = ['Camille_E.ts', 'Nautilus_Q.ts', 'XinZhao_R.ts', 'Vayne_E.ts', 'Janna_R.ts'];

    for (const name of mustSweep) {
      const source = stripComments(readFileSync(join(SPELL_DIR, name), 'utf8'));
      expect(source, `${name} no longer asks the terrain seam anything`).toMatch(/\bsweepToWall\b/);
    }
  });
});

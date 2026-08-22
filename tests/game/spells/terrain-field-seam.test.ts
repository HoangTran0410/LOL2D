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
 * `packs/riot/spells/` and `packs/riot/monsters/` left the BAN scan below in
 * content-pack-extraction batch 5 task 6 fix round 1: `src/seams/
 * terrainField.ts` is the same rule, exported, and `packs/riot`'s own
 * `check-seams` script now runs it against both — `./spells` (`check-seams`)
 * and `./monsters` (`check-seams:monsters`, added this round for exactly
 * this) — so a pack violation reddens the pack's build, not this one. The
 * "is reached by every spell that needs terrain" pin below stays: it names
 * five specific pack spells by path, the same way `cc-buff-icons.test.ts`
 * pins this pack's own champions — content-specific regression history, not
 * a population scan a generic exported function could replace.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();
const GAME_OBJECT_ROOT = join(REPO_ROOT, 'src/game/gameObject');
const SPELL_DIR = join(REPO_ROOT, 'packs/riot/spells');

/**
 * Everywhere in *core's own tree* an ability's code can live, for the BAN
 * scan below. `spellObjects/` is where a skillshot's flight actually
 * happens, `buffs/` is where a dash's per-frame movement happens, and
 * `monsters/` drove camps before Baron's kit moved into `packs/riot/
 * monsters/` (Task 2 of the content-pack extraction) — that directory no
 * longer holds any `.ts` file (see `sourceFiles`'s own guard for why that
 * must not crash the scan), kept here so the history stays legible rather
 * than silently vanishing from this list.
 */
const SCANNED: { label: string; root: string }[] = [
  { label: 'spellObjects', root: join(GAME_OBJECT_ROOT, 'spellObjects') },
  { label: 'buffs', root: join(GAME_OBJECT_ROOT, 'buffs') },
  { label: 'monsters', root: join(GAME_OBJECT_ROOT, 'monsters') },
];

/**
 * Every `.ts` file under `root`, recursive (`spellObjects/` has
 * subdirectories) — or `[]` for a root that does not exist. Git tracks no
 * empty directory, so a scanned directory whose last file just moved out (as
 * `src/game/gameObject/monsters/` did in Task 2) is not merely empty, it is
 * gone; that has to read as "nothing to scan here," not a crash.
 */
const sourceFiles = (root: string): string[] => {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, encoding: 'utf8' }).filter(entry =>
    entry.endsWith('.ts')
  );
};

/**
 * The half-answers. `wallOutlinesInArea` returns raw polygon outlines, which is
 * every convex piece a wall was chopped into and no help with the seams between
 * them; `pointInWall` answers for a single point, which is what turns a moving
 * hook into a sampler that can overshoot or skip.
 *
 * `slabVertices`, `DynamicWall` and `isDynamicWall` are deliberately absent:
 * they are how a spell *declares itself* a wall, not how it reads one.
 */
const BANNED = ['wallOutlinesInArea', 'pointInWall'];

/** Comments stripped, or the scan flags the paragraph above. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const offendersIn = (source: string): string[] =>
  BANNED.filter(name => new RegExp(`\\b${name}\\b`).test(stripComments(source)));

describe('the terrain seam', () => {
  it('catches a spell that reaches past it', () => {
    // The scan proving itself before it is trusted to report zero. This is the
    // exact line Xin Zhao R carried until the migration, and a scan that cannot
    // see it would pass the suite below by seeing nothing at all.
    const asItWas = `
      import { pointInWall } from '@/game/gameObject/map/DynamicTerrain';
      if (pointInWall(this.game, x, y)) break;
    `;

    expect(offendersIn(asItWas)).toEqual(['pointInWall']);
    expect(offendersIn('// pointInWall is what this used to call\nconst a = 1;')).toEqual([]);
  });

  it('is the only way a spell asks about walls', () => {
    const offenders: string[] = [];
    let scanned = 0;

    for (const { label, root } of SCANNED) {
      for (const entry of sourceFiles(root)) {
        scanned++;
        const found = offendersIn(readFileSync(join(root, entry), 'utf8'));
        if (found.length > 0) offenders.push(`${label}/${entry}: ${found.join(', ')}`);
      }
    }

    // The scan covering nothing would report nothing. `spellObjects/` (4) +
    // `buffs/` (24) is ~28 files with headroom; the guard only has to be far
    // enough under that to catch a directory list that stopped resolving.
    expect(scanned).toBeGreaterThan(20);
    expect(offenders).toEqual([]);
  });

  it('is reached by every spell that needs terrain', () => {
    // The other direction, and the one a ban alone cannot cover: a spell could
    // satisfy the scan above by asking nothing at all. These five are the
    // abilities whose behaviour is defined by where a wall is, and each of them
    // has been wrong about it in a shipped build.
    const mustSweep = ['Camille_E.ts', 'Nautilus_Q.ts', 'XinZhao_R.ts', 'Vayne_E.ts', 'Janna_R.ts'];

    for (const name of mustSweep) {
      const source = stripComments(readFileSync(join(SPELL_DIR, name), 'utf8'));
      expect(source, `${name} no longer asks the terrain seam anything`).toMatch(/\bsweepToWall\b/);
    }
  });
});

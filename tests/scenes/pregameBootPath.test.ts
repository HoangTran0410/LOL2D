import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanImports, stripComments } from '@/seams/importScan';

/**
 * The pregame screen renders the roster without loading a spell.
 *
 * `SetupScene` used to open with `import * as AllSpells` two hops away — it
 * imported `preset.ts`, and `preset.ts` built `new SpellClass(...)` for all 238
 * abilities to read their names and icons. Vite's `manualChunks` sends anything
 * under `src/game/` to the `game` chunk, so choosing a champion meant fetching
 * and parsing the entire match: 1.1MB to draw a grid of pictures.
 *
 * It is now generated data (`src/generated/spellCatalog.ts`), and the pregame
 * chunk is ~133KB. One `import` of the wrong module puts the megabyte back,
 * with nothing in the source looking wrong and nothing but a bundle diff to
 * show for it — the same failure mode `menuBootPath.test.ts` exists for, one
 * screen further in.
 *
 * `import type` is fine and deliberately allowed: type-only imports are erased
 * before Rollup sees them.
 *
 * Batch 4 moved the 240 spells (and everything else Riot-content) out from
 * under `src/game/` entirely, into `packs/riot/`. The specifier this scan
 * used to catch the barrel with — `spells/index`, back when the barrel lived
 * at `src/game/gameObject/spells/index.ts` — no longer names anything: the
 * barrel is `packs/riot/spells/index.ts` now, a path with no `/game/` in it
 * at all, so `reachesTheMatch`'s `/game/`-substring test walks straight past
 * it. A pregame file reaching `packs/riot/spells` (the exact 1.1MB the
 * comment above is about) would pass both checks clean. `packs/` is now
 * banned outright: nothing on the pregame path has legitimate business
 * reaching into a content pack's own code — the generated catalog
 * (`@/game/config/spellCatalog`) is the sanctioned way to read a spell's name
 * and icon without touching its class.
 *
 * `staticImports` below is now a thin, value-only filter over
 * `src/seams/importScan.ts`'s `scanImports` rather than its own inline
 * parser — fix round 3 found this file's own copy shared a hole with
 * `menuBootPath.test.ts` and `aboutBootPath.test.ts`: all three anchored a
 * statement to a line start, so two statements sharing one line silently
 * dropped the second one's specifier. See `importScan.ts`'s own header.
 */
const ROOT = join(__dirname, '../..');
const SRC = join(ROOT, 'src');

/**
 * What the setup screen may still reach inside `src/game/`.
 *
 * Every one is class-free data or `localStorage`, and every one is carved into
 * the `pregame` chunk by `vite.config.ts`. Adding to this list means adding the
 * same path to that carve-out, or the chunking silently reverts.
 */
const ALLOWED_GAME_MODULES = [
  '@/game/config/PregameConfig',
  '@/game/config/MatchTeams',
  '@/game/config/savedKits',
  '@/game/config/spellCatalog',
  '@/game/config/renderPreferences',
  '@/game/config/zoomBounds',
  '@/game/constants',
  '@/game/input/touchPreferences',
  // The panel itself, which lives under `src/game/hud/config/` because it is
  // about a match — and is carved into the `pregame` chunk for exactly the
  // reason everything above it is. Only `MatchDirectorSource` in that directory
  // touches the match, and it is excluded from both the carve-out and the scan
  // below.
  '@/game/hud/config/MatchConfigPanel.vue',
  '@/game/hud/config/PregameConfigSource',
];

/** The adapter that is *supposed* to reach the match. See `matchConfigChunk.test.ts`. */
const MATCH_ONLY = 'MatchDirectorSource';

function pregameFiles(): string[] {
  const files = ['scenes/SetupScene.ts'];
  for (const name of readdirSync(join(SRC, 'scenes/setup'))) {
    if (name.endsWith('.ts') || name.endsWith('.vue')) files.push(`scenes/setup/${name}`);
  }
  for (const name of readdirSync(join(SRC, 'game/hud/config'))) {
    if (name.includes(MATCH_ONLY)) continue;
    if (name.endsWith('.ts') || name.endsWith('.vue')) files.push(`game/hud/config/${name}`);
  }
  return files;
}

/**
 * Static `import ... from '<spec>'` only, value ones — `import(` is dynamic,
 * `import type` (whole-statement or a fully type-prefixed inline clause) is
 * erased, and a side-effect `import 'x';` is not a shape this file has ever
 * checked for.
 */
function staticImports(source: string): string[] {
  return scanImports(source)
    .filter(({ kind }) => kind === 'value')
    .map(({ specifier }) => specifier);
}

const reachesTheMatch = (specifier: string): boolean =>
  ((specifier.startsWith('@/game/') || specifier.includes('/game/')) &&
    !ALLOWED_GAME_MODULES.includes(specifier)) ||
  // Batch 4: the spells (and every other piece of Riot content) live outside
  // `src/game/` now, so a reach into a pack's own code has no `/game/` in the
  // specifier at all and would otherwise walk straight past the check above.
  //
  // Batch 5 task 8 added the second spelling: a pack is resolvable by its own
  // *package* name now (`@moba2d/content-riot/spells`), which is the address a
  // pack has once it is a repository of its own — and which contains neither
  // `/game/` nor `packs/`. One rule, both spellings, or the check is aimed at
  // an address rather than at the thing.
  specifier.includes('packs/') ||
  specifier.startsWith('@moba2d/content-');

describe('the pregame screen boots without the match', () => {
  it('finds the files it claims to check', () => {
    const files = pregameFiles();
    // Per-root, not `> 10`. A total floor over a list built from two
    // directory reads plus one hard-coded entry is satisfiable by either
    // directory alone, so the failure it exists to catch — one of the two
    // stopping to resolve — is exactly the one it cannot see. Each source
    // answers for itself instead, which is the shape this batch settled on
    // for every population guard (`vocabularyBoundary`, `packAssetKey`).
    expect(files, 'scenes/SetupScene.ts left the list').toContain('scenes/SetupScene.ts');
    expect(
      files.filter(file => file.startsWith('scenes/setup/')).length,
      'scenes/setup/ contributed 0 files'
    ).toBeGreaterThan(0);
    expect(
      files.filter(file => file.startsWith('game/hud/config/')).length,
      'game/hud/config/ contributed 0 files'
    ).toBeGreaterThan(0);
    for (const file of files) {
      expect(() => readFileSync(join(SRC, file), 'utf8'), `${file} is missing`).not.toThrow();
    }
  });

  it('no pregame module statically imports the match', () => {
    const offenders: string[] = [];

    for (const file of pregameFiles()) {
      const source = stripComments(readFileSync(join(SRC, file), 'utf8'));
      for (const specifier of staticImports(source)) {
        if (reachesTheMatch(specifier)) offenders.push(`${file} -> ${specifier}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('nothing on the pregame path reaches the spell barrel', () => {
    // `preset.ts` is the specific module that used to do this, and the one an
    // editor auto-import is most likely to bring back — it still exports the
    // same names, so the code would compile and only the bundle would change.
    // `packs/riot/spells` (batch 4) is the same bug wearing the barrel's new
    // address, now that the 240 spells live outside `src/game/` entirely.
    const offenders: string[] = [];
    for (const file of pregameFiles()) {
      const source = stripComments(readFileSync(join(SRC, file), 'utf8'));
      if (/from\s*['"][^'"]*(?:game\/preset|spells\/index|packs\/[^'"]*\/spells)['"]/.test(source)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('vite.config still carves the pregame modules out of the game chunk', () => {
    // The source rule above is necessary and not sufficient: the imports can be
    // perfectly clean and the chunking still collapse, because `manualChunks`
    // is a path test and `src/scenes/setup/` sits outside `src/game/` while the
    // in-game practice panel imports the very same components. Delete the
    // carve-out and Rollup quietly folds the picker back into `game`.
    const config = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');
    expect(config).toMatch(/return 'pregame'/);
    expect(config).toContain("id.includes('src/scenes/setup/')");
    expect(config).toContain("id.includes('src/game/config/')");
    expect(config).toMatch(/return 'shared'/);
    expect(config).toMatch(/dom\\?\.utils/);
  });

  it('the scan can see a violation it is meant to catch', () => {
    const sample = `
      import { SpellGroups } from '@/game/preset';
      import { SLOT_COUNT } from '@/game/config/PregameConfig';
      import type Game from '@/game/Game';
      const later = () => import('@/game/Game');
    `;
    const caught = staticImports(sample).filter(reachesTheMatch);
    // the preset import only: not the allowed config one, not the type, not the dynamic
    expect(caught).toEqual(['@/game/preset']);
  });

  it('the scan catches the barrel at its post-batch-4 address too', () => {
    // The gap this task closed: a specifier with no `/game/` in it at all,
    // which the pre-batch-4 rule walked straight past.
    const sample = `
      import { Ahri_Q } from '../../../packs/riot/spells';
      import type { ContentApi } from '../../../src/content/ContentApi';
    `;
    const caught = staticImports(sample).filter(reachesTheMatch);
    expect(caught).toEqual(['../../../packs/riot/spells']);
  });

  it('the scan catches the barrel at its post-batch-5 package address too', () => {
    // The address a pack has once it is installed rather than vendored — no
    // `/game/`, no `packs/`. `src/generated/installedPacks.ts` is the one file
    // in core allowed to write it, and it is not on the pregame file list this
    // scan walks; anything on that list writing it is the same regression as
    // the line above wearing a different name.
    const sample = `
      import { Ahri_Q } from '@moba2d/content-riot/spells';
      import type { ContentPackData } from '@moba2d/core/content/ContentPack';
    `;
    const caught = staticImports(sample).filter(reachesTheMatch);
    expect(caught).toEqual(['@moba2d/content-riot/spells']);
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanImports, stripComments } from '@/seams/importScan';

/**
 * Nothing on the path to the menu may statically import the game.
 *
 * `MenuScene` used to `import GameScene` and `import SetupScene` at the top of
 * the file, and `SetupScene` imported `MenuScene` back. That cycle is a single
 * chunk, and because `GameScene` reaches the whole of `src/game/`, the menu's
 * chunk *was* the game: 1146KB minified, fetched and parsed before the logo
 * could be drawn. Making the two edges dynamic cut the boot path from ~1307KB
 * to ~172KB.
 *
 * It is a one-character regression to undo — an editor auto-import on a type
 * annotation is enough — and nothing about the source would look wrong
 * afterwards. The damage is only visible in a production bundle, which is why
 * this is a source scan rather than something `verify` would otherwise notice.
 *
 * `import type` is fine and deliberately allowed: type-only imports are erased
 * before Rollup sees them, so they cost nothing at runtime. `LoadingScene`
 * already relies on exactly that for its `MenuScene` type.
 *
 * `staticImports` below is now a thin, value-only filter over
 * `src/seams/importScan.ts`'s `scanImports` rather than its own inline
 * parser — fix round 3 found this file's own copy shared a hole with
 * `pregameBootPath.test.ts` and `aboutBootPath.test.ts`: all three anchored
 * a statement to a line start, so two statements sharing one line silently
 * dropped the second one's specifier. See `importScan.ts`'s own header.
 */
const SRC = join(__dirname, '../../src');

/** Every module that runs before, or as part of, drawing the main menu. */
const BOOT_PATH = [
  'main.ts',
  'scenes/LoadingScene.ts',
  'scenes/LoadingScene.vue',
  'scenes/MenuScene.ts',
  'scenes/MenuScene.vue',
  'scenes/gamePreload.ts',
];

/**
 * Static `import ... from '<spec>'` only, value ones — `import(` is a
 * dynamic import and is the sanctioned way to reach the game, `import type`
 * (whole-statement or an inline `{ type Foo }` clause where every member is
 * type-prefixed) is erased, and a side-effect `import 'x';` is not a shape
 * this file has ever checked for.
 */
function staticImports(source: string): string[] {
  return scanImports(source)
    .filter(({ kind }) => kind === 'value')
    .map(({ specifier }) => specifier);
}

const reachesGame = (specifier: string): boolean =>
  specifier.includes('@/game/') ||
  specifier.includes('/game/') ||
  /(^|\/)GameScene$/.test(specifier) ||
  /(^|\/)SetupScene$/.test(specifier);

/**
 * The collision and geometry libraries, which only a running match needs.
 *
 * A separate rule from `reachesGame` because it failed a different way and left
 * no trace in the source: `main.ts` imported `System` purely to hang it on
 * `window.ABC` for callers that no longer existed, so nothing looked wrong, the
 * entry chunk depended on `vendor-physics`, and Vite emitted a
 * `<link rel="modulepreload">` that fetched 44KB of collision code ahead of the
 * logo. Rollup will happily hoist them back the moment anything on this path
 * names them again.
 */
const PHYSICS_PACKAGES = ['detect-collisions', 'sat', 'poly-decomp', 'visibility-polygon'];

const reachesPhysics = (specifier: string): boolean =>
  PHYSICS_PACKAGES.includes(specifier) ||
  /(^|\/)libs\/(detect-collisions|SAT|poly-decomp|poly-visibility)$/.test(specifier);

describe('the menu boots without the game', () => {
  it('finds the boot-path files it claims to check', () => {
    for (const file of BOOT_PATH) {
      expect(() => readFileSync(join(SRC, file), 'utf8'), `${file} is missing`).not.toThrow();
    }
  });

  it('no boot-path module statically imports the game', () => {
    const offenders: string[] = [];

    for (const file of BOOT_PATH) {
      const source = stripComments(readFileSync(join(SRC, file), 'utf8'));
      for (const specifier of staticImports(source)) {
        if (reachesGame(specifier)) offenders.push(`${file} -> ${specifier}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('no boot-path module statically imports the physics libraries', () => {
    const offenders: string[] = [];

    for (const file of BOOT_PATH) {
      const source = stripComments(readFileSync(join(SRC, file), 'utf8'));
      for (const specifier of staticImports(source)) {
        if (reachesPhysics(specifier)) offenders.push(`${file} -> ${specifier}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('the two onward scenes are still reachable, dynamically', () => {
    const preload = readFileSync(join(SRC, 'scenes/gamePreload.ts'), 'utf8');
    // If these ever stop being dynamic imports the rule above would still pass
    // while the split silently disappeared, so assert the replacement exists.
    expect(preload).toMatch(/import\('\.\/GameScene'\)/);
    expect(preload).toMatch(/import\('\.\/SetupScene'\)/);
  });

  it('the scan can see a violation it is meant to catch', () => {
    const sample = `
      import GameScene from './GameScene';
      import type SetupScene from './SetupScene';
      import Spell from '@/game/gameObject/Spell';
      const later = () => import('./GameScene');
    `;
    const caught = staticImports(sample).filter(reachesGame);
    // the static value import and the deep one; not the type, not the dynamic
    expect(caught).toEqual(['./GameScene', '@/game/gameObject/Spell']);
  });

  it('the physics scan can see the import it was written for', () => {
    const sample = `
      import { System } from './libs/detect-collisions';
      import SAT from '@/libs/SAT';
      import PolyDecomp from 'poly-decomp';
      import SceneManager from './managers/SceneManager';
    `;
    const caught = staticImports(sample).filter(reachesPhysics);
    expect(caught).toEqual(['./libs/detect-collisions', '@/libs/SAT', 'poly-decomp']);
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * Static `import ... from '<spec>'` only. `import(` is a dynamic import and is
 * the sanctioned way to reach the game; `import type` is erased.
 */
function staticImports(source: string): string[] {
  const found: string[] = [];
  const pattern = /(^|\n)\s*import\s+(?!type\s)([^;'"]*?)from\s*['"]([^'"]+)['"]/g;
  for (const [, , clause, specifier] of source.matchAll(pattern)) {
    // `import { type Foo }` with nothing else is still type-only in effect,
    // but `verbatimModuleSyntax` is not on here, so treat any value import as real.
    if (/^\s*type\s/.test(clause)) continue;
    found.push(specifier);
  }
  return found;
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

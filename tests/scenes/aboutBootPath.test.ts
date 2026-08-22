import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanImports, stripComments } from '@/seams/importScan';

/**
 * The About screen — reachable from the menu, before any match exists — must
 * not drag `src/game/` in.
 *
 * It is not on the menu's own boot path (`menuBootPath.test.ts` covers that):
 * `MenuScene.vue` reaches it with a dynamic `import()`, the same way it
 * reaches `SetupScene`, so it gets its own chunk fetched only when a player
 * actually opens it. But nothing then checks *that* chunk stays light — a
 * single value import of a `src/game/` runtime symbol inside `AboutScene.vue`
 * or one of its data modules would sit behind the dynamic boundary,
 * invisible to `menuBootPath.test.ts` and to `chunks:check`'s MenuScene rule
 * alike, and would only show up as "why does reading the changelog fetch a
 * megabyte" on a real device. This is the seam that catches it, the same way
 * `matchConfigChunk.test.ts` does for the shared config panel.
 *
 * Comments are stripped before matching, or this test flags the paragraph
 * you are reading.
 *
 * `staticImports` below is now a thin, value-only filter over
 * `src/seams/importScan.ts`'s `scanImports` rather than its own inline
 * parser — fix round 3 found this file's own copy shared a hole with
 * `menuBootPath.test.ts` and `pregameBootPath.test.ts`: all three anchored
 * a statement to a line start, so two statements sharing one line silently
 * dropped the second one's specifier. See `importScan.ts`'s own header.
 */
const SRC = join(__dirname, '../../src');
const ABOUT_DIR = join(SRC, 'scenes', 'about');

/** `AboutScene.ts`/`.vue` plus every file the data directory holds. */
function aboutFiles(): string[] {
  const files = ['scenes/AboutScene.ts', 'scenes/AboutScene.vue'];
  if (existsSync(ABOUT_DIR)) {
    for (const name of readdirSync(ABOUT_DIR)) {
      if (name.endsWith('.ts') || name.endsWith('.vue')) files.push(`scenes/about/${name}`);
    }
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

const reachesGame = (specifier: string): boolean =>
  specifier.includes('@/game/') || specifier.includes('/game/');

describe('the About screen boots without the game', () => {
  it('finds the files it claims to check', () => {
    const files = aboutFiles();
    // Per-root, not `> 2`. The list is two hard-coded entries plus whatever
    // `scenes/about/` holds, so `> 2` is satisfied the moment that directory
    // yields a single file and says nothing if it stops resolving entirely —
    // and `existsSync` above makes a missing directory silent. The data
    // directory answers for itself instead.
    expect(files, 'scenes/AboutScene.ts left the list').toContain('scenes/AboutScene.ts');
    expect(
      files.filter(file => file.startsWith('scenes/about/')).length,
      'scenes/about/ contributed 0 files'
    ).toBeGreaterThan(0);
    for (const file of files) {
      expect(() => readFileSync(join(SRC, file), 'utf8'), `${file} is missing`).not.toThrow();
    }
  });

  it('no About-screen module statically imports the game', () => {
    const offenders: string[] = [];

    for (const file of aboutFiles()) {
      const source = stripComments(readFileSync(join(SRC, file), 'utf8'));
      for (const specifier of staticImports(source)) {
        if (reachesGame(specifier)) offenders.push(`${file} -> ${specifier}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('MenuScene reaches it only through a dynamic import', () => {
    const source = stripComments(readFileSync(join(SRC, 'scenes/MenuScene.ts'), 'utf8'));
    expect(staticImports(source).some(specifier => /AboutScene/.test(specifier))).toBe(false);
    expect(source).toMatch(/import\(['"]\.\/AboutScene['"]\)/);
  });

  it('the scan can see a violation it is meant to catch', () => {
    const sample = `
      import Champion from '@/game/gameObject/attackableUnits/Champion';
      import type Game from '@/game/Game';
      const later = () => import('@/game/Game');
    `;
    const caught = staticImports(sample).filter(reachesGame);
    expect(caught).toEqual(['@/game/gameObject/attackableUnits/Champion']);
  });
});

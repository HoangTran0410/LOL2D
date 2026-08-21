import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The match-config panel is mounted in two places: over a running match, where
 * the whole game is already loaded, and over the **menu**, where none of it is.
 *
 * One value import of a `src/game/` runtime symbol from the shared panel drags
 * the match into the menu's chunk — every spell, every unit, the navigation
 * grid — and nothing on screen looks wrong while it happens. `MenuScene.ts`'s
 * own file comment records the last time this was measured: 2.1MB fetched and
 * parsed before the logo could appear. `game/input/touchPreferences.ts` exists
 * for exactly this reason, split out of `TouchControls.ts` because a settings
 * panel asking "is touch mode on?" pulled the entire match with it.
 *
 * So: the seam and the panel components may name these types, and may not
 * import their values. `MatchDirectorSource.ts` is the one exception and the
 * point of the design — it is the adapter, it is only ever constructed from
 * inside the game chunk, and it holds all of the narrowing the panel used to
 * do inline.
 *
 * Comments are stripped before matching, or this test flags the paragraph you
 * are reading.
 */

const PANEL_DIR = 'src/game/hud/config';

/** The adapter, which is allowed everything below — see the file comment. */
const EXEMPT = new Set(['MatchDirectorSource.ts']);

/**
 * Modules whose *values* pull the match in. Matched against the import
 * specifier, so both `@/game/MatchDirector` and a relative path to it are
 * caught.
 */
const BANNED_MODULES = [
  'MatchDirector',
  'attackableUnits/Champion',
  'attackableUnits/AIChampion',
  'gameObject/Spell',
  'map/Camera',
  'game/Game',
  'hudInteractions',
  'managers/ObjectManager',
  'PregameConfigSource',
  // Batch 4: the 240 spells (and the rest of Riot's content) moved out of
  // `src/game/` into `packs/riot/`, so a value import of a real spell class
  // now has no `src/game/` substring in it at all — the same "the whole match
  // rides along" bug the rest of this list guards against, wearing a
  // specifier none of those patterns match.
  'packs/riot',
];

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|vue)$/.test(name)) out.push(full);
  }
  return out;
};

/**
 * Every `import ... from '<specifier>'` that is **not** `import type`. Inline
 * `import { type X }` is deliberately not credited: a line mixing a type and a
 * value import still emits the value, and requiring the whole statement to be
 * `import type` is the rule that is actually checkable by reading one token.
 */
const valueImports = (source: string): string[] => {
  const specifiers: string[] = [];
  const pattern = /^\s*import\s+(?!type\s)([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) specifiers.push(match[2]);
  return specifiers;
};

describe('match-config panel chunk discipline', () => {
  const files = walk(PANEL_DIR).filter(file => !EXEMPT.has(relative(PANEL_DIR, file)));

  it('scans a non-empty set of files', () => {
    // Guards the guard: a moved directory would otherwise turn this whole
    // suite into a green no-op.
    expect(files.length).toBeGreaterThan(0);
  });

  it('imports no game runtime value into the shared panel', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = stripComments(readFileSync(file, 'utf8'));
      for (const specifier of valueImports(source)) {
        const banned = BANNED_MODULES.find(module => specifier.includes(module));
        if (banned) offenders.push(`${file}: value import of '${specifier}'`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

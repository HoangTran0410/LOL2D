import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '../../src');

/** The adapter is the one file allowed to read the old roster. */
const ALLOWED = new Set(['content/bundledPack.ts', 'game/config/spellCatalog.ts']);

/**
 * Import specifiers, not bare words.
 *
 * `CHAMPION_KITS` appears in `src/game/config/spellCatalog.ts` because that is
 * where it is *declared*; the rule is about who reads it from elsewhere, so
 * the needle is the import, not the identifier.
 */
const BANNED = [
  /from\s+'@\/generated\/spellModules'/,
  /from\s+'@\/generated\/spellCatalog'/,
  /import\s*\{[^}]*\bCHAMPION_KITS\b[^}]*\}\s*from/,
];

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

function sourcesUnder(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourcesUnder(full, base));
    else if (name.endsWith('.ts') || name.endsWith('.vue')) out.push(full);
  }
  return out;
}

describe('the roster has exactly one source', () => {
  const files = sourcesUnder(SRC).filter(
    file => !ALLOWED.has(file.slice(SRC.length + 1).replace(/\\/g, '/'))
  );

  it('found sources to scan, or this proves nothing', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it.each(BANNED)('nothing outside the adapter reads %s', pattern => {
    const offenders: string[] = [];
    for (const file of files) {
      if (pattern.test(stripComments(readFileSync(file, 'utf8')))) {
        offenders.push(file.slice(SRC.length + 1));
      }
    }
    expect(offenders, 'read the roster through contentRegistry() instead').toEqual([]);
  });
});

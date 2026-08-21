import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '../../src');

/**
 * `content/install.ts` alone — the one place core's own generated spell
 * (`BasicAttack`) is folded onto the installed pack.
 *
 * Batch 4 task 7 deleted the other adapter, `content/bundledPack.ts`, and
 * with it `CHAMPION_KITS` — the roster this scan used to also guard against
 * a stray read of. That third rule is gone too, deliberately, rather than
 * left pointed at a symbol that no longer exists (a scan whose needle names
 * a deleted symbol is a scan that passes on every file forever, proving
 * nothing): the roster now lives under `packs/riot/data.ts`, real pack
 * content, and `tests/content/corePacksBoundary.test.ts` already refuses
 * *any* core file outside `content/install.ts` a reach into `packs/` at
 * all — a second, narrower scan aimed at the exact same risk would be
 * redundant, not an extra layer. What is left here is the risk that scan
 * cannot see: core's *own* generated barrel (`src/generated/spellCatalog.ts`,
 * `spellModules.ts` — a `src/` path, not a `packs/` one) read as a shortcut
 * around the registry, bypassing qualification and every other installed
 * pack.
 */
const ALLOWED = new Set(['content/install.ts']);

/**
 * Import specifiers, not bare words. Both are core's own generated barrels —
 * see `ALLOWED`'s own doc comment for what reading them directly bypasses.
 */
const BANNED = [/from\s+'@\/generated\/spellModules'/, /from\s+'@\/generated\/spellCatalog'/];

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

describe("core's own generated spell barrel has exactly one legitimate reader", () => {
  const files = sourcesUnder(SRC).filter(
    file => !ALLOWED.has(file.slice(SRC.length + 1).replace(/\\/g, '/'))
  );

  it('found sources to scan, or this proves nothing', () => {
    // Not the current count: this whole programme keeps moving files out of
    // `src/` (198 after batch 4 task 6, 199 after task 7 deleted
    // `bundledPack.ts` but added nothing back), and pinning this near
    // whatever the present size happens to be would make a later batch's
    // honest shrinkage look like this scan's own failure. 150 is
    // comfortably below any plausible "core accidentally emptied out"
    // reading while still refusing to pass against a scan that silently
    // matched nothing.
    expect(files.length).toBeGreaterThan(150);
  });

  it.each(BANNED)('nothing outside install.ts reads %s', pattern => {
    const offenders: string[] = [];
    for (const file of files) {
      if (pattern.test(stripComments(readFileSync(file, 'utf8')))) {
        offenders.push(file.slice(SRC.length + 1));
      }
    }
    expect(offenders, 'read the roster through contentRegistry() instead').toEqual([]);
  });
});

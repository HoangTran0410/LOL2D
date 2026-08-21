import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Core must not import out of `packs/` — with a short, named list of
 * temporary or permanent exceptions.
 *
 * `packBoundary.test.ts` guards the forward direction: a pack may only reach
 * core through the injected `ContentApi`. Nothing guarded the reverse until
 * this task, and batch 4 task 3 is the first time it could actually happen —
 * before it, `packs/riot/` held only vfx helpers, a monster's abilities and
 * the reference pack, none of which core imported directly. The move puts
 * 238 real spell files (and their generated catalogue) under `packs/riot/`,
 * and two places in core now have a genuine reason to reach for one:
 *
 * - `src/content/install.ts` — **permanent, by design.** This is Stage 1's
 *   pack loader; the whole point of the `ContentPackFactory` shape (see that
 *   file's own header) is that core statically imports a pack's factory
 *   today and dynamically imports the same shape from a URL in Stage 2. It
 *   already imports `packs/reference/pack` and will import `packs/riot/pack`
 *   directly once Task 7 deletes `bundledPack.ts`.
 * - `src/content/bundledPack.ts` — **temporary, with a date on it.** Its own
 *   header calls itself "scaffolding wrapping content that has not finished
 *   moving into `packs/riot/` yet" and names Task 7 as the task that deletes
 *   it. Exempted as a whole file rather than picked apart line by line: every
 *   reach it makes into `packs/riot/` (the generated catalogue, `Baron`'s
 *   abilities, `Recall`'s loader) is the same kind of bridge.
 * - `src/game/preset.ts` — **one named line.** `attachRecall` builds a
 *   `Recall` for every champion synchronously at construction, before the
 *   async spell-registry path a match's other kits go through even exists —
 *   `tests/content/coreSpells.test.ts` already pins this exact need. `Recall`
 *   presupposes a fountain (map content, not a mechanic every pack has), so
 *   it lives under `packs/riot/spells/` like any other spell rather than in
 *   core; nothing here assumes every future pack supplies one.
 * - `src/game/config/spellCatalog.ts` — **one named line.** `CHAMPION_KITS`
 *   types its spell ids against the pack's own generated `SpellCatalogId`
 *   union (type-only, erased at runtime) — the same adapter role
 *   `tests/content/rosterSource.test.ts` already names this file for.
 *
 * A source scan, in the shape of `packBoundary.test.ts`: a millisecond, and
 * it closes the class of mistake rather than one instance of it.
 */
const SRC = join(__dirname, '../../src');

/** Whole files exempted entirely — every `packs/` reach in them is the bridge. */
const EXEMPT_FILES = new Set(['content/install.ts', 'content/bundledPack.ts']);

/** `relativePath -> the exact specifiers that file may name.` */
const ALLOWED_LINES: Record<string, string[]> = {
  'game/preset.ts': ['../../packs/riot/spells/Recall'],
  'game/config/spellCatalog.ts': ['../../../packs/riot/generated/spellCatalog'],
};

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

function tsAndVueFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...tsAndVueFilesUnder(full));
    else if (name.endsWith('.ts') || name.endsWith('.vue')) out.push(full);
  }
  return out;
}

/** Every module specifier a file names in a way that resolves at bundle time. */
function specifiers(source: string): string[] {
  const out: string[] = [];
  const staticPattern = /^\s*(?:import|export)\s+(?:type\s+)?[\s\S]*?\bfrom\s+['"]([^'"]+)['"]/gm;
  let match: RegExpExecArray | null;
  while ((match = staticPattern.exec(source)) !== null) out.push(match[1]);
  const dynamicPattern = /\bimport\(\s*['"]([^'"]+)['"]/g;
  while ((match = dynamicPattern.exec(source)) !== null) out.push(match[1]);
  // `import.meta.glob('/packs/...')` is the natural Vite idiom for
  // enumerating a whole pack tree at once and is just as much a bundle-time
  // reach into packs/ as a single import() — a core file discovering it
  // could eagerly glob every spell in a pack was exactly the shape of
  // mistake this scan exists to catch.
  const globPattern = /\bimport\.meta\.glob\(\s*['"]([^'"]+)['"]/g;
  while ((match = globPattern.exec(source)) !== null) out.push(match[1]);
  return out;
}

describe('core does not import packs, outside the named exceptions', () => {
  const files = tsAndVueFilesUnder(SRC);

  it('finds core files to scan, or this proves nothing', () => {
    // A floor, not the current count (203): this whole programme is moving
    // files out of `src/`, and pinning this near the present size would make
    // a later batch's honest shrinkage look like this scan's own failure.
    // 20 is comfortably below any plausible "core accidentally emptied out"
    // reading while still refusing to pass against a scan that silently
    // matched nothing.
    expect(files.length).toBeGreaterThan(20);
  });

  it('no core file reaches packs/ except the documented bridge', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const relativePath = file.slice(SRC.length + 1).replace(/\\/g, '/');
      if (EXEMPT_FILES.has(relativePath)) continue;

      const source = stripComments(readFileSync(file, 'utf8'));
      for (const specifier of specifiers(source)) {
        if (!specifier.includes('/packs/')) continue;
        const allowed = ALLOWED_LINES[relativePath] ?? [];
        if (allowed.includes(specifier)) continue;
        offenders.push(`${relativePath}: ${specifier}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

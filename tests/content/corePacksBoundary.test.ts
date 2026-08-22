import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { scanImports, stripComments } from '@/seams/importScan';
import { srcSourceFilePaths } from '../support/srcTree';

/**
 * Core must not *value*-import out of `packs/` — anywhere, no exceptions.
 * A *type-only* import is allowed, and only at a short, named list of sites.
 *
 * `packBoundary.test.ts` guards the forward direction: a pack may only reach
 * core through the injected `ContentApi`. Nothing guarded the reverse until
 * batch 4 task 3, the first time it could actually happen — before it,
 * `packs/riot/` held only vfx helpers, a monster's abilities and the
 * reference pack, none of which core imported directly. The move put 238
 * real spell files (and their generated catalogue) under `packs/riot/`.
 *
 * Batch 5 task 1 tightened this from "an exact specifier, any import kind"
 * to "type-only, and only at a named site": `game/preset.ts` used to carry
 * the one *value* import this scan allowed — `attachRecall` building a
 * `Recall` for every champion synchronously at construction, before the
 * async spell-registry path a match's other kits go through even exists.
 * That was never a bridge with an end date, it was a wrong address: `Recall`
 * does not presuppose a *pack*, it presupposes a *fountain* (map content,
 * yes, but a mechanic every current map happens to grant, exactly the way
 * every kit presupposes a `BasicAttack`) — so it moved back to
 * `src/game/gameObject/coreSpells/Recall.ts`, beside `BasicAttack.ts`, and
 * `game/preset.ts` dropped out of this file's allow-list entirely: it no
 * longer names a single `packs/` specifier, typed or not. A core file that
 * needs the real, running `Recall` class imports it from `coreSpells/`
 * like any other core symbol; `src/content/install.ts` (below) is the one
 * place a `packs/`-declared champion's `recall: 'Recall'` string still gets
 * resolved against it, by folding core's class onto the pack's spells —
 * the same core-last fold that file already does for `BasicAttack`.
 *
 * One place in core still has a genuine reason to reach into `packs/`:
 *
 * - `src/content/install.ts` — **permanent, by design.** This is Stage 1's
 *   pack loader; the whole point of the `ContentPackFactory` shape (see that
 *   file's own header) is that core statically imports a pack's factory
 *   today and dynamically imports the same shape from a URL in Stage 2. It
 *   imports `packs/reference/pack` and `packs/riot/pack` directly — the
 *   latter used to go through `src/content/bundledPack.ts`'s own adapter,
 *   deleted in batch 4 task 7 (that file's own header called itself
 *   "scaffolding with a date on it" since batch 2). Exempted as a whole
 *   file rather than picked apart line by line: every reach it makes into
 *   `packs/riot/` (both halves of the pack, its generated manifest) is the
 *   same kind of loading, not a bridge with an end date any more.
 *
 * `src/game/config/spellCatalog.ts` used to be a second, narrower exception
 * — one named line, type-only, importing the pack's generated `SpellCatalogId`
 * union to type core's own public id. Batch 5 task 2 removed it: core's
 * `SpellCatalogId` is `string`, declared in that file with no import from
 * `packs/` at all, so `ALLOWED_TYPE_ONLY` below is empty. Left as a `Record`
 * rather than deleted outright — the shape a third exception would take if
 * one is ever genuinely needed again, same as `EXEMPT_FILES` above it.
 *
 * A source scan, in the shape of `packBoundary.test.ts`: a millisecond, and
 * it closes the class of mistake rather than one instance of it.
 *
 * The parser — "what does this file import, and is it a type or a value" —
 * lives in `src/seams/importScan.ts`, not here. Fix round 1 and round 2
 * each found and fixed a hole in a copy of it that used to live inline in
 * this file alone; round 3 found the same parser copied into five other
 * scans (`packBoundary.test.ts` among them, carrying the exact original,
 * still-vulnerable version) and extracted it once, for all six, rather than
 * patching each copy — see that module's own header for the full reasoning.
 * This file keeps only what is genuinely its own: which specifiers are
 * banned, which two sites are exempt, and why.
 */
const SRC = join(__dirname, '../../src');

/** Whole files exempted entirely — every `packs/` reach in them is the bridge. */
const EXEMPT_FILES = new Set(['content/install.ts', 'generated/installedPacks.ts']);

/**
 * The two ways a specifier can name a pack, and both have to be banned.
 *
 * `/packs/` was the only one that existed until content-pack-extraction batch
 * 5 task 8, because core reached both packs by relative path. That task made
 * `src/generated/installedPacks.ts` import the riot pack by *package* name
 * (`@moba2d/content-riot/pack`) — which is the whole point of it, since a
 * relative path resolves to nothing once the pack is a repository of its own
 * — and a specifier like that contains no `/packs/` at all. So the scan that
 * exists to stop core reaching into a pack could not see the one new file
 * that does. Adding the second pattern is what keeps this check aimed at the
 * rule rather than at the spelling the rule happened to have.
 */
const PACK_SPECIFIER = /(?:^|\/)packs\/|^@moba2d\/content-/;

/**
 * `relativePath -> the exact specifiers that file may name, and only as
 * `import type` — a *value* import of `packs/` is never allowed, anywhere.`
 *
 * Empty since batch 5 task 2 — see this file's own header for the one entry
 * that used to live here (`game/config/spellCatalog.ts`'s `SpellCatalogId`).
 */
const ALLOWED_TYPE_ONLY: Record<string, string[]> = {};

function tsAndVueFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...tsAndVueFilesUnder(full));
    else if (name.endsWith('.ts') || name.endsWith('.vue')) out.push(full);
  }
  return out;
}

interface Reference {
  specifier: string;
  /** Whole statement was `import type ...` / `export type ... from ...`. */
  typeOnly: boolean;
}

/**
 * Every module specifier a file names in a way that resolves at bundle time
 * — `src/seams/importScan.ts`'s `scanImports` answers "what does this
 * file import, and is it a type or a value" (static, side-effect and
 * dynamic alike; see that module's own header for why the parser moved
 * there in fix round 3, after two rounds of finding and re-finding the same
 * hole in a copy of it that lived only here). `typeOnly` here is just
 * `kind === 'type'` restated in the shape this file's own policy already
 * expects.
 *
 * `import.meta.glob('/packs/...')` is the one form `scanImports` does not
 * cover, deliberately: it is a Vite API call, not import syntax, and no
 * other scan this repository has needs it — see `importScan.ts`'s own
 * header. Layered on here, locally, on top of the shared parser's output.
 */
function references(source: string): Reference[] {
  const out: Reference[] = scanImports(source).map(({ specifier, kind }) => ({
    specifier,
    typeOnly: kind === 'type',
  }));
  // `import.meta.glob('/packs/...')` is the natural Vite idiom for
  // enumerating a whole pack tree at once and is just as much a bundle-time
  // reach into packs/ as a single import() — a core file discovering it
  // could eagerly glob every spell in a pack was exactly the shape of
  // mistake this scan exists to catch.
  for (const match of source.matchAll(/\bimport\.meta\.glob\(\s*['"]([^'"]+)['"]/g)) {
    out.push({ specifier: match[1], typeOnly: false });
  }
  return out;
}

describe('core does not import packs, outside the named exceptions', () => {
  const files = tsAndVueFilesUnder(SRC);

  it('finds core files to scan, or this proves nothing', () => {
    // Derived, not `> 20` — `srcSourceFilePaths()` is Vite's own walk of the
    // same directory, so a recursion that stopped descending moves one side
    // and not the other. See that helper for why a floor over `src/` is a
    // number about last month's tree.
    const viaVite = srcSourceFilePaths();

    expect(viaVite.length).toBeGreaterThan(0);
    expect(files.length).toBe(viaVite.length);
  });

  it('no core file reaches packs/ except the documented bridge', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const relativePath = file.slice(SRC.length + 1).replace(/\\/g, '/');
      if (EXEMPT_FILES.has(relativePath)) continue;

      const source = stripComments(readFileSync(file, 'utf8'));
      for (const { specifier, typeOnly } of references(source)) {
        if (!PACK_SPECIFIER.test(specifier)) continue;
        const allowed = ALLOWED_TYPE_ONLY[relativePath] ?? [];
        if (typeOnly && allowed.includes(specifier)) continue;
        offenders.push(
          typeOnly
            ? `${relativePath}: ${specifier}`
            : `${relativePath}: ${specifier} (imported as a value, not a type)`
        );
      }
    }

    expect(offenders).toEqual([]);
  });
});

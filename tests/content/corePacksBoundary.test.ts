import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

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
 * Two places in core still have a genuine reason to reach into `packs/`:
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
 * - `src/game/config/spellCatalog.ts` — **one named line, type-only.**
 *   `SpellCatalogId` types every catalogue id against the pack's own
 *   generated `SpellCatalogId` union (erased at runtime) — a compile-time
 *   check the rest of the engine's ids stay real, not a value this file
 *   carries at runtime.
 *
 * A source scan, in the shape of `packBoundary.test.ts`: a millisecond, and
 * it closes the class of mistake rather than one instance of it.
 */
const SRC = join(__dirname, '../../src');

/** Whole files exempted entirely — every `packs/` reach in them is the bridge. */
const EXEMPT_FILES = new Set(['content/install.ts']);

/**
 * `relativePath -> the exact specifiers that file may name, and only as
 * `import type` — a *value* import of `packs/` is never allowed, anywhere.`
 */
const ALLOWED_TYPE_ONLY: Record<string, string[]> = {
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

interface Reference {
  specifier: string;
  /** Whole statement was `import type ...` / `export type ... from ...`. */
  typeOnly: boolean;
}

/** Every module specifier a file names in a way that resolves at bundle time. */
function references(source: string): Reference[] {
  const out: Reference[] = [];
  const staticPattern = /^\s*(?:import|export)\s+(type\s+)?[\s\S]*?\bfrom\s+['"]([^'"]+)['"]/gm;
  let match: RegExpExecArray | null;
  while ((match = staticPattern.exec(source)) !== null) {
    out.push({ specifier: match[2], typeOnly: Boolean(match[1]) });
  }
  // A side-effect import — `import '../../packs/riot/spells/Yasuo_Q';` — has
  // no `from` clause, so the pattern above never sees it. It resolves at
  // bundle time exactly like a named import; only the binding is missing,
  // and it has no type-only form.
  const sideEffectPattern = /^\s*import\s+['"]([^'"]+)['"]/gm;
  while ((match = sideEffectPattern.exec(source)) !== null) {
    out.push({ specifier: match[1], typeOnly: false });
  }
  // Dynamic `import()` has no type-only form either — it is always a runtime load.
  const dynamicPattern = /\bimport\(\s*['"]([^'"]+)['"]/g;
  while ((match = dynamicPattern.exec(source)) !== null) {
    out.push({ specifier: match[1], typeOnly: false });
  }
  // `import.meta.glob('/packs/...')` is the natural Vite idiom for
  // enumerating a whole pack tree at once and is just as much a bundle-time
  // reach into packs/ as a single import() — a core file discovering it
  // could eagerly glob every spell in a pack was exactly the shape of
  // mistake this scan exists to catch.
  const globPattern = /\bimport\.meta\.glob\(\s*['"]([^'"]+)['"]/g;
  while ((match = globPattern.exec(source)) !== null) {
    out.push({ specifier: match[1], typeOnly: false });
  }
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
      for (const { specifier, typeOnly } of references(source)) {
        if (!specifier.includes('/packs/')) continue;
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

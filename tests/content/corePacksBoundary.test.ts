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

/**
 * A static `import ... from '...'` / `export ... from '...'` clause,
 * wherever one starts — bounded only by the one delimiter JavaScript
 * actually guarantees: the `import`/`export` keyword itself.
 *
 * Fix round 1 bounded on the statement's own terminating `;` instead, and
 * fix round 2 found that boundary was still wrong: JS does not require a
 * semicolon (ASI), so a `from`-less or type-only statement with none —
 * `import type { X } from './y'` on its own line, no `;` — let `[^;]*;`
 * walk straight through the newline and swallow the *next* statement whole,
 * and two statements sharing one line (`import type { A } from './a';
 * import { B } from './b';`) meant the second one never started at a line
 * boundary `^` could see at all. Both silently **dropped** the second
 * statement's specifier — not misclassified, absent — which is the more
 * dangerous shape of the same bug round 1 fixed: a hole in exactly the rule
 * this file enforces, invisible because the scan reported nothing at all.
 * Both reproduced in `references()`'s own self-test below, alongside round
 * 1's original two.
 *
 * The fix: stop delimiting on `;` or a line start and use `\b(?:import|
 * export)\b` as the only boundary a match may not cross, between the
 * keyword and its own `from`. Critically, that restriction covers only the
 * *clause* — `{ X }`, `type { X }`, `* as X` — and stops the instant `from
 * '` is found; the specifier itself, captured by the plain `[^'"]+` after
 * it, sits outside the restricted span on purpose. An earlier version of
 * this fix restricted matching to whole pre-split "statements" first and
 * extracted `from` from each one after — which reintroduced the identical
 * bug one level down: an import whose own specifier happens to contain the
 * word `import` (hyphen- or dot-bounded, e.g. a hypothetical
 * `'my-import-lib'`) tripped the *same* keyword lookahead while still
 * inside that specifier's own text and cut the statement short before its
 * closing quote, dropping it. Verified this is not reachable in this
 * repository's current `src/` today (grepped every `from '...'` specifier
 * for the word `import`/`export`: zero hits) but the combined, single-pass
 * regex below does not depend on that being true — the specifier is simply
 * never inside the restricted span at all.
 *
 * **Stated limit, not fixed:** a `from '...'`-shaped string literal sitting
 * between a keyword that does not itself take a `from` clause (`export
 * default function foo() { ... }`) and the next real `import`/`export`
 * keyword could produce a false match — the restricted span's job is only
 * "do not cross a keyword", not "know what is inside a string". This is a
 * false *positive* (an innocent file wrongly flagged), not the dangerous
 * direction this scan exists to close — a real `/packs/` reach could never
 * hide behind it, since the false match would still have to name a
 * `/packs/`-containing specifier to ever surface as an offender. Checked
 * for it directly rather than only reasoning about it: grepped `src/` for
 * any quoted `from '...'`/`from "..."` text outside real import syntax —
 * the only two hits are English prose inside doc comments ("tell 'it died'
 * from 'it walked out of my sight'"), which `stripComments()` already
 * removes before this function ever sees them. Not reachable in real
 * (non-comment) source in this repository today; contrived only.
 */
const STATIC_PATTERN =
  /\b(?:import|export)\b\s+(type\s+)?(?:(?!\b(?:import|export)\b)[\s\S])*?\bfrom\s+['"]([^'"]+)['"]/g;

/**
 * A bare side-effect import — `import '../../packs/riot/spells/Yasuo_Q';`
 * — has no `from` clause and nothing between the keyword and its specifier,
 * so unlike `STATIC_PATTERN` it needs no keyword-boundary restriction at
 * all to stay inside one statement: `\s+['"]` immediately after `import`
 * cannot match a named clause (`{ X }`), `type`, or a dynamic call's `(`,
 * so it is unambiguous wherever it occurs — no `^`/line-start anchor
 * needed either, which is what let round 2's "two imports on one line"
 * case reach a side-effect import too.
 */
const SIDE_EFFECT_PATTERN = /\bimport\s+['"]([^'"]+)['"]/g;

/** Every module specifier a file names in a way that resolves at bundle time. */
function references(source: string): Reference[] {
  const out: Reference[] = [];

  for (const match of source.matchAll(STATIC_PATTERN)) {
    out.push({ specifier: match[2], typeOnly: Boolean(match[1]) });
  }
  for (const match of source.matchAll(SIDE_EFFECT_PATTERN)) {
    out.push({ specifier: match[1], typeOnly: false });
  }
  // Dynamic `import()` has no type-only form either — it is always a runtime load.
  for (const match of source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]/g)) {
    out.push({ specifier: match[1], typeOnly: false });
  }
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

describe("references() cannot let one statement borrow another one's from clause", () => {
  // Reproduction A, from the fix-round review: a from-less statement ahead
  // of a real *value* import of the one allow-listed pack specifier. Before
  // the fix, the lazy file-wide match walked through the semicolon and
  // attached `export type`'s `type` keyword to this import instead — a
  // genuine value import reading as type-only is a hole in exactly the rule
  // this file exists to enforce (it would have passed the scan silently).
  it('does not let an earlier from-less "export type" lend its type-only flag to a later value import', () => {
    const sample = [
      'export type { Something };',
      "import { spellCatalog } from '../../../packs/riot/generated/spellCatalog';",
    ].join('\n');

    expect(references(sample)).toEqual([
      { specifier: '../../../packs/riot/generated/spellCatalog', typeOnly: false },
    ]);
  });

  // Reproduction B: the reverse leak. A from-less side-effect import ahead
  // of a real `import type` — before the fix, the same lazy match skipped
  // the side-effect statement (no `from` of its own) and read the next
  // statement's specifier without its `type` keyword, reporting a real
  // type-only import as a value import (a false positive).
  it('does not let an earlier from-less side-effect import erase a later "import type"\'s flag', () => {
    const sample = [
      "import './side-effect';",
      "import type { SpellCatalogId } from '../../../packs/riot/generated/spellCatalog';",
    ].join('\n');

    // `STATIC_PATTERN` runs its whole pass before `SIDE_EFFECT_PATTERN`
    // starts its own, so the static (`from`-bearing) match lands first in
    // the array regardless of which statement appears first in the source
    // — order here reflects that, not source position.
    expect(references(sample)).toEqual([
      { specifier: '../../../packs/riot/generated/spellCatalog', typeOnly: true },
      { specifier: './side-effect', typeOnly: false },
    ]);
  });

  // Round 2, reproduction 1: the statement `references()` anchors on has no
  // `from` of its own and, this time, no trailing `;` either — ASI makes
  // the semicolon optional, so round 1's `[^;]*;` bound walked straight
  // through the newline and swallowed the next statement whole, reporting
  // only the first specifier and dropping the second (the allow-listed
  // pack one) entirely — not misclassified, absent.
  it('does not drop a value import that follows a semicolon-less statement', () => {
    const sample = [
      "import type { Something } from './types'",
      "import { spellCatalog } from '../../../packs/riot/generated/spellCatalog';",
    ].join('\n');

    expect(references(sample)).toEqual([
      { specifier: './types', typeOnly: true },
      { specifier: '../../../packs/riot/generated/spellCatalog', typeOnly: false },
    ]);
  });

  // Round 2, reproduction 2: two statements sharing one line. Round 1's
  // `STATEMENT_PATTERN` anchored each statement to `^` (a line start), so
  // the second import — mid-line, right after the first one's `;` — never
  // started a match at all and its specifier was dropped outright.
  it('does not drop the second of two import statements sharing one line', () => {
    const sample =
      "import type { A } from './a'; import { spellCatalog } from '../../../packs/riot/generated/spellCatalog';";

    expect(references(sample)).toEqual([
      { specifier: './a', typeOnly: true },
      { specifier: '../../../packs/riot/generated/spellCatalog', typeOnly: false },
    ]);
  });
});

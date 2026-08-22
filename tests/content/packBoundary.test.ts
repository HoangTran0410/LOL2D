import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { scanImports, stripComments } from '../support/importScan';

/**
 * A pack may reach core through the injected `ContentApi` and nowhere else.
 *
 * This is the rule the whole extraction rests on. A pack that deep-imports
 * `@/game/gameObject/buffs/Slow` compiles and runs perfectly today and cannot
 * be extracted tomorrow — the failure is invisible until the directory moves
 * to another repository and every one of those specifiers stops resolving.
 *
 * A scan rather than a lint rule, for the same reason the other seams in this
 * repo are scans (`matchConfigChunk.test.ts`, `dash-onupdate-seam.test.ts`,
 * `mana-spend-seam.test.ts`): it costs a millisecond, it closes the class
 * rather than an instance, and it is the shape of mistake `tsc` is happiest
 * to accept — a well-typed import is still an import that will not resolve
 * once the directory moves.
 *
 * `@/content/ContentApi`, `@/content/ContentPack` and `@/content/types` are
 * the three exceptions, and they are **type-only** — `ContentApi` also
 * exports a real function, `buildContentApi()`, that only core's
 * `install.ts` may call, so a pack writing
 * `import { buildContentApi } from '@/content/ContentApi'` (no `type`
 * keyword) is reaching for a value, not a type, and is banned exactly like
 * any other core import. The API itself arrives as the argument to the
 * pack's factory; it is never imported as a value. `@/content/types` is the
 * barrel a pack actually reaches for most — `CastContext`, `CastSpec` and
 * the rest of the runtime types re-exported for a channelled or charged
 * spell to name without a direct `@/game/` import.
 *
 * Comments are stripped before matching, or this file's own paragraphs above
 * would flag themselves.
 *
 * The parser itself — "what does this file import, and is it a type or a
 * value" — is `tests/support/importScan.ts`'s `scanImports`, not a copy
 * inline here. Fix round 3 of content-pack-extraction batch 5 task 1 found
 * this file carrying the *exact original* version of the regex two earlier
 * rounds had already found and fixed two holes in, over in
 * `corePacksBoundary.test.ts` — a value import misclassified as type-only,
 * and a specifier silently dropped whenever a statement had no trailing
 * semicolon or two statements shared one line. This file is the rule the
 * whole content-pack extraction rests on, so it carried both holes into
 * every task that leans on it. See `importScan.ts`'s own header for the
 * fix and why it now lives in one place instead of six.
 */
const PACKS_DIR = join(__dirname, '../../packs');

/** The only three specifiers a pack file may name, and only as `import type`. */
const ALLOWED_TYPE_ONLY = new Set([
  '@/content/ContentApi',
  '@/content/ContentPack',
  '@/content/types',
]);

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...tsFilesUnder(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

interface Reference {
  specifier: string;
  /** Whole statement was `import type ...` / `export type ... from ...`. */
  typeOnly: boolean;
}

/**
 * Every module specifier a file names in a way that must resolve at bundle
 * time: a static `import`/`export ... from`, and a dynamic `import(...)`.
 * `export ... from '...'` is a re-export of core through the pack, which is
 * exactly as much of a leak as importing it directly, so `scanImports`
 * already covers both under the same `import`/`export` alternation rather
 * than a separate pattern.
 *
 * Deliberately excludes `scanImports`'s `'side-effect'` kind: this file's
 * rule has never checked a bare `import 'x';` for one, and preserving that
 * — rather than silently widening what counts as an offense the moment a
 * shared parser makes it easy to — is fix round 3's own instruction.
 */
function references(source: string): Reference[] {
  return scanImports(source)
    .filter(({ kind }) => kind !== 'side-effect')
    .map(({ specifier, kind }) => ({ specifier, typeOnly: kind === 'type' }));
}

describe('the pack boundary', () => {
  const files = tsFilesUnder(PACKS_DIR);

  it('finds packs to scan, or this proves nothing', () => {
    // Guards the guard: an empty `packs/` (moved directory, wrong glob) would
    // otherwise leave every assertion below vacuously green forever.
    expect(files.length).toBeGreaterThan(0);
  });

  it('no pack file reaches core outside the injected API', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const relativePath = file.slice(PACKS_DIR.length + 1);
      const source = stripComments(readFileSync(file, 'utf8'));

      for (const { specifier, typeOnly } of references(source)) {
        const isAliased = specifier.startsWith('@/');
        // `../../src/...` is `@/...` wearing a different specifier — same
        // destination, reached by walking out of `packs/` instead of through
        // the alias. Anything shallower than `/src/` (e.g. a sibling pack
        // under `../other-pack/`) is pack reaching pack, not pack reaching
        // core, and is out of scope for this rule.
        const isRelativeEscape = specifier.startsWith('.') && specifier.includes('/src/');

        if (!isAliased && !isRelativeEscape) continue;

        if (isRelativeEscape) {
          offenders.push(`${relativePath}: ${specifier}`);
        } else if (!ALLOWED_TYPE_ONLY.has(specifier)) {
          offenders.push(`${relativePath}: ${specifier}`);
        } else if (!typeOnly) {
          offenders.push(`${relativePath}: ${specifier} (imported as a value, not a type)`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve as resolvePath, sep } from 'node:path';
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
 * Batch 5 task 4 made the pack a real npm package (`@moba2d/content-riot`,
 * `@moba2d/content-reference`) that resolves core through node resolution —
 * `@moba2d/core/...` — rather than through `@/...`, an alias core's own
 * config declares and a separated pack repository will never see. The three
 * exceptions below therefore moved with it: `@moba2d/core/content/ContentApi`,
 * `@moba2d/core/content/ContentPack` and `@moba2d/core/content/types` are the
 * only specifiers a pack file may name, and they are **type-only** —
 * `ContentApi` also exports a real function, `buildContentApi()`, that only
 * core's `install.ts` may call, so a pack writing
 * `import { buildContentApi } from '@moba2d/core/content/ContentApi'` (no
 * `type` keyword) is reaching for a value, not a type, and is banned exactly
 * like any other core import. The API itself arrives as the argument to the
 * pack's factory; it is never imported as a value. `@moba2d/core/content/types`
 * is the barrel a pack actually reaches for most — `CastContext`, `CastSpec`
 * and the rest of the runtime types re-exported for a channelled or charged
 * spell to name without a direct `@/game/` import.
 *
 * A bare `@/...` specifier is now banned outright rather than allow-listed:
 * it is the old, no-longer-legitimate way in, and a pack file that still used
 * it would keep resolving today (core's own `tsconfig.json`/`vite.config.ts`
 * still declare the alias for `src/`'s own use) while silently being unable
 * to resolve at all once the pack leaves this repository. A bare `src/...`
 * specifier and any relative path that resolves outside the importing file's
 * own pack directory (`packs/<name>/`) are banned the same way — a workspace
 * package can only ever reach a *sibling* package (core, or another pack)
 * through that package's declared name, never by walking there.
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
  '@moba2d/core/content/ContentApi',
  '@moba2d/core/content/ContentPack',
  '@moba2d/core/content/types',
]);

/** The workspace package name core is published under. */
const CORE_PACKAGE = '@moba2d/core';

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
 * time: a static `import`/`export ... from`, a bare side-effect
 * `import 'x';`, and a dynamic `import(...)`. `export ... from '...'` is a
 * re-export of core through the pack, which is exactly as much of a leak as
 * importing it directly, so `scanImports` already covers both under the same
 * `import`/`export` alternation rather than a separate pattern.
 *
 * Unlike the version of this rule that predates batch 5 task 4, side-effect
 * imports (`scanImports`'s `'side-effect'` kind) are no longer excluded. That
 * exclusion was correct while a pack lived inside core's own repository and
 * `@/...` was a legitimate, working alias — this rule had simply never had
 * occasion to check a bare `import 'x';` for one. Once a pack is a package
 * that resolves core by name, a bare `import '@moba2d/core/...';` is exactly
 * the runtime coupling this whole programme exists to prevent: it survives
 * `tsc`, Vite and Vitest today precisely because nothing before this task
 * checked it. A side-effect import can never be `import type`, so the
 * widening needs no new branch below — `typeOnly` is already `false` for
 * that kind, which is what makes even an otherwise-allowed specifier
 * (`@moba2d/core/content/ContentApi`) an offender when reached this way.
 */
function references(source: string): Reference[] {
  return scanImports(source).map(({ specifier, kind }) => ({
    specifier,
    typeOnly: kind === 'type',
  }));
}

/** The pack root (`packs/<name>`) that owns `file`. */
function packRootFor(file: string): string {
  const packName = relative(PACKS_DIR, file).split(sep)[0];
  return join(PACKS_DIR, packName);
}

/**
 * Whether a relative specifier, resolved from `file`'s own directory, lands
 * outside `file`'s own pack root — reaching core's `src/`, a sibling pack, or
 * anything else by walking there instead of through a declared package name.
 */
function escapesOwnPackage(file: string, specifier: string): boolean {
  if (!specifier.startsWith('.')) return false;
  const resolved = resolvePath(dirname(file), specifier);
  const root = packRootFor(file);
  return resolved !== root && !resolved.startsWith(root + sep);
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
        const isOldAlias = specifier.startsWith('@/');
        const isBareSrc = specifier === 'src' || specifier.startsWith('src/');
        const isCorePackage = specifier === CORE_PACKAGE || specifier.startsWith(`${CORE_PACKAGE}/`);
        const isRelativeEscape = escapesOwnPackage(file, specifier);

        if (!isOldAlias && !isBareSrc && !isCorePackage && !isRelativeEscape) continue;

        if (isOldAlias || isBareSrc || isRelativeEscape) {
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

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

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
 */
const PACKS_DIR = join(__dirname, '../../packs');

/** The only three specifiers a pack file may name, and only as `import type`. */
const ALLOWED_TYPE_ONLY = new Set([
  '@/content/ContentApi',
  '@/content/ContentPack',
  '@/content/types',
]);

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

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
 * exactly as much of a leak as importing it directly, so it is covered by
 * the same pattern as `import ... from '...'` rather than a separate one.
 */
function references(source: string): Reference[] {
  const out: Reference[] = [];

  const staticPattern = /^\s*(?:import|export)\s+(type\s+)?[\s\S]*?\bfrom\s+['"]([^'"]+)['"]/gm;
  let match: RegExpExecArray | null;
  while ((match = staticPattern.exec(source)) !== null) {
    out.push({ specifier: match[2], typeOnly: Boolean(match[1]) });
  }

  // Dynamic import('...') has no type-only form — it is always a runtime load.
  const dynamicPattern = /\bimport\(\s*['"]([^'"]+)['"]/g;
  while ((match = dynamicPattern.exec(source)) !== null) {
    out.push({ specifier: match[1], typeOnly: false });
  }

  return out;
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

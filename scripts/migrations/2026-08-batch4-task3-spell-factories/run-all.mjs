/**
 * One-off codemod: batch 4, task 3 of the content-pack extraction.
 *
 * Converted the 238 real spell files under `src/game/gameObject/spells/`
 * (240 minus the `index.ts` barrel and the `_EmptyExample.ts` template) from
 * plain classes value-importing core (`import Spell from
 * '@/game/gameObject/Spell'`) into the pack factory shape every pack spell
 * must use (`export default function makeFoo(api: ContentApi) { ... }`) —
 * the only way for `packs/riot/spells/` to satisfy `packBoundary.test.ts`,
 * which forbids a pack from reaching core outside the injected `ContentApi`.
 *
 * Kept in the commit, not deleted, so a reviewer can see the transformation
 * itself rather than only its output — see `task-3-report.md` in
 * `.superpowers/sdd/2026-08-21-content-pack-extraction-batch-4/` for the
 * measured import surface, the exceptions it found, and how each piece here
 * was verified (a real `tsc --noEmit -p tsconfig.strict-core.json`, and
 * constructing every factory against a real `ContentApi` to catch runtime
 * issues — e.g. same-file mutual value cycles like `Zed_W`/`Zed_W_Clone`, and
 * unmemoized factories breaking class identity across independent callers —
 * that a type-only check cannot see).
 *
 * Files:
 *   api-map.mjs   — the `@/`-specifier -> `ContentApi` access-path table,
 *                   measured against `src/content/ContentApi.ts`'s real
 *                   surface, plus the handful of type-only gaps this task
 *                   found and added to `src/content/types.ts`.
 *   parse.mjs      — TypeScript-compiler-API parsing of one file's imports
 *                   and top-level declarations.
 *   analyze.mjs    — cross-file fixpoint classifying every top-level
 *                   declaration as `class` / `factory` (a plain function or
 *                   const that itself needs an api-bound value) / `plain`
 *                   (pure tuning constants — the majority) / `type`.
 *   scc.mjs        — Tarjan's algorithm, for the same-file mutual-value-
 *                   cycle case (`Zed_W`, `Malzahar_E`, `Ezreal_W`,
 *                   `Syndra_Q`): those get one shared, memoized builder
 *                   instead of two factories calling each other forever.
 *   transform.mjs  — emits the final file per the classification above.
 *   run-all.mjs    — this file: drives `transform.mjs` over every real
 *                   spell file.
 *   fix-tests.mjs  — the sibling codemod for the ~90 test files that
 *                   imported a spell class directly and constructed it; not
 *                   run over test *directories* (batch 4 task 5's job) or
 *                   test *behaviour*, only the import/construction shape.
 *
 * `packs/riot/spells/_EmptyExample.ts` (the spell-authoring template) is
 * hand-written, not run through this codemod — it is documentation, not real
 * content — and lives only at its real path; no copy is kept here.
 *
 * Re-running today would no-op productively (regenerate byte-identical
 * output against the already-migrated tree) — the source directory this
 * read from, `src/game/gameObject/spells/`, no longer exists.
 */
import { listSpellFiles, parseAllFiles, buildRegistry } from './analyze.mjs';
import { transformFile } from './transform.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const files = listSpellFiles();
const parsed = parseAllFiles(files);
const { registry } = buildRegistry(parsed);

mkdirSync('.codemod-scratch/out-all', { recursive: true });

let errors = 0;
for (const base of parsed.keys()) {
  try {
    const out = transformFile(base, parsed.get(base), registry, parsed);
    writeFileSync(`.codemod-scratch/out-all/${base}.ts`, out);
  } catch (e) {
    errors++;
    console.error(`FAILED: ${base}: ${e.message}`);
  }
}
console.log('total:', parsed.size, 'errors:', errors);

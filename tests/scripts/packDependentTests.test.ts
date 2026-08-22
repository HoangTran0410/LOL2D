import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
// @ts-expect-error — a plain .mjs build helper, shared with `vitest.config.ts`,
// with no types of its own and not part of any TypeScript program.
import { packDependentTests, readSource } from '../../scripts/pack-dependent-tests.mjs';

const ROOT = join(__dirname, '../..');

/**
 * `scripts/pack-dependent-tests.mjs` decides which test files Vitest skips
 * when a content pack this checkout does not have is their subject. It is the
 * thing that lets `npm run verify:without-packs` — content-pack-extraction
 * batch 5 task 8's departure drill — start at all: Vitest resolves every
 * collected file's imports before running anything, so one unresolvable
 * `packs/riot/spells/Yasuo_Q` fails the whole run rather than the file that
 * named it.
 *
 * Two properties matter and both have already been wrong once:
 *
 *   - **it excludes nothing in an ordinary checkout.** A deriver that
 *     over-matches silently deletes tests from every run anybody ever does,
 *     and the only symptom is a smaller number nobody was watching.
 *   - **it does not mistake a quoted import for a real one.** A source-scanning
 *     test's own fixture is an import statement written out as data, and this
 *     repository has both spellings — a template literal in
 *     `pregameBootPath.test.ts`, a double-quoted string in
 *     `importScan.test.ts`. The first version of the deriver marked both
 *     pack-dependent, which would have stopped the drill from running two of
 *     the very scans task 8 strengthened.
 *
 * The fixtures below are deliberately written the way the real files write
 * them, `packs/riot` and all. They are quoted strings, never imports, which is
 * exactly the distinction under test — and is why this file is not itself
 * pack-dependent.
 */
describe('which tests need a pack this checkout does not have', () => {
  it('excludes nothing when every pack is installed', () => {
    // The installed set is passed in rather than read, so this states the
    // property in both conditions: inside the drill `packs/riot/` is gone from
    // disk but `tests/packs/riot/` is not, and asking about a checkout that has
    // both packs must still answer "nothing".
    expect(packDependentTests(ROOT, ['reference', 'riot'])).toEqual([]);
  });

  it('excludes the absent pack own test directory and its importers', () => {
    const withoutRiot = packDependentTests(ROOT, ['reference']);
    expect(withoutRiot).toContain('tests/packs/riot/pack.test.ts');
    // A direct import.
    expect(withoutRiot).toContain('tests/content/install.test.ts');
    // Transitive: this one imports `tests/game/spell/registry.ts`, which
    // value-imports the pack's whole spell barrel, and names no pack itself.
    expect(withoutRiot).toContain('tests/game/combat/AttackProfiles.test.ts');
    // Through a build script rather than a module: this drives
    // `scripts/wiki/import-abilities.mjs`, whose download path loads the
    // pack's own asset generator.
    expect(withoutRiot).toContain('tests/wiki/import-abilities.test.ts');
  });

  it('leaves a scan whose fixtures merely quote a pack path in the run', () => {
    const withoutRiot = packDependentTests(ROOT, ['reference']);
    // A template-literal fixture (`pregameBootPath`) and a double-quoted one
    // (`importScan`). Both files' real imports are core's own.
    expect(withoutRiot).not.toContain('tests/scenes/pregameBootPath.test.ts');
    expect(withoutRiot).not.toContain('tests/seams/importScan.test.ts');
  });

  it('leaves a scan that asks whether the pack is installed in the run', () => {
    // Task 7's four scans each *derive* — and therefore name — `packs/riot/…`
    // roots, and each guards with `packIsInstalled`. Skipping them would undo
    // the whole point of that task: they are supposed to run over whatever the
    // checkout does have.
    const withoutRiot = packDependentTests(ROOT, ['reference']);
    expect(withoutRiot).not.toContain('tests/content/vocabularyBoundary.test.ts');
    expect(withoutRiot).not.toContain('tests/content/coreSpellsApiSurface.test.ts');
    expect(withoutRiot).not.toContain('tests/content/packAssetKeyBoundary.test.ts');
    expect(withoutRiot).not.toContain('tests/game/spells/terrain-field-seam.test.ts');
  });

  it('leaves a file whose only pack reach is a gated dynamic import in the run', () => {
    // Round 1 excluded these four whole — 105 tests of stat ceilings, speed
    // floors, regen, line of sight, vision and blackboard bucketing, none of
    // which is about any pack — because one `it()` in each named a pack spell.
    // Each now reaches it through `packIsInstalled('riot') ? await import(…) : null`
    // and skips that one case.
    const withoutRiot = packDependentTests(ROOT, ['reference']);
    expect(withoutRiot).not.toContain('tests/game/config/PregameConfig.test.ts');
    expect(withoutRiot).not.toContain('tests/game/Stats.test.ts');
    expect(withoutRiot).not.toContain('tests/game/ai/TeamBlackboard.test.ts');
    expect(withoutRiot).not.toContain('tests/game/combat/Vision.test.ts');
  });

  it('tells a static import from a deferred one, which is what the gate rests on', () => {
    // The gate excuses a deferred specifier and must never excuse a static one:
    // a static import of a module that is not there makes the *file*
    // unloadable, so there is nothing a runtime check could save. No file in
    // this repository carries both halves for a fixture to observe it through,
    // so the split itself is pinned here.
    const kinds = readSource(
      [
        "import a from './static';",
        "export { b } from './re-exported';",
        "vi.mock('./mocked');",
        "const c = await import('./deferred');",
        "const d = () => import('./lazy');",
      ].join('\n')
    );
    expect(kinds.static).toEqual(['./static', './re-exported', './mocked']);
    expect(kinds.deferred).toEqual(['./deferred', './lazy']);
  });

  it('is a real population, not an empty list that would pass either way', () => {
    // Guards the guard: every `not.toContain` above is vacuously true against
    // an empty result.
    expect(packDependentTests(ROOT, ['reference']).length).toBeGreaterThan(100);
  });
});

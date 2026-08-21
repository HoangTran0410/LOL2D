import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CORE_SPELL_TREE,
  renderSpellCatalogSource,
  renderSpellModulesSource,
} from '../../scripts/generate-spell-catalog.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * `renderSpellCatalogSource`/`renderSpellModulesSource` used to read exactly
 * two fixed barrels — `spells/index.ts` and `coreSpells/index.ts` — and
 * merge them "content-last". Batch 4 task 1 generalises both into a `tree`
 * argument: an ordered list of barrels, a later one winning an id clash,
 * defaulting to `CORE_SPELL_TREE` so every existing call keeps its exact
 * output (see `generateSpellCatalog.barrelGuardRule.test.ts` for the guard this
 * must not weaken, and `npm run catalog:check` for the byte-for-byte proof
 * on core's own tree, which stays part of `verify`).
 *
 * `packs/riot/spells/` has no barrel yet — task 3 moves the spells in — so
 * it cannot stand in as "a second, real tree" here. `coreSpells/index.ts`
 * alone can: it is a real, already-checked-in barrel with exactly one
 * export (`BasicAttack`; see that barrel's own header), and pointing the
 * generator at it *alone*, rather than merged with `spells/index.ts`,
 * produces a genuinely different, independently verifiable manifest
 * without inventing any fixture content.
 */
const CORE_SPELLS_ONLY_TREE = {
  outputPath: 'tests-do-not-write-this-file.ts',
  modulesOutputPath: 'tests-do-not-write-this-file.ts',
  barrels: [
    {
      path: 'src/game/gameObject/coreSpells/index.ts',
      importBase: '@/game/gameObject/coreSpells',
    },
  ],
};

describe('renderSpellModulesSource takes a tree argument', () => {
  it('builds only the given barrel’s modules for a second, real tree', async () => {
    const source = await renderSpellModulesSource(CORE_SPELLS_ONLY_TREE);

    expect(source).toContain(
      `"BasicAttack": () => import('@/game/gameObject/coreSpells/BasicAttack'),`
    );
    expect(source).not.toContain('Yasuo_Q');
  });

  it("leaves core's own module map byte-identical to what is already checked in", async () => {
    const generated = await renderSpellModulesSource();
    const committed = await readFile(resolve(root, CORE_SPELL_TREE.modulesOutputPath), 'utf8');

    expect(generated).toBe(committed);
  });
});

describe('renderSpellCatalogSource takes a tree argument', () => {
  it('describes only the given barrel’s spells for a second, real tree', async () => {
    const source = await renderSpellCatalogSource(CORE_SPELLS_ONLY_TREE);

    expect(source).toContain('"BasicAttack": {');
    expect(source).not.toContain('"Yasuo_Q": {');
  }, 20000);

  // The default-tree equivalent of this — that the full 240+1-spell catalogue
  // stays byte-identical — is what `npm run catalog:check` already asserts,
  // for the real output file, every `verify`. Re-running the full merge here
  // too would just be a second, slower copy of that same proof.
});

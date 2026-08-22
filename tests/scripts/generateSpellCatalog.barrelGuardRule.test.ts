import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Renamed from `generateSpellCatalog.barrelGuard.test.ts` in batch 4 task 3's
 * review round: this tests the *generic* per-barrel rule, not any real tree.
 * `renderSpellModulesSource` used to throw only when *every* configured
 * barrel came back with no `export { default as X } from` lines — so a
 * two-barrel tree with one barrel emptied (all 238 spells removed, say by a
 * bad merge) still had its other, one-line barrel, and the guard stayed
 * quiet. Each barrel that is expected to have content must be checked on its
 * own, and this file proves that against a synthetic `TWO_BARREL_TREE`
 * rather than `CORE_SPELL_TREE` or the riot pack's tree — batch 4 task 3
 * left both of those with exactly *one* barrel each (`coreSpells/` alone;
 * `packs/riot/spells/` alone), so there is no longer a real tree with two
 * distinct barrels to exercise this against. The two real trees' own
 * generation is covered elsewhere (core's `catalog:check`; the pack's own
 * `catalog:check`, in `packs/riot/package.json`, reached through root
 * `verify:all`); this file is the one place the *rule itself* — "attribute
 * the failure to the barrel that is actually empty" — is proven, independent of how many
 * barrels either real tree happens to have today.
 */

const CONTENT_EXPORT = "export { default as Foo } from './Foo';\n";
const NO_EXPORTS = '// nothing exported here\n';

// A synthetic two-barrel tree, independent of what `CORE_SPELL_TREE` actually
// looks like today. Batch 4 task 3 moved `spells/` out of core entirely —
// `CORE_SPELL_TREE` is down to its one `coreSpells` barrel — so this guard
// no longer has two *real* barrels to tell apart on the default tree. The
// per-barrel attribution it exists to prove is still real for any tree with
// more than one barrel (a future pack could have several), so it is tested
// against an explicit, made-up tree shape instead of the default.
const TWO_BARREL_TREE = {
  barrels: [
    { path: 'fake/coreSpells/index.ts', importBase: '@/fake/coreSpells' },
    { path: 'fake/gameObject/spells/index.ts', importBase: '@/fake/spells' },
  ],
};

async function loadWithBarrels(contentSource: string, coreSource: string) {
  vi.resetModules();
  vi.doMock('node:fs/promises', async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    return {
      ...actual,
      readFile: vi.fn(async (path: unknown, ...rest: unknown[]) => {
        const p = String(path);
        if (p.includes('coreSpells')) return coreSource;
        if (p.includes('gameObject/spells/index.ts')) return contentSource;
        return (actual.readFile as (...args: unknown[]) => Promise<string>)(p, ...rest);
      }),
    };
  });
  // @ts-expect-error — a build script, deliberately plain .mjs with no types.
  return import('../../scripts/generate-spell-catalog.mjs');
}

afterEach(() => {
  vi.doUnmock('node:fs/promises');
  vi.resetModules();
});

describe('renderSpellModulesSource requires each barrel to have content', () => {
  it('throws when the core barrel is empty, even though the content barrel is not', async () => {
    const { renderSpellModulesSource } = await loadWithBarrels(CONTENT_EXPORT, NO_EXPORTS);
    await expect(renderSpellModulesSource(TWO_BARREL_TREE)).rejects.toThrow(/coreSpells/);
  });

  it('throws when the content barrel is empty, even though the core barrel is not', async () => {
    const { renderSpellModulesSource } = await loadWithBarrels(NO_EXPORTS, CONTENT_EXPORT);
    await expect(renderSpellModulesSource(TWO_BARREL_TREE)).rejects.toThrow(/spells\/index\.ts/);
  });

  it('still throws when both barrels are empty', async () => {
    const { renderSpellModulesSource } = await loadWithBarrels(NO_EXPORTS, NO_EXPORTS);
    await expect(renderSpellModulesSource(TWO_BARREL_TREE)).rejects.toThrow();
  });

  it('resolves when both barrels have content', async () => {
    const { renderSpellModulesSource } = await loadWithBarrels(CONTENT_EXPORT, CONTENT_EXPORT);
    await expect(renderSpellModulesSource(TWO_BARREL_TREE)).resolves.toBeTypeOf('string');
  });
});

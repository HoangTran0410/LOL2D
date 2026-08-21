import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `renderSpellModulesSource` reads two barrels — `spells/index.ts` (content)
 * and `coreSpells/index.ts` (core) — and used to throw only when *both* came
 * back with no `export { default as X } from` lines. That is too weak: an
 * emptied content barrel (all 238 spells removed, say by a bad merge) still
 * has a one-line core barrel, so the guard stayed quiet and the generator
 * would have silently written a one-entry `spellModules.ts` instead of
 * failing the build. Each barrel that is expected to have content must be
 * checked on its own.
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

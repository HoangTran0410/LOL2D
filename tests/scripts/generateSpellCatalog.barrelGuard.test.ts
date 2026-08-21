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
    await expect(renderSpellModulesSource()).rejects.toThrow(/coreSpells/);
  });

  it('throws when the content barrel is empty, even though the core barrel is not', async () => {
    const { renderSpellModulesSource } = await loadWithBarrels(NO_EXPORTS, CONTENT_EXPORT);
    await expect(renderSpellModulesSource()).rejects.toThrow(/spells\/index\.ts/);
  });

  it('still throws when both barrels are empty', async () => {
    const { renderSpellModulesSource } = await loadWithBarrels(NO_EXPORTS, NO_EXPORTS);
    await expect(renderSpellModulesSource()).rejects.toThrow();
  });

  it('resolves when both barrels have content', async () => {
    const { renderSpellModulesSource } = await loadWithBarrels(CONTENT_EXPORT, CONTENT_EXPORT);
    await expect(renderSpellModulesSource()).resolves.toBeTypeOf('string');
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { contentRegistry, resetContentRegistryForTests } from '../../src/content/registry';
import { contentCatalog } from '../../src/content/catalog';
import { BUNDLED_PACK_ID } from '../../src/content/install';

describe('the content registry', () => {
  beforeEach(resetContentRegistryForTests);

  it('is the same instance every time', () => {
    expect(contentRegistry()).toBe(contentRegistry());
  });

  it('has both bundled packs installed on the first read', () => {
    const ids = new Set(
      contentRegistry()
        .champions()
        .map(c => c.packId)
    );
    expect(ids).toEqual(new Set([BUNDLED_PACK_ID, 'reference']));
  });

  it('installs once, not once per read', () => {
    // Against the count alone this would pass for an accessor that installed
    // nothing at all — 0 === 0 — so it pins the roster as non-empty first.
    // A re-installing accessor does not double the count either, it throws:
    // `PackRegistry.install` refuses a pack id it already holds. Both failure
    // shapes are covered, and both are legible.
    const first = contentRegistry().champions().length;
    expect(first).toBeGreaterThan(30);
    contentRegistry();
    contentRegistry();
    expect(contentRegistry().champions()).toHaveLength(first);
  });

  it('is the very same registry contentCatalog() built — one store, not two', () => {
    // `toBe`, not a deep-equal: two *equivalent* registries would still be
    // the two-stores bug this split exists to avoid (the match-config panel
    // had exactly that shape once, with a screen and a panel each holding
    // their own backend). `contentRegistry()` must delegate to
    // `contentCatalog()` for the instance itself, not merely produce
    // something that looks the same.
    expect(contentRegistry()).toBe(contentCatalog());
  });

  it('contentCatalog() alone installs the data half and nothing more', () => {
    // The whole reason this split exists: a picker can read a roster without
    // ever building a `ContentApi`. `champions()` (data) must be populated;
    // `spellIds()` (code — only `installCode`/`writeCode` ever write to
    // `sources`) must still be empty, because nothing has called
    // `contentRegistry()` in this test.
    const registry = contentCatalog();
    expect(registry.champions().length).toBeGreaterThan(30);
    expect(registry.spellIds()).toEqual([]);
  });
});

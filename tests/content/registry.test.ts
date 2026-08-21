import { beforeEach, describe, expect, it } from 'vitest';
import { contentRegistry, resetContentRegistryForTests } from '../../src/content/registry';
import { BUNDLED_PACK_ID } from '../../src/content/bundledPack';

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
});

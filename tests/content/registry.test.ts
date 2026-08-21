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
    const first = contentRegistry().champions().length;
    contentRegistry();
    contentRegistry();
    expect(contentRegistry().champions()).toHaveLength(first);
  });
});

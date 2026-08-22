import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { installedPacks, installedPackNames } from '../../src/generated/installedPacks';
// @ts-expect-error — a plain .mjs build helper with no types of its own.
import {
  installedContentPackages,
  optionalContentPackages,
} from '../../scripts/installed-packs.mjs';

const ROOT = join(__dirname, '../..');

/**
 * There is **one** answer to "which content packs are installed", and this is
 * what holds the two places that say it in step.
 *
 * `scripts/installed-packs.mjs` derives it from `node_modules/@moba2d/content-*`.
 * `src/generated/installedPacks.ts` is that same answer materialized into
 * TypeScript, because a compiler cannot call a script. They are one answer and
 * its written form — not two answers — and the only thing that had been keeping
 * them together was `packs:check` happening to run before `typecheck` in
 * `verify`'s script list. Nothing asserted that ordering, and script ordering is
 * not a mechanism.
 *
 * (`scripts/wiki/check-abilities.mjs` asks a deliberately different and
 * narrower question — does the root *being validated* contain a pack's tree —
 * and is named `packTreeIsPresent` so it cannot be mistaken for a third answer
 * to this one. `checkAbilities(root)` runs against temporary fixture roots with
 * no `node_modules` at all, where "installed" has no meaning.)
 */
describe('the generated installed-packs barrel', () => {
  it('lists exactly the content packages this checkout has', () => {
    const derived = installedContentPackages(ROOT).map((pack: { name: string }) => pack.name);
    expect(derived.length).toBeGreaterThan(0);
    expect([...installedPackNames]).toEqual(derived);
  });

  it('imports exactly the optional ones, in the same order', () => {
    const optional = optionalContentPackages(ROOT).map((pack: { name: string }) => pack.name);
    expect(installedPacks.map(pack => pack.name)).toEqual(optional);
    // The reference pack is core's own and `install.ts` imports it plainly; a
    // barrel entry for it would install it twice.
    expect(installedPacks.map(pack => pack.name)).not.toContain('reference');
  });

  it('gives every entry the id its own pack manifest declares', () => {
    // `id` comes from the pack's `BUNDLED_PACK_ID` export and `data.manifest.id`
    // is the canonical spelling; `install.ts` installs code against the first
    // and data under the second, so a disagreement would install one pack's
    // spells under another pack's name.
    for (const pack of installedPacks) {
      expect(pack.id).toBe(pack.data.manifest.id);
      expect(pack.packageName).toBe(`@moba2d/content-${pack.name}`);
    }
  });
});

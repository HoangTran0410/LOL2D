import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assetKeyForPath,
  buildManifestEntries,
  generate,
  renderAssetManifestSource,
  renderManifest,
} from '../../../packs/riot/scripts/generate-assets.mjs';

// This pack's own root — `packs/riot/` — not the monorepo root. The whole
// point of this generator (task 5 of the content-pack extraction) is that it
// finds its tree from its own location, never from a repo-root constant.
const packRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'packs',
  'riot'
);

describe("packs/riot's own asset manifest generator", () => {
  it('maps a path the same way core does', () => {
    expect(assetKeyForPath('assets/images/champions/janna.png')).toBe('champ_janna');
    expect(assetKeyForPath('assets/images/spells/janna_q.png')).toBe('spell_janna_q');
  });

  it('rejects duplicate generated keys', () => {
    expect(() =>
      buildManifestEntries(['assets/images/others/menu-bg.png', 'assets/images/others/menu_bg.jpg'])
    ).toThrow(/duplicate asset key "other_menu_bg"/i);
  });

  /**
   * `packs/riot/assets/` is real — batch 4 task 4 moved 377 champion
   * portraits, spell icons and monster art files into it. Generating against
   * this pack's own root (not core's) now produces the real, populated
   * manifest, reading only `packs/riot/assets/` — never core's own `assets/`.
   */
  it('generates the real manifest for this pack, never reading core/assets', async () => {
    const source = await renderAssetManifestSource(packRoot);

    expect(source).toContain('export const assetManifest = {');
    expect(source).toContain('champ_janna');
    expect(source).toContain('spell_janna_q');
    // Core-only art (never moved here) must not leak into the pack's tree.
    expect(source).not.toContain('buff_stun');
    expect(source).not.toContain('spell_basic_attack');
  });

  /**
   * The byte-for-byte proof task 5 pins itself to: regenerating against the
   * real `packs/riot/assets/` must reproduce exactly what is already
   * checked in at `packs/riot/generated/assetManifest.ts`.
   */
  it("leaves the pack's own checked-in manifest byte-identical", async () => {
    const generated = await renderAssetManifestSource(packRoot);
    const committed = await readFile(join(packRoot, 'generated/assetManifest.ts'), 'utf8');

    expect(generated).toBe(committed);
  });

  it("imports relative to this pack's own root, not a repo-root round-trip", () => {
    const entries = buildManifestEntries(['assets/images/champions/janna.png']);
    const source = renderManifest(entries);

    expect(source).toContain("from '../assets/images/champions/janna.png?url'");
  });

  it("names this pack's own regenerate command in the stale-manifest message", async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), 'lol2d-riot-assets-stale-'));
    try {
      await mkdir(join(tmpRoot, 'assets'), { recursive: true });
      await expect(generate(tmpRoot, true)).rejects.toThrow(/Run npm run assets:generate\./);
    } finally {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SeamCheck, SeamViolation } from './types';
import { codeOnly, readSource, walkTsFiles } from './shared';

/**
 * A pack resolves its art through its own manifest — never through a bare
 * key that happens to sit in *core's*.
 *
 * `AssetManager.resolveDescriptor`'s bare-key fallback (core first, then
 * every registered pack's manifest in install order) is what makes this
 * possible to get away with silently: a pack spell calling
 * `api.asset('obj_something')` resolves today because that key still lives
 * in core's manifest, and keeps resolving — wrongly, by accident — for as
 * long as core ships it. One pack spell did exactly this with an
 * `obj_*` key for art that was entirely the pack's; the day core stops
 * shipping that key the call degrades to a null-url handle and p5's
 * `image()` draws nothing. No error, no test failure, just a missing effect.
 *
 * ## Why this is a seam and not a test in core's suite
 *
 * It used to be `tests/content/packAssetKeyBoundary.test.ts`, which walked
 * *all of* `packs/` from inside core's own Vitest run. The whole-branch
 * review of content-pack-extraction batch 5 found it by planting a real
 * violation in a pack spell and watching **core's** build go red — the exact
 * inversion of the contract those gates exist for ("a pack that breaks an
 * engine rule reddens the pack's build, not the engine's"), and the same one
 * `pack-core-boundary` was created to fix a task earlier. It is also an
 * inversion with a shelf life: once the pack is a sibling repository there is
 * no `packs/` in core's tree left to walk, so the rule would have gone quiet
 * rather than moved.
 *
 * ## Package-scoped, like `pack-core-boundary`
 *
 * `api.asset()` is called from spells, from `pack.ts`, from a map module and
 * from a monster's ability factory — not only from whatever tree the CLI was
 * pointed at. So this runs over the *owning package's* root, and
 * `scripts/check-seams.mjs` skips it when that package is core itself: core's
 * own source naming core's own keys is not a boundary crossing, it is the
 * whole point of core having a manifest.
 *
 * ## Two exemptions, and only one of them is hand-written
 *
 * - **`buff_*` is permanent, and stated here rather than in any pack's debt
 *   file.** Buff *classes* (`Slow`, `Stun`, ...) stay in core forever —
 *   "mechanics, not content" — and are injected as constructors
 *   (`ContentApi.buffs`); their icons are the same mechanic's visual half,
 *   shared across every pack, and belong beside the classes for the identical
 *   reason. A pack's own debuff showing core's `buff_slow` icon is by design.
 * - **A key whose first segment is the pack's own id is *derived*, not
 *   listed.** `packs/reference/` has no `assets/` directory of its own yet;
 *   its six images live in core's `assets/images/reference/` and therefore in
 *   core's generated manifest, as `reference_champ_vera` and friends. That is
 *   a real debt (batch 4 task 4 fix round 1) and it is legible in the key
 *   itself: the segment before the first `_` names the pack the art belongs
 *   to. Exempting exactly those keys says "core is holding this pack's art"
 *   without exempting the pack from the rule — a `reference` spell reaching
 *   for `obj_something` is still caught — and the exemption evaporates by
 *   itself the day that art moves into `packs/reference/assets/`, with no
 *   list for anyone to forget to prune.
 */

/**
 * Core's own asset keys, read out of the generated manifest's **text**.
 *
 * Deliberately not `import { assetManifest } from '../generated/assetManifest'`:
 * that module's 30-odd `?url` image imports would have to resolve, and this
 * whole directory's portability rests on importing nothing but `node:*` and
 * its own siblings — `scripts/check-seams.mjs` runs it with `configFile:
 * false` precisely so a pack can execute it from its own repository with
 * none of core's build plugins installed. The manifest is generated with a
 * fixed shape by `scripts/generate-assets.mjs` and `assets:check` keeps it
 * that way, so parsing it is reading a table, not guessing at source.
 */
const MANIFEST_PATH = fileURLToPath(new URL('../generated/assetManifest.ts', import.meta.url));

function coreAssetKeys(): Set<string> {
  const source = readFileSync(MANIFEST_PATH, 'utf8');
  const keys = new Set<string>();
  for (const match of source.matchAll(/^\s*"([^"]+)":\s*\{\s*kind:/gm)) keys.add(match[1]);
  if (keys.size === 0) {
    // Zero keys would silently make this rule vacuous, and the only way to
    // get zero is the generated file changing shape under the regex above.
    throw new Error(`packAssetKey: no asset keys parsed out of ${MANIFEST_PATH}`);
  }
  return keys;
}

/**
 * The pack's own local id — `@moba2d/content-reference` -> `reference`, the
 * same derivation `src/generated/installedPacks.ts` records for each entry's
 * `name`. `undefined` when the package declares no name, in which case the
 * pack-id exemption simply does not apply and every core key is a violation,
 * which is the safe direction.
 */
function packLocalId(packageRoot: string): string | undefined {
  try {
    const name = JSON.parse(readFileSync(`${packageRoot}/package.json`, 'utf8')).name as
      string | undefined;
    return name?.replace(/^@[^/]+\/content-/, '');
  } catch {
    return undefined;
  }
}

/** Every string literal passed to `.asset(...)` — `api.asset('x')` or `this.api.asset('x')`. */
function assetKeyCalls(line: string): string[] {
  const out: string[] = [];
  const pattern = /\.asset\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) out.push(match[1]);
  return out;
}

/** `root` is the pack's own package root, not one of the trees the other seams scan. */
export const checkPackAssetKey: SeamCheck = (root, options) => {
  const violations: SeamViolation[] = [];
  const coreKeys = coreAssetKeys();
  const localId = packLocalId(root);

  for (const file of walkTsFiles(root, options)) {
    const source = readSource(root, file);
    for (const rawLine of source.split('\n')) {
      // Comments stripped, or this rule's own prose about `buff_slow` would
      // flag the file that documents it.
      const line = codeOnly(rawLine);
      for (const key of assetKeyCalls(line)) {
        // A qualified `<packId>:<localId>` key deliberately names another
        // pack, not core — out of scope for this rule, which is only about
        // a bare key silently landing in core's flat namespace.
        if (key.includes(':')) continue;
        if (key.startsWith('buff_')) continue;
        if (localId && key.startsWith(`${localId}_`)) continue;
        if (!coreKeys.has(key)) continue;
        violations.push({
          file,
          message: `api.asset('${key}') — a core asset key; a pack resolves art through its own manifest`,
        });
      }
    }
  }

  return violations;
};

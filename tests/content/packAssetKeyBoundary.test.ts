import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { assetManifest as coreAssetManifest } from '../../src/generated/assetManifest';

/**
 * The asset-key equivalent of `corePacksBoundary.test.ts`: a pack may call
 * `api.asset()` with its own local key, or with an explicit
 * `<packId>:<localId>` naming another pack, but never with a bare string
 * that happens to be one of *core's* own keys.
 *
 * `AssetManager.resolveDescriptor`'s bare-key fallback (core first, then
 * every registered pack's manifest in install order) is what makes this
 * possible to get away with silently: a pack spell calling
 * `api.asset('obj_something')` resolves today because that key happens to
 * still live in core's manifest, and keeps resolving — wrongly, by
 * accident — for as long as core ships it. `Yasuo_Q.ts` did exactly this
 * with `'obj_yasuo_q3'`: the file lived in `assets/images/objects/`, core's
 * tree, art that is entirely Riot's and belongs in the pack the same as
 * every sibling `spell_yasuo_q3` reference beside it. Batch 5 turns core
 * into its own repository; the day that key stops existing, this line
 * degrades to a null-url handle and p5's `image()` silently draws nothing —
 * no error, no test failure, just a missing windwall on whoever picks
 * Yasuo. This scan is what makes that a build-time failure instead.
 *
 * Two exemptions, and they are not the same shape:
 *
 * - `buff_*` is permanent. Buff *classes* (`Slow`, `Stun`, ...) stay in
 *   core forever — "mechanics, not content" — and are injected as
 *   constructors (`ContentApi.buffs`); their icons are the same mechanic's
 *   visual half, shared across every pack, and belong beside the classes
 *   for the identical reason. `Malphite_E.ts`'s Cripple debuff showing
 *   core's own `buff_slow` icon is by design, not an accident this scan
 *   exists to catch.
 * - `packs/reference/` is temporary, dated batch 4 task 4 fix round 1.
 *   `assets/images/reference/` (five files — `champ_vera.png` and its four
 *   spell icons) is the exact same shape of bug `Yasuo_Q.ts` was, just in
 *   the pack that exists specifically to prove core ships content of its
 *   own — recorded in `task-4-report.md` as a finding for a later task
 *   rather than fixed here, to keep this round small. Remove this
 *   exemption once that art moves into `packs/reference/assets/`.
 *
 * Comments are stripped before matching, or this file's own paragraphs
 * above would flag themselves.
 */
const PACKS_DIR = join(__dirname, '../../packs');

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...tsFilesUnder(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Every string literal passed to `.asset(...)` — `api.asset('x')` or `this.api.asset('x')`. */
function assetKeyCalls(source: string): string[] {
  const out: string[] = [];
  const pattern = /\.asset\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) out.push(match[1]);
  return out;
}

describe('the pack asset-key boundary', () => {
  const files = tsFilesUnder(PACKS_DIR);

  it('finds pack files to scan, or this proves nothing', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('no pack spell resolves a core asset key', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const relativePath = file.slice(PACKS_DIR.length + 1);
      // Temporary, dated exemption — see the module doc comment above.
      if (relativePath.startsWith(`reference${'/'}`)) continue;
      const source = stripComments(readFileSync(file, 'utf8'));

      for (const key of assetKeyCalls(source)) {
        // A qualified `<packId>:<localId>` key deliberately names another
        // pack, not core — out of scope for this rule, which is only about
        // a bare key silently landing in core's flat namespace.
        if (key.includes(':')) continue;
        // Permanent exemption — buff icons are core's own mechanic art,
        // shared by design. See the module doc comment above.
        if (key.startsWith('buff_')) continue;
        if (key in coreAssetManifest) offenders.push(`${relativePath}: api.asset('${key}')`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

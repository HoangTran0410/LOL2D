import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A pack may reach core through the injected `ContentApi` and nowhere else —
 * and **this file is no longer where that is checked**.
 *
 * The rule itself is `pack-core-boundary`, the fourteenth seam
 * (`src/seams/packCoreBoundary.ts`), run by each pack's own `check-seams`
 * script over the pack's own package. That move is the whole point of
 * content-pack-extraction batch 5 task 6: "the rule lives with the engine, so
 * it evolves with the engine; the population lives with the content. A pack
 * that violates a rule fails **its own** build, not the engine's" (spec
 * §8.1). Eleven hand-written scans of the pack's tree moved out of core's
 * suite for that reason; this one was left behind, and the fix round 4 review
 * caught the inconsistency where it mattered most:
 *
 *     # a core internal deep-imported at the top of a pack spell
 *     cd packs/riot && npm run typecheck      EXIT 0
 *     cd packs/riot && npm run check-seams    EXIT 0
 *     npx vitest run tests/content/packBoundary.test.ts
 *       + "riot/spells/Ashe_Q.ts: @/game/gameObject/buffs/Slow"   1 failed
 *
 * Green pack, red engine, for the rule the entire extraction rests on. And
 * on a clock: once `packs/riot/` is a sibling repository this file has no
 * population left to scan, so the guarantee would have disappeared with the
 * directory rather than travelling with it.
 *
 * ## What is left here, and why it is not the same check again
 *
 * Only that every pack in this repository actually **runs** the seam. A rule
 * enforced by the pack's own build is only as good as the pack's own build
 * being wired to it, and a pack quietly dropping its `check-seams` script
 * would look exactly like a pack with nothing to report. That is a question
 * about this repository's wiring — core's business, checkable from here —
 * rather than a second opinion about the pack's imports, which is now
 * answered in one place. `tests/seams/exported-seams.test.ts` proves the rule
 * catches every shape it bans; `tests/scripts/checkSeams.bin.test.ts` proves
 * the CLI reaches the pack's tree and honours its debt.
 */
const PACKS_DIR = join(__dirname, '../../packs');

interface PackManifest {
  name: string;
  scripts?: Record<string, string>;
}

describe('every pack runs the boundary rule as its own gate', () => {
  const packs = readdirSync(PACKS_DIR)
    .filter(entry => statSync(join(PACKS_DIR, entry)).isDirectory())
    .map(entry => ({
      dir: entry,
      manifest: JSON.parse(
        readFileSync(join(PACKS_DIR, entry, 'package.json'), 'utf8')
      ) as PackManifest,
    }));

  it('finds packs to check, or this proves nothing', () => {
    // Guards the guard: an empty `packs/` (moved directory, wrong glob) would
    // otherwise leave the assertion below vacuously green forever.
    expect(packs.length).toBeGreaterThan(0);
  });

  it('each declares a check-seams script naming the engine CLI', () => {
    // `moba2d-check-seams <tree>` runs the thirteen tree-scoped seams over
    // that tree *and* `pack-core-boundary` over the whole package it belongs
    // to — the pack cannot have one without the other, which is why one
    // script name is the whole check here.
    const missing = packs
      .filter(
        pack => !(pack.manifest.scripts?.['check-seams'] ?? '').includes('moba2d-check-seams')
      )
      .map(pack => pack.dir);

    expect(missing).toEqual([]);
  });

  it('and the root verify:all runs every one of them', () => {
    const root = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));
    for (const pack of packs) {
      expect(root.scripts['verify:all']).toContain(
        `npm run check-seams --workspace=${pack.manifest.name}`
      );
    }
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Core must not import out of the content directory — no exception any more.
 *
 * `Champion.ts` never imports a content spell: it may *hold* a recall
 * (`Champion.recall: Spell | null`) but does not construct one, so it stays
 * buildable without a single file under `packs/riot/spells/`.
 *
 * `preset.ts` used to be different, on purpose: `attachRecall` built a
 * `Recall` for every champion synchronously at construction, before the
 * async spell-registry path a match's other kits go through even exists, and
 * — until batch 5 task 1 — `Recall.ts` lived under `packs/riot/spells/` with
 * the other 237 spells (batch 4 task 3), so that one line was a named,
 * pinned content import `tests/content/corePacksBoundary.test.ts` (the
 * reverse-direction guard) carried too.
 *
 * Batch 5 task 1 closed that exception rather than widen it: `Recall` was
 * never really content, the way `BasicAttack` never was — every current map
 * grants a way home the way every kit grants a swing — so the file moved
 * back to `src/game/gameObject/coreSpells/Recall.ts`, beside
 * `BasicAttack.ts`. `preset.ts` now imports zero `packs/riot/spells/`
 * modules, and this test tightens from "pin the one exception" to "there is
 * none" — the stronger, and now honest, invariant.
 *
 * A source scan because the failure is an import edge: it is legal
 * TypeScript, it compiles, and it only becomes visible when the content
 * directory is extracted and the engine stops building.
 */
const SRC = join(__dirname, '../../src');

const read = (relative: string): string => readFileSync(join(SRC, relative), 'utf8');

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('core does not import content', () => {
  it('Champion.ts does not import from packs/riot/spells', () => {
    const source = stripComments(read('game/gameObject/attackableUnits/Champion.ts'));
    expect(source).not.toMatch(/from '[^']*packs\/riot\/spells\//);
  });

  it('preset.ts imports no pack spell at all — Recall came back to core', () => {
    const source = stripComments(read('game/preset.ts'));
    const contentImports = [...source.matchAll(/from '([^']*packs\/riot\/spells\/[^']*)'/g)].map(
      match => match[1]
    );
    expect(contentImports).toEqual([]);
  });
});

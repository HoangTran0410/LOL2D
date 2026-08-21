import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Core must not import out of the content directory — with one named,
 * temporary exception.
 *
 * `Champion.ts` never imports a content spell: it may *hold* a recall
 * (`Champion.recall: Spell | null`) but does not construct one, so it stays
 * buildable without a single file under `packs/riot/spells/`.
 *
 * `preset.ts` is different, on purpose. `Recall` presupposes a fountain —
 * map content, not a mechanic every pack has — and moved into
 * `packs/riot/spells/` with the other 237 spells in batch 4 task 3, but
 * *this* repo's boot path still has no pack-loader route for a spell every
 * champion needs before a match can even start, so something has to keep a
 * normal match's `B` key working. `preset.ts` is that something, exactly as
 * it already is for `BasicAttack`'s fallback. This is the same named,
 * pinned exception `tests/content/corePacksBoundary.test.ts` (the reverse-
 * direction guard batch 4 task 3 adds) carries for the whole of `src/`; this
 * test's own job is narrower and older — pin it to exactly one content
 * symbol so nothing else rides along on it.
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

  it("preset.ts's only pack-spell import is Recall, the named exception", () => {
    const source = stripComments(read('game/preset.ts'));
    const contentImports = [...source.matchAll(/from '([^']*packs\/riot\/spells\/[^']*)'/g)].map(
      match => match[1]
    );
    expect(contentImports).toEqual(['../../packs/riot/spells/Recall']);
  });
});

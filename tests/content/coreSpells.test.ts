import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Core must not import out of the content directory — with one named,
 * temporary exception.
 *
 * `Champion.ts` never imports a content spell: it may *hold* a recall
 * (`Champion.recall: Spell | null`) but does not construct one, so it stays
 * buildable without a single file under `gameObject/spells/`.
 *
 * `preset.ts` is different, on purpose, for batch 1 only. `Recall` moved back
 * to `spells/` because it presupposes a fountain — map content, not a
 * mechanic every pack has — but *this* repo's boot path has no pack loader
 * yet, so something has to keep a normal match's `B` key working. `preset.ts`
 * is that something, exactly as it already is for `BasicAttack`'s fallback.
 * Batch 2 replaces this with `ChampionEntry.recall` read off an installed
 * pack; until then the import is deliberate, not a regression, and this test
 * pins it to exactly one content symbol so nothing else rides along on it.
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
  it('Champion.ts does not import from gameObject/spells', () => {
    const source = stripComments(read('game/gameObject/attackableUnits/Champion.ts'));
    expect(source).not.toMatch(/from '[^']*gameObject\/spells\//);
  });

  it("preset.ts's only content import is Recall, the named batch-1 exception", () => {
    const source = stripComments(read('game/preset.ts'));
    const contentImports = [...source.matchAll(/from '([^']*gameObject\/spells\/[^']*)'/g)].map(
      match => match[1]
    );
    expect(contentImports).toEqual(['./gameObject/spells/Recall']);
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Core must not import out of the content directory.
 *
 * `Champion.ts` held `readonly recall = new Recall(this)` against
 * `spells/Recall`, so the engine could not compile without one content file,
 * and `preset.ts` used `spells/BasicAttack` as its universal slot fallback.
 * Both are mechanics every pack presupposes rather than content a pack
 * supplies, so they live in `coreSpells/`.
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
  it.each(['game/gameObject/attackableUnits/Champion.ts', 'game/preset.ts'])(
    '%s does not import from gameObject/spells',
    file => {
      expect(stripComments(read(file))).not.toMatch(/from '[^']*gameObject\/spells\//);
    }
  );

  it('Champion still has a recall, from coreSpells', () => {
    const source = stripComments(read('game/gameObject/attackableUnits/Champion.ts'));
    expect(source).toMatch(/from '@\/game\/gameObject\/coreSpells\/Recall'/);
    expect(source).toMatch(/readonly recall/);
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Recall is content, because it presupposes a fountain.
 *
 * It was briefly classified as a core mechanic alongside `BasicAttack`, on the
 * grounds that every pack presupposes a way home. Every pack does not: a map
 * with no spawn platform — a battle-royale forest, which the design explicitly
 * allows — has nowhere to recall to. `BasicAttack` is universal because every
 * unit can swing; `Recall` is a mechanic that only exists on maps that grant it.
 *
 * So `Champion` must not construct one. The class may hold a recall; it may not
 * assume it has one.
 */
const SRC = join(__dirname, '../../src');
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('recall is content', () => {
  it('Champion does not import or construct a Recall', () => {
    const source = stripComments(read('game/gameObject/attackableUnits/Champion.ts'));
    expect(source).not.toMatch(/new Recall\(/);
    expect(source).not.toMatch(/from '[^']*Recall'/);
  });

  it('Champion.recall is nullable, so a map without a fountain is expressible', () => {
    const source = stripComments(read('game/gameObject/attackableUnits/Champion.ts'));
    expect(source).toMatch(/recall\s*:\s*[^=;]*\|\s*null/);
  });

  it('the core spell barrel carries only the basic attack', () => {
    const source = stripComments(read('game/gameObject/coreSpells/index.ts'));
    expect(source).toMatch(/BasicAttack/);
    expect(source).not.toMatch(/Recall/);
  });

  it('a pack can declare a champion its way home', () => {
    const source = stripComments(read('content/ContentPack.ts'));
    expect(source).toMatch(/recall\?\s*:\s*string/);
  });
});

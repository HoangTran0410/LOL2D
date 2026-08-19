import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');

/**
 * Comments out first. A scan that matched its own documentation would flag the
 * very paragraph explaining why the name is banned — the trap CLAUDE.md names.
 */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const filesUnder = (directory: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else if (path.endsWith('.ts')) out.push(path);
  }
  return out;
};

describe("a bot never aims at the human player's cursor", () => {
  const targets = [
    ...filesUnder(join(ROOT, 'src/game/ai')),
    join(ROOT, 'src/game/gameObject/attackableUnits/AIChampion.ts'),
  ];

  it('scans a non-empty set of files', () => {
    // Without this, a renamed directory turns the whole suite into a no-op.
    expect(targets.length).toBeGreaterThan(4);
  });

  it.each(targets)('%s does not mention worldMouse', path => {
    // `worldMouse` is the player's pointer. On a phone it is wherever the thumb
    // is resting — the on-screen control pad — so a bot that aims by it fires
    // at a button in the corner of the screen. It has no place in bot code.
    expect(stripComments(readFileSync(path, 'utf8'))).not.toContain('worldMouse');
  });

  it.each(targets)('%s does not read visionRadius as a gameplay gate', path => {
    // It is a lerped animation value written every frame from 0 upward
    // (AttackableUnit.ts:216-218), not a constant. Range is `aggroRange`.
    expect(stripComments(readFileSync(path, 'utf8'))).not.toContain('visionRadius');
  });

  it.each(targets)('%s does not touch a mana stat directly', path => {
    // Budgeting reads `effectiveManaCost`; nothing here may spend.
    expect(stripComments(readFileSync(path, 'utf8'))).not.toContain('spendMana');
  });
});

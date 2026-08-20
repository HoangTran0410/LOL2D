import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The engine's fallback camp must not be a named champion-grade monster.
 *
 * `DEFAULT_PRESET` was Baron: its name, its avatar and its Summoner's Rift
 * coordinates, in an engine file. Nothing chose it — it was the nearest camp
 * to hand when the default was needed — and on any other map those
 * coordinates are somewhere arbitrary.
 */
const source = readFileSync(
  join(__dirname, '../../src/game/gameObject/attackableUnits/Monster.ts'),
  'utf8'
);

const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('the default monster preset', () => {
  it('names no specific monster', () => {
    const body = stripComments(source);
    const preset = body.slice(body.indexOf('const DEFAULT_PRESET'));
    expect(preset.slice(0, 400)).not.toMatch(/Baron|monster_/);
  });

  it('sits at the origin rather than a map coordinate', () => {
    const body = stripComments(source);
    const preset = body.slice(body.indexOf('const DEFAULT_PRESET'));
    expect(preset.slice(0, 400)).toMatch(/camp:\s*\{\s*x:\s*0,\s*y:\s*0/);
  });
});

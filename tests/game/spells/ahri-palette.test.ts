import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Ahri's kit is blue. Only Charm is pink.
 *
 * This is not a style preference, it is a *tell*: E is the one ability in the
 * kit that takes control of you, so it is the one that does not look like the
 * others. A pass that recoloured the whole kit to "pink-magenta arcane" — which
 * is what happened, from a briefing that named the palette wrongly — deleted
 * that signal, and nothing failed, because colour is exactly the kind of thing
 * no behavioural test looks at.
 *
 * A source scan, because the mistake is a hue and it costs a millisecond to
 * rule out across four files.
 */
const SPELLS = join(__dirname, '../../../packs/riot/spells');

/** Comments discuss the palette; matching them would flag the documentation. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

interface Colour {
  r: number;
  g: number;
  b: number;
  raw: string;
}

/** Every literal colour in the file, from both `fill(r,g,b)` and '#rrggbb'. */
function coloursIn(file: string): Colour[] {
  const source = stripComments(readFileSync(join(SPELLS, file), 'utf8'));
  const out: Colour[] = [];

  for (const m of source.matchAll(/\b(?:fill|stroke)\((\d+),\s*(\d+),\s*(\d+)/g)) {
    out.push({ r: +m[1], g: +m[2], b: +m[3], raw: m[0] });
  }
  for (const m of source.matchAll(/'#([0-9a-fA-F]{6})(?:[0-9a-fA-F]{2})?'/g)) {
    const h = m[1];
    out.push({
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      raw: m[0],
    });
  }
  return out;
}

/**
 * Pink here means "red clearly beats green while blue stays high" — a magenta.
 * Whites (255,255,255) and warm dark outlines are not pink and must not trip it.
 */
const isPink = (c: Colour): boolean => c.r > c.g + 24 && c.b > c.g + 24;

describe("Ahri's palette says which ability takes control of you", () => {
  it.each(['Ahri_Q.ts', 'Ahri_W.ts', 'Ahri_R.ts'])('%s is blue, not pink', file => {
    const pinks = coloursIn(file).filter(isPink);
    expect(pinks.map(c => c.raw)).toEqual([]);
  });

  it('Ahri_E.ts keeps the charm pink, so the tell still exists', () => {
    const pinks = coloursIn('Ahri_E.ts').filter(isPink);
    expect(pinks.length).toBeGreaterThan(0);
  });

  it('the blue kit is genuinely blue rather than merely not-pink', () => {
    for (const file of ['Ahri_Q.ts', 'Ahri_W.ts', 'Ahri_R.ts']) {
      const blues = coloursIn(file).filter(c => c.b > c.r + 24);
      expect(blues.length, file).toBeGreaterThan(0);
    }
  });
});

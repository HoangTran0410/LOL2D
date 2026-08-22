import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A buff is a mechanic; its icon must come from core's own art.
 *
 * `Chilled` pointed at `spell_anivia_e` and `Speedup` at `spell_ghost` — two
 * content images. `buffs/` is otherwise entirely content-free, so those two
 * keys were the whole of the leak, and `hudState.ts:188` drops any buff whose
 * image is missing: extract the content and both silently lose their HUD row
 * rather than failing loudly.
 */
const BUFFS_DIR = join(__dirname, '../../src/game/gameObject/buffs');

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('core buff icons', () => {
  it('no buff resolves a champ_, spell_ or monster_ asset', () => {
    const offenders: string[] = [];
    for (const name of readdirSync(BUFFS_DIR)) {
      if (!name.endsWith('.ts')) continue;
      const source = stripComments(readFileSync(join(BUFFS_DIR, name), 'utf8'));
      const hit = source.match(/'(champ_|spell_|monster_)[A-Za-z0-9_]+'/);
      if (hit) offenders.push(`${name}: ${hit[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the population is not empty, or this scan proves nothing', () => {
    // `> 20` stays a literal, deliberately, and this is the reason: the
    // population is `src/game/gameObject/buffs/` — the crowd-control
    // mechanics (`Stun`, `Slow`, `Shield`, `Dash`, ...). CLAUDE.md and the
    // content-pack spec both state that buffs are engine mechanism and stay
    // in core permanently; they are injected into every pack as constructors
    // through `ContentApi.buffs`, so no pack can add or remove one. This is
    // the one population in this suite the extraction programme is not
    // moving, and 24 files against a floor of 20 is a guard against the
    // directory read failing, not a claim about a roster size.
    const files = readdirSync(BUFFS_DIR).filter(name => name.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(20);
  });
});

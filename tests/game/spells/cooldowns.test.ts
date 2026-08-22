import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// `packs/riot/spells/` left this scan in content-pack-extraction batch 5
// task 6 fix round 1: `src/seams/cooldowns.ts` is the same rule, exported,
// and `packs/riot`'s own `check-seams` script (`moba2d-check-seams
// ./spells`) now runs it against the pack's own tree — a pack violation
// reddens the pack's build, not this one. `coreSpells/` is core's own
// population, and a real one for this rule: `BasicAttack.ts`'s swing
// interval is a numeric `coolDown` literal, not merely a pack concern.
describe('arcade cooldown boundary', () => {
  it('keeps every numeric spell cooldown at ten seconds or less', () => {
    const directory = 'src/game/gameObject/coreSpells';
    for (const name of readdirSync(directory).filter(name => name.endsWith('.ts'))) {
      const file = `${directory}/${name}`;
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/coolDown\s*=\s*([\d_]+)/g)) {
        const milliseconds = Number(match[1].replaceAll('_', ''));
        expect(milliseconds, file).toBeLessThanOrEqual(10_000);
      }
    }
  });
});

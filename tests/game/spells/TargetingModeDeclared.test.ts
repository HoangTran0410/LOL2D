import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Every spell has to say how a thumb aims it: `Spell.castSpec` reads either a
// spell's own `castSpec` override or the `targetingMode` field, and throws if
// neither is set — see the comment on `targetingMode` in Spell.ts. That throw
// only fires the first time the spell is actually cast, so it would not catch
// a spell nobody happened to press before a release. This test catches it at
// build time instead, for every registered spell file, mirroring
// `tests/game/buffs/Ground.test.ts`'s guard against `owner.teleportTo`.
// `packs/riot/spells/` left this scan in content-pack-extraction batch 5
// task 6 fix round 1: `src/seams/targetingModeDeclared.ts` is the same rule,
// exported, and `packs/riot`'s own `check-seams` script now runs it against
// the pack's own tree — a pack violation reddens the pack's build, not this
// one. `coreSpells/` stays: it is core's own population.
describe('every spell declares a targeting mode', () => {
  const coreSpellsDir = join(process.cwd(), 'src/game/gameObject/coreSpells');
  // `index.ts` only re-exports.
  const skip = new Set(['index.ts']);
  const targetingModePattern = /targeting\s*:\s*'(?:SELF|DIRECTION|POINT|UNIT)'/;
  const targetingModeFieldPattern = /\btargetingMode\s*[:=]/;

  const files = readdirSync(coreSpellsDir)
    .filter(name => name.endsWith('.ts') && !skip.has(name))
    .map(name => ({ dir: coreSpellsDir, name }));

  it('has spell files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('$name', ({ dir, name }) => {
    const source = readFileSync(join(dir, name), 'utf8');
    const declaresItsOwnTargeting = targetingModePattern.test(source);
    const setsTargetingMode = targetingModeFieldPattern.test(source);
    expect(
      declaresItsOwnTargeting || setsTargetingMode,
      `${name} declares neither a 'targeting' literal in its own castSpec nor a ` +
        "`targetingMode` field. Set `targetingMode = 'SELF' | 'DIRECTION' | 'POINT' | " +
        "'UNIT' as const;` (or override `castSpec` yourself) — see docs/ADDING_SPELLS.md."
    ).toBe(true);
  });
});

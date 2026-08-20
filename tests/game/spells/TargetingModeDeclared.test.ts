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
describe('every spell declares a targeting mode', () => {
  const spellsDir = join(process.cwd(), 'src/game/gameObject/spells');
  // `coreSpells/` left `spells/` but did not stop being spells.
  const coreSpellsDir = join(process.cwd(), 'src/game/gameObject/coreSpells');
  // `index.ts` only re-exports; `_EmptyExample.ts` is copy-paste scaffolding
  // for a new spell, never registered anywhere, and deliberately incomplete.
  const skip = new Set(['index.ts', '_EmptyExample.ts']);
  const targetingModePattern = /targeting\s*:\s*'(?:SELF|DIRECTION|POINT|UNIT)'/;
  const targetingModeFieldPattern = /\btargetingMode\s*[:=]/;

  const files = [
    ...readdirSync(spellsDir)
      .filter(name => name.endsWith('.ts') && !skip.has(name))
      .map(name => ({ dir: spellsDir, name })),
    ...readdirSync(coreSpellsDir)
      .filter(name => name.endsWith('.ts') && !skip.has(name))
      .map(name => ({ dir: coreSpellsDir, name })),
  ];

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

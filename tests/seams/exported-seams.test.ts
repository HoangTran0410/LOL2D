import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  seams,
  checkSeams,
  checkManaSpend,
  checkDashOnUpdate,
  checkTargetVision,
  checkUnitTargetTeam,
  checkCastSpecFrozen,
  checkCooldowns,
  checkTargetingModeDeclared,
  checkTerrainField,
  checkBuffDeactivate,
  checkStatResourceModifier,
  checkSpellObjectDisplayBox,
  checkSpellRuntimeDrive,
  checkWorldMouseInSpellCode,
} from '@/seams';

/**
 * `src/seams/` is core's rules exported as runnable functions — "callable
 * against an arbitrary tree" (task-9-brief.md, Step 2) is the actual claim
 * under test here, not just "matches the inline scan it was extracted from".
 * So every seam below gets a *fresh, synthetic* directory — never
 * `packs/riot/spells` — with one planted violation and one clean neighbour,
 * proving the exported function generalises past the one tree it happens to
 * have been proven against in tests/game/spells/*-seam.test.ts.
 */

const dirs: string[] = [];

function tempTree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'lol2d-seams-'));
  dirs.push(dir);
  for (const [name, contents] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, contents, 'utf8');
  }
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('the seams module is a real, documented entry point', () => {
  it('exports one Seam per rule, each with an id, a summary and a check function', () => {
    expect(seams.length).toBe(13);
    for (const seam of seams) {
      expect(typeof seam.id).toBe('string');
      expect(seam.id.length).toBeGreaterThan(0);
      expect(typeof seam.summary).toBe('string');
      expect(seam.summary.length).toBeGreaterThan(10);
      expect(typeof seam.check).toBe('function');
    }
    // ids are unique, so a report naming one is unambiguous
    expect(new Set(seams.map(s => s.id)).size).toBe(seams.length);
  });

  it('checkSeams tags every violation with the seam that raised it', () => {
    // targetingMode declared so targeting-mode-declared — which, unlike the
    // other twelve, has no "is this even a spell?" gate and fires on any
    // file lacking it — stays quiet and this is a single-seam violation.
    const dir = tempTree({
      'Bad.ts': `targetingMode = 'SELF' as const;\nowner.stats.mana.baseValue -= 10;\n`,
    });
    const violations = checkSeams(dir);
    expect(violations).toEqual([expect.objectContaining({ seamId: 'mana-spend', file: 'Bad.ts' })]);
  });

  it('an empty tree is clean across every seam at once', () => {
    const dir = tempTree({ 'Clean.ts': `targetingMode = 'SELF' as const;\n` });
    expect(checkSeams(dir)).toEqual([]);
  });
});

describe('each exported check catches its violation on an arbitrary tree', () => {
  it('mana-spend: a direct write to stats.mana', () => {
    const dir = tempTree({
      'Good.ts': `this.spendMana(this.manaCost);\n`,
      'Bad.ts': `this.owner.stats.mana.baseValue -= this.manaCost;\n`,
    });
    expect(checkManaSpend(dir).map(v => v.file)).toEqual(['Bad.ts']);
  });

  it('dash-onupdate: an instance assignment onto onUpdate', () => {
    const dir = tempTree({
      'Good.ts': `dash.onDashUpdate = () => {};\n`,
      'Bad.ts': `dash.onUpdate = () => {};\n`,
    });
    expect(checkDashOnUpdate(dir).map(v => v.file)).toEqual(['Bad.ts']);
  });

  it('target-vision: an auto-lock query with no visibleTo filter', () => {
    const dir = tempTree({
      'Good.ts': `queryObjects(pos, r, [PredefinedFilters.visibleTo(this.owner)]); let nearestDistance = 1;\n`,
      'Bad.ts': `queryObjects(pos, r, []); let nearestDistance = 1;\n`,
    });
    expect(checkTargetVision(dir).map(v => v.file)).toEqual(['Bad.ts']);
  });

  it('target-vision: reading the fog draw flag', () => {
    const dir = tempTree({ 'Bad.ts': `if (target.visibleToPlayerTeam) cast();\n` });
    expect(checkTargetVision(dir).map(v => v.file)).toEqual(['Bad.ts']);
  });

  it('unit-target-team: a UNIT spell missing targetTeam', () => {
    const dir = tempTree({
      'Good.ts': `
        get castSpec() { return { targeting: 'UNIT', targetingRequest: { targetTeam: 'ENEMY' } }; }
        press(ctx) { return super.press(ctx); }
      `,
      'Bad.ts': `get castSpec() { return { targeting: 'UNIT', targetingRequest: {} }; }\n`,
    });
    const offenders = checkUnitTargetTeam(dir).map(v => v.file);
    expect(offenders).toContain('Bad.ts');
    expect(offenders).not.toContain('Good.ts');
  });

  it('castspec-frozen: a cast spec reading a mutable field', () => {
    const dir = tempTree({
      'Good.ts': `get castSpec() { return { cooldown: { durationMs: this.coolDown } }; }\n`,
      'Bad.ts': `get castSpec() { return { cooldown: { durationMs: this.shotsRemaining <= 1 ? this.coolDown : 500 } }; }\n`,
    });
    expect(checkCastSpecFrozen(dir).map(v => v.file)).toEqual(['Bad.ts']);
  });

  it('castspec-frozen: the grandfathered list is honoured', () => {
    const dir = tempTree({
      'Bad.ts': `get castSpec() { return { cooldown: { durationMs: this.charges } }; }\n`,
    });
    expect(checkCastSpecFrozen(dir).map(v => v.file)).toEqual(['Bad.ts']);
    expect(
      checkCastSpecFrozen(dir, { grandfathered: new Set(['Bad.ts']) }).map(v => v.file)
    ).toEqual([]);
  });

  it('cooldowns: a numeric cooldown over the ceiling', () => {
    const dir = tempTree({
      'Good.ts': `coolDown = 8000;\n`,
      'Bad.ts': `coolDown = 15000;\n`,
    });
    expect(checkCooldowns(dir).map(v => v.file)).toEqual(['Bad.ts']);
    // a pack that wants a different pace passes its own ceiling
    expect(checkCooldowns(dir, { maxMs: 20_000 }).map(v => v.file)).toEqual([]);
  });

  it('targeting-mode-declared: a spell with neither a literal nor a field', () => {
    const dir = tempTree({
      'Good.ts': `class Good extends Spell { targetingMode = 'DIRECTION' as const; }\n`,
      'Bad.ts': `class Bad extends Spell { coolDown = 1000; }\n`,
    });
    expect(checkTargetingModeDeclared(dir).map(v => v.file)).toEqual(['Bad.ts']);
  });

  it('targeting-mode-declared: a non-spell file is never flagged, even with neither', () => {
    // The gate itself: `map.ts`, `pack.ts` and `provingGroundsGeometry.ts`
    // under `packs/reference/` name no `class X extends Spell` and are not
    // spells — scanning a pack's whole source root (the CLI's own
    // documented invocation) must stay quiet on them.
    const dir = tempTree({
      'map.ts': `export const referenceMap = { id: 'x' };\n`,
      'pack.ts': `export const data = {};\n`,
    });
    expect(checkTargetingModeDeclared(dir)).toEqual([]);
  });

  it('terrain-field: reaching past sweepToWall for a half-answer', () => {
    const dir = tempTree({
      'Good.ts': `const stop = sweepToWall(game, a, b);\n`,
      'Bad.ts': `if (pointInWall(game, x, y)) break;\n`,
    });
    expect(checkTerrainField(dir).map(v => v.file)).toEqual(['Bad.ts']);
  });

  it('buff-deactivate: calling .deactivate() on a buff', () => {
    const dir = tempTree({
      'Good.ts': `someBuff.deactivateBuff();\n`,
      'Bad.ts': `someBuff.deactivate();\n`,
    });
    expect(checkBuffDeactivate(dir).map(v => v.file)).toEqual(['Bad.ts']);
  });

  it('stat-resource-modifier: a bonus on the health or mana pool', () => {
    const dir = tempTree({
      'Good.ts': `const bonuses = { maxHealth: { baseBonus: 50 } };\n`,
      'Bad.ts': `const bonuses = { health: { baseBonus: 50 } };\n`,
    });
    expect(checkStatResourceModifier(dir).map(v => v.file)).toEqual(['Bad.ts']);
  });

  it('spell-object-display-box: a SpellObject with no stated extent', () => {
    const dir = tempTree({
      'Good.ts': `class GoodObject extends SpellObject { visionRadius = 100; }\n`,
      'Bad.ts': `class BadObject extends SpellObject { draw() {} }\n`,
    });
    const offenders = checkSpellObjectDisplayBox(dir).map(v => v.message);
    expect(offenders).toEqual(['BadObject inherits a zero-area display box']);
  });

  it('spell-object-display-box: the grandfathered list is honoured', () => {
    const dir = tempTree({ 'Old.ts': `class OldObject extends SpellObject {}\n` });
    expect(checkSpellObjectDisplayBox(dir).length).toBe(1);
    expect(checkSpellObjectDisplayBox(dir, { grandfathered: new Set(['OldObject']) })).toEqual([]);
  });

  it('spell-runtime-drive: a test calling a runtime hook directly', () => {
    const dir = tempTree({
      'Good.test.ts': `pressSpell(spell, { at: { x: 0, y: 0 } });\n`,
      'Bad.test.ts': `spell.onSpellCast();\n`,
      'NotATest.ts': `spell.onSpellCast(); // ignored: not a *.test.ts file\n`,
    });
    expect(checkSpellRuntimeDrive(dir).map(v => v.file)).toEqual(['Bad.test.ts']);
  });

  it('world-mouse-in-spell-code: a spell reading the shared cursor', () => {
    const dir = tempTree({
      'Good.ts': `const p = this.aimPoint;\n`,
      'Bad.ts': `const angle = getAngle(this.owner.position, this.game.worldMouse);\n`,
    });
    expect(checkWorldMouseInSpellCode(dir).map(v => v.file)).toEqual(['Bad.ts']);
  });

  it('world-mouse-in-spell-code: a pinned line is exempt, every other line on the same file is not', () => {
    // Fix round 1, content-pack-extraction batch 5 task 6: before `pinned`
    // existed, the only lever to exempt Blitzcrank_E.ts's one known
    // `worldMouse` line was `skip`, which removes the *whole file* from
    // *every* seam. This proves the finer-grained replacement: the pinned
    // line is exempt, a second, unrelated `worldMouse` line in the same
    // file is still caught.
    const dir = tempTree({
      'Bad.ts':
        `const p = this.aimPoint;\n` +
        `const angle = getAngle(this.owner.position, this.game.worldMouse);\n` +
        `const other = this.game.worldMouse;\n`,
    });

    expect(checkWorldMouseInSpellCode(dir).map(v => v.message)).toEqual([
      '2: const angle = getAngle(this.owner.position, this.game.worldMouse);',
      '3: const other = this.game.worldMouse;',
    ]);

    const withPin = checkWorldMouseInSpellCode(dir, { pinned: new Set(['Bad.ts:2']) });
    expect(withPin.map(v => v.message)).toEqual(['3: const other = this.game.worldMouse;']);
  });
});

// A "checkSeams against this repo's own pack, with its known debt declared"
// case used to live here, hand-listing packs/riot's grandfathered/exempt
// sets inline. Content-pack-extraction batch 5 task 6 gave the pack a real
// build-time gate of its own (`packs/riot/package.json`'s `check-seams`
// script) with those same sets declared once, on the pack's own side
// (`packs/riot/seam-debt.mjs`) — so this file hand-listing a second copy
// was a duplicate that could silently drift from the one that actually
// gates anything. `tests/scripts/checkSeams.bin.test.ts`'s "still finds
// packs/riot's own spells clean, its known debt declared through
// seam-debt.mjs" is that same proof now, run the way the pack's own build
// really runs it (through the bin, from the pack's own directory) rather
// than by re-deriving the pack's debt inline in a core test.

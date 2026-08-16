/**
 * Crowd control is only worth casting if everything that swings respects it.
 *
 * Champions get that for free: every swing goes through
 * `BasicAttackController`, which checks `owner.canAttack` — the flag
 * `Stats.updateActionState` clears for a disarm and for every control that
 * takes a unit over (stun, charm, fear, suppression, and so the knock-up).
 *
 * Three unit types do not use that controller. Minions, jungle camps and
 * turrets each run their own swing timer, and all three independently forgot
 * the gate. The result was a wave that kept hitting on the beat while it was
 * airborne, a camp that swung through a stun, and a turret that ignored crowd
 * control outright — with the buff, its status flags and even the knock-up
 * height all applying correctly, so the control read as doing nothing at all.
 *
 * A static scan rather than three more behaviour tests (there are those too, in
 * Minion/Monster/Turret's own files) because the mistake is structural: it will
 * be made a fourth time by whoever writes the next unit that swings on a timer,
 * and `tsc` cannot see it — the omission is perfectly well typed.
 *
 * Shaped after tests/game/spells/mana-spend-seam.test.ts.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCANNED_DIRECTORIES = ['attackableUnits', 'structures'];

/**
 * Arming a swing timer — the moment a unit commits to an attack it is about to
 * launch. Every unit that owns one of these spells its own interval into it.
 */
const ARMS_A_SWING = /_attackCooldown\s*=\s*this\.attackInterval/;

/** The gate that must be in the same file, on the branch that arms the timer. */
const READS_THE_GATE = /this\.canAttack\b/;

const gameObjectRoot = fileURLToPath(new URL('../../../src/game/gameObject/', import.meta.url));

const sourceFiles = (directory: string): string[] =>
  readdirSync(join(gameObjectRoot, directory), { recursive: true, encoding: 'utf8' })
    .filter(entry => entry.endsWith('.ts'))
    .map(entry => join(directory, entry));

/** The scan reads code, not prose — a comment must stay free to name the rule. */
const codeOnly = (line: string): string => {
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return '';
  return line.split('//')[0];
};

const code = (relativePath: string): string =>
  readFileSync(join(gameObjectRoot, relativePath), 'utf8').split('\n').map(codeOnly).join('\n');

describe('every unit that swings on its own timer consults canAttack', () => {
  it.each(SCANNED_DIRECTORIES)('holds for every file under %s/', directory => {
    const offenders = sourceFiles(directory).filter(file => {
      const source = code(file);
      return ARMS_A_SWING.test(source) && !READS_THE_GATE.test(source);
    });

    expect(offenders).toEqual([]);
  });

  // Without this the scan would pass on a tree where nothing arms a swing at
  // all — a rename of `_attackCooldown` would quietly retire the whole rule.
  it('is actually scanning the three units that own a swing timer', () => {
    const armed = SCANNED_DIRECTORIES.flatMap(sourceFiles).filter(file =>
      ARMS_A_SWING.test(code(file))
    );

    expect(armed.sort()).toEqual([
      join('attackableUnits', 'Minion.ts'),
      join('attackableUnits', 'Monster.ts'),
      join('structures', 'Turret.ts'),
    ]);
  });
});

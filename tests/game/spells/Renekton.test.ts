import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));

import Renekton_Q, {
  DAMAGE as Q_DAMAGE,
  ENRAGED_DAMAGE as Q_ENRAGED_DAMAGE,
  ENRAGED_RADIUS,
  RADIUS,
} from '../../../src/game/gameObject/spells/Renekton_Q';
import Renekton_W, {
  DAMAGE_PER_STRIKE,
  ENRAGED_STRIKES,
  STRIKES,
} from '../../../src/game/gameObject/spells/Renekton_W';
import Renekton_E, { DAMAGE as E_DAMAGE } from '../../../src/game/gameObject/spells/Renekton_E';
import Renekton_R, { isEnraged } from '../../../src/game/gameObject/spells/Renekton_R';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import Dash from '../../../src/game/gameObject/buffs/Dash';
import Shield from '../../../src/game/gameObject/buffs/Shield';
import Stun from '../../../src/game/gameObject/buffs/Stun';
import EventType from '../../../src/game/enums/EventType';
import type AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import type { CastContext } from '../../../src/game/spell/runtime/types';
import {
  createGame,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  type TestGame,
} from '../spell/fixtures';

const champion = (game: TestGame, x: number, y: number, teamId: string): AttackableUnit => {
  const unit = new Champion({ game, teamId } as never) as unknown as AttackableUnit;
  unit.position.set(x, y);
  return unit;
};

const context = (caster: AttackableUnit): CastContext => ({
  spellId: 'renekton-test',
  activationId: 'renekton-test',
  startedAtMs: 0,
  caster,
  origin: { x: caster.position.x, y: caster.position.y },
  cursorWorld: { x: caster.position.x + 100, y: caster.position.y },
  direction: { x: 1, y: 0 },
});

/** Reign of Anger is a buff, so "enraged" is one cast of R away. */
const enrage = (renekton: AttackableUnit) => {
  new Renekton_R(renekton).onSpellCast();
  expect(isEnraged(renekton)).toBe(true);
};

beforeEach(() => {
  installSpellObjectGlobals();
  installSketchMathGlobals();
});
afterEach(() => vi.unstubAllGlobals());

/**
 * Renekton has no Fury bar here, so Reign of Anger is expressed as the thing it
 * gates: while R is up, Q/W/E use their empowered numbers. If that flag does not
 * reach the abilities, the ultimate is only a health buff.
 */
describe('Reign of Anger reaches Cull the Meek', () => {
  const cleave = (enraged: boolean) => {
    const game = createGame();
    const renekton = champion(game, 0, 0, 'blue');
    const victim = champion(game, 100, 0, 'red');
    game.objectManager.queryObjects = vi.fn(() => [victim]) as never;
    if (enraged) enrage(renekton);

    const before = victim.stats.health.value;
    new Renekton_Q(renekton).onSpellCast(context(renekton));
    return { renekton, victim, dealt: before - victim.stats.health.value };
  };

  it('swings for the plain number and the plain radius on its own', () => {
    const { renekton, dealt } = cleave(false);
    expect(dealt).toBe(Q_DAMAGE);
    expect(new Renekton_Q(renekton).radius).toBe(RADIUS);
  });

  it('swings harder and wider while Dominus is up', () => {
    const { renekton, dealt } = cleave(true);
    expect(dealt).toBe(Q_ENRAGED_DAMAGE);
    expect(new Renekton_Q(renekton).radius).toBe(ENRAGED_RADIUS);
  });
});

/**
 * Ruthless Predator rides the real basic attack rather than dealing its own hit,
 * so the whole ability lives or dies on the `ON_ATTACK_HIT` subscription.
 */
describe('Renekton W spends itself on the next landed attack', () => {
  const bite = (enraged: boolean, shielded = false) => {
    const game = createGame();
    const renekton = champion(game, 0, 0, 'blue');
    const victim = champion(game, 60, 0, 'red');
    if (enraged) enrage(renekton);
    if (shielded) {
      const bubble = new Shield(5_000, victim, victim);
      bubble.amount = 200;
      victim.addBuff(bubble);
    }

    new Renekton_W(renekton).onSpellCast();
    const before = victim.stats.health.value;
    game.eventManager.emit(EventType.ON_ATTACK_HIT, {
      attacker: renekton,
      victim,
      damage: 0,
      ranged: false,
    });
    return { renekton, victim, dealt: before - victim.stats.health.value };
  };

  it('strikes twice and stuns', () => {
    const { victim, dealt } = bite(false);
    expect(dealt).toBe(DAMAGE_PER_STRIKE * STRIKES);
    expect(victim.buffs.some(buff => buff instanceof Stun)).toBe(true);
  });

  it('strikes three times through the shield it tore off', () => {
    const { victim, dealt } = bite(true, true);
    expect(dealt).toBe(DAMAGE_PER_STRIKE * ENRAGED_STRIKES);
    expect(victim.buffs.some(buff => buff instanceof Shield && !buff.toRemove)).toBe(false);
  });
});

/**
 * One pass, one hit each. A dash that damages what it flies through re-tests the
 * same bodies every frame it overlaps them, so without the hit set a slow target
 * eats the pass a dozen times over.
 */
describe('Renekton E hits each body once per pass', () => {
  const slice = () => {
    const game = createGame();
    const renekton = champion(game, 0, 0, 'blue');
    const victim = champion(game, 60, 0, 'red');
    game.objectManager.queryObjects = vi.fn(() => [victim]) as never;

    const spell = new Renekton_E(renekton);
    spell.onActivate(context(renekton));
    const dash = renekton.buffs.find(buff => buff instanceof Dash) as Dash;
    return { game, renekton, victim, spell, dash };
  };

  it('damages the same body once however many frames it is swept over', () => {
    const { victim, dash } = slice();
    const before = victim.stats.health.value;
    dash.onDashUpdate!();
    dash.onDashUpdate!();
    dash.onDashUpdate!();
    expect(before - victim.stats.health.value).toBe(E_DAMAGE);
  });

  it('closes the recast window when the pass connected with nobody', () => {
    const game = createGame();
    const renekton = champion(game, 0, 0, 'blue');
    game.objectManager.queryObjects = vi.fn(() => []) as never;

    const spell = new Renekton_E(renekton);
    expect(spell.press(context(renekton))).toBe(true);
    expect(spell.state).toBe('ACTIVE');

    // The pass ends having touched nothing, so there is no Dice to wait for.
    const dash = renekton.buffs.find(buff => buff instanceof Dash) as Dash;
    dash.deactivateBuff();
    expect(spell.state).not.toBe('ACTIVE');
  });
});

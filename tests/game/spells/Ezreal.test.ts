import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));

import Ezreal_Q, {
  EZREAL_Q_COOLDOWN_REFUND_MS,
  EZREAL_Q_DAMAGE,
  EZREAL_Q_RANGE,
  Ezreal_Q_Object,
} from '../../../src/game/gameObject/spells/Ezreal_Q';
import Ezreal_W, {
  EZREAL_W_DETONATE_DAMAGE,
  EZREAL_W_MANA_REFUND,
  EZREAL_W_MARK_DURATION_MS,
  Ezreal_W_Orb,
} from '../../../src/game/gameObject/spells/Ezreal_W';
import Ezreal_E, { EZREAL_E_BLINK_RANGE } from '../../../src/game/gameObject/spells/Ezreal_E';
import Ezreal_R, {
  EZREAL_R_CAST_TIME_MS,
  EZREAL_R_MINION_DAMAGE,
  Ezreal_R_Object,
} from '../../../src/game/gameObject/spells/Ezreal_R';
import Dash from '../../../src/game/gameObject/buffs/Dash';
import type Spell from '../../../src/game/gameObject/Spell';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import {
  createGame,
  createUnit,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  type TestGame,
} from '../spell/fixtures';

function unit(game: TestGame, x: number, teamId: string): AttackableUnit {
  const result = createUnit(game, x, teamId);
  result.collisionRadius = 1;
  result.stats.speed.baseValue = 10;
  result.stats.mana.baseValue = 100;
  result.stats.maxMana.baseValue = 200;
  result.stats.health.baseValue = 100;
  result.stats.maxHealth.baseValue = 100;
  result.animatedValues.displaySize = 20;
  return result;
}

/** `essenceFluxSpell` and the Q refund both read the caster's spell list. */
function giveSpells(owner: AttackableUnit, spells: Spell[]): void {
  (owner as unknown as { spells: Spell[] }).spells = spells;
}

describe('Ezreal', () => {
  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
    vi.stubGlobal('deltaTime', 250);
    vi.stubGlobal('createVector', (x = 0, y = 0) => new (p5 as any).Vector(x, y));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('Q fires a bolt to its full range and refunds every cooldown it lands on', () => {
    const game = createGame();
    (game as any).worldMouse = createVector(2000, 0);
    const owner = unit(game, 0, 'blue');
    const enemy = unit(game, 300, 'red');

    const q = new Ezreal_Q(owner);
    const w = new Ezreal_W(owner);
    giveSpells(owner, [q, w]);
    w.currentCooldown = 5000;

    q.onSpellCast();
    const bolt = game.objectManager._objectToBeAdd.find(
      object => object instanceof Ezreal_Q_Object
    ) as Ezreal_Q_Object;
    expect(bolt).toBeDefined();
    expect(bolt.position.dist(bolt.destination)).toBeCloseTo(EZREAL_Q_RANGE, 3);

    bolt.onHit(enemy);
    expect(enemy.stats.health.value).toBe(100 - EZREAL_Q_DAMAGE);
    expect(w.currentCooldown).toBe(5000 - EZREAL_Q_COOLDOWN_REFUND_MS);
  });

  it('W banks its damage on a mark and pays it out once, with mana back only for an ability', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const victim = unit(game, 200, 'red');
    const w = new Ezreal_W(owner);
    giveSpells(owner, [w]);

    const mark = w.applyMark(victim);
    expect(w.mark).toBe(mark);
    expect(mark.lifeTime).toBe(EZREAL_W_MARK_DURATION_MS);

    owner.stats.mana.baseValue = 10;
    expect(w.detonate(victim, true)).toBe(true);
    expect(victim.stats.health.value).toBe(100 - EZREAL_W_DETONATE_DAMAGE);
    expect(owner.stats.mana.value).toBe(10 + EZREAL_W_MANA_REFUND);
    // The sigil is spent: a second trigger on the same mark does nothing.
    expect(w.detonate(victim, true)).toBe(false);

    // A basic attack sets it off too, but does not pay the mana back.
    w.applyMark(victim);
    owner.stats.mana.baseValue = 10;
    expect(w.detonate(victim, false)).toBe(true);
    expect(owner.stats.mana.value).toBe(10);
  });

  it('W passes through anything that is not a champion', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const minion = unit(game, 200, 'red');
    const w = new Ezreal_W(owner);
    giveSpells(owner, [w]);

    const orb = new Ezreal_W_Orb(owner);
    expect(orb.maxHitCount).toBe(Infinity);

    orb.onHit(minion);
    expect(w.mark).toBeNull();
    expect(orb.toRemove).toBe(false);
  });

  it('E blinks with a Dash, not a teleport, and stops at its range', () => {
    const game = createGame();
    (game as any).worldMouse = createVector(2000, 0);
    const owner = unit(game, 0, 'blue');

    new Ezreal_E(owner).onSpellCast();

    const blink = owner.buffs.find(buff => buff instanceof Dash) as Dash;
    expect(blink).toBeDefined();
    expect(blink.dashDestination).not.toBeNull();
    expect(blink.dashDestination!.dist(owner.position)).toBeCloseTo(EZREAL_E_BLINK_RANGE, 3);
  });

  it('R charges before it fires and hits non-champions for the reduced number', () => {
    const game = createGame();
    const owner = unit(game, 0, 'blue');
    const minion = unit(game, 400, 'red');
    giveSpells(owner, []);

    const r = new Ezreal_R(owner);
    expect(r.castSpec.castTimeMs).toBe(EZREAL_R_CAST_TIME_MS);
    // Reading the cooldown builds the runtime, which validates the spec — a
    // refund named for an interrupt this form never fires throws right here.
    expect(r.currentCooldown).toBe(0);

    const beam = new Ezreal_R_Object(owner);
    beam.onHit(minion);
    expect(minion.stats.health.value).toBe(100 - EZREAL_R_MINION_DAMAGE);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));
import EventType from '../../../../src/game/enums/EventType';
import Dash from '../../../../src/game/gameObject/buffs/Dash';
import Stun from '../../../../src/game/gameObject/buffs/Stun';
import type AttackableUnit from '../../../../src/game/gameObject/attackableUnits/AttackableUnit';
import {
  createGame,
  createUnit,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  withWalls,
  type TestGame,
} from '../../../game/spell/fixtures';
import { buildContentApi } from '../../../../src/content/ContentApi';
import { VAYNE_Q_BONUS } from '../../../../packs/riot/spells/Vayne_Q';
import makeVayne_Q from '../../../../packs/riot/spells/Vayne_Q';
import { VAYNE_W_PROC, VAYNE_W_STACKS } from '../../../../packs/riot/spells/Vayne_W';
import makeVayne_W from '../../../../packs/riot/spells/Vayne_W';
import { VAYNE_E_DAMAGE, VAYNE_E_PUSH, VAYNE_E_STUN_MS, VAYNE_E_WALL_BONUS } from '../../../../packs/riot/spells/Vayne_E';
import makeVayne_E, { makeVayne_E_Object } from '../../../../packs/riot/spells/Vayne_E';
import { VAYNE_R_DURATION_MS, VAYNE_R_Q_CDR } from '../../../../packs/riot/spells/Vayne_R';
import makeVayne_R from '../../../../packs/riot/spells/Vayne_R';
const __api = buildContentApi();
const Vayne_Q = makeVayne_Q(__api);
const Vayne_W = makeVayne_W(__api);
const Vayne_E = makeVayne_E(__api);
const Vayne_E_Object = makeVayne_E_Object(__api);
const Vayne_R = makeVayne_R(__api);

/**
 * The pool every unit here starts from. Written by the test, so every expected
 * number below is arithmetic the test owns rather than a value read back out of
 * the code under test.
 */
const START_HEALTH = 100;

describe('Vayne spells', () => {
  let game: TestGame;
  let owner: AttackableUnit;

  function unit(x: number, teamId: string): AttackableUnit {
    const result = createUnit(game, x, teamId);
    result.collisionRadius = 1;
    result.stats.speed.baseValue = 10;
    result.stats.mana.baseValue = 100;
    result.stats.health.baseValue = START_HEALTH;
    result.stats.maxHealth.baseValue = START_HEALTH;
    result.animatedValues.displaySize = 20;
    return result;
  }

  /**
   * One landed basic attack, as `combat/BasicAttack` publishes it. `damage: 0`
   * because the emitter has already applied the swing itself by the time the
   * event goes out — anything the victim loses here is Vayne's on-hit kit.
   */
  function boltLanded(victim: AttackableUnit, attacker: AttackableUnit = owner) {
    game.eventManager.emit(EventType.ON_ATTACK_HIT, {
      attacker,
      victim,
      damage: 0,
      ranged: true,
    });
  }

  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
    vi.stubGlobal('deltaTime', 250);
    game = createGame();
    owner = unit(0, 'blue');
    game.setPlayer(owner);
    (game as any).worldMouse = createVector(300, 0);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('W procs on exactly the Nth hit against one victim, for W_PROC', () => {
    const victim = unit(80, 'red');
    new Vayne_W(owner).onSpellCast();

    for (let swing = 1; swing < VAYNE_W_STACKS; swing++) {
      boltLanded(victim);
      expect(victim.stats.health.value).toBe(START_HEALTH);
    }

    boltLanded(victim);
    expect(victim.stats.health.value).toBe(START_HEALTH - VAYNE_W_PROC);
  });

  it('W counts per victim, so switching targets carries nothing over', () => {
    const first = unit(80, 'red');
    const second = unit(140, 'red');
    new Vayne_W(owner).onSpellCast();

    for (let swing = 1; swing < VAYNE_W_STACKS; swing++) boltLanded(first);
    for (let swing = 1; swing < VAYNE_W_STACKS; swing++) boltLanded(second);

    expect(first.stats.health.value).toBe(START_HEALTH);
    expect(second.stats.health.value).toBe(START_HEALTH);
  });

  it('W resets that victim after a proc, so the next full count procs again', () => {
    const victim = unit(80, 'red');
    new Vayne_W(owner).onSpellCast();

    for (let swing = 0; swing < VAYNE_W_STACKS; swing++) boltLanded(victim);
    expect(victim.stats.health.value).toBe(START_HEALTH - VAYNE_W_PROC);

    for (let swing = 1; swing < VAYNE_W_STACKS; swing++) boltLanded(victim);
    expect(victim.stats.health.value).toBe(START_HEALTH - VAYNE_W_PROC);

    boltLanded(victim);
    expect(victim.stats.health.value).toBe(START_HEALTH - VAYNE_W_PROC * 2);
  });

  it('Q loads exactly one basic attack and is spent by it', () => {
    const victim = unit(80, 'red');
    new Vayne_Q(owner).onSpellCast();

    boltLanded(victim);
    expect(victim.stats.health.value).toBe(START_HEALTH - VAYNE_Q_BONUS);

    boltLanded(victim);
    expect(victim.stats.health.value).toBe(START_HEALTH - VAYNE_Q_BONUS);
  });

  it('Q does not empower someone else’s swing', () => {
    const victim = unit(80, 'red');
    const stranger = unit(200, 'green');
    new Vayne_Q(owner).onSpellCast();

    boltLanded(victim, stranger);
    expect(victim.stats.health.value).toBe(START_HEALTH);
  });

  it('E fires a bolt into the world', () => {
    new Vayne_E(owner).onSpellCast();
    expect(game.objectManager._objectToBeAdd.length).toBeGreaterThan(0);
  });

  /** The knock the bolt handed the victim, so its endpoint can be measured. */
  function knockOn(victim: AttackableUnit): Dash {
    const shove = victim.buffs.find(buff => buff instanceof Dash);
    expect(shove).toBeDefined();
    return shove as Dash;
  }

  it('E with a clear path pushes the victim the full distance and does not stun it', () => {
    const victim = unit(100, 'red');
    const bolt = new Vayne_E_Object(owner);
    bolt.destination = createVector(400, 0);

    bolt.onHit(victim);

    expect(victim.stats.health.value).toBe(START_HEALTH - VAYNE_E_DAMAGE);
    expect(victim.hasBuff(Stun)).toBe(false);
    // Straight away from Vayne, who is at x = 0: 100 + the full push.
    expect(knockOn(victim).dashDestination?.x).toBeCloseTo(100 + VAYNE_E_PUSH, 3);
  });

  it('E into a wall pins the victim: stunned for E_STUN_MS, plus E_WALL_BONUS', () => {
    withWalls(game, [
      [
        { x: 150, y: -300 },
        { x: 220, y: -300 },
        { x: 220, y: 300 },
        { x: 150, y: 300 },
      ],
    ]);
    const victim = unit(100, 'red');
    const bolt = new Vayne_E_Object(owner);
    bolt.destination = createVector(400, 0);

    bolt.onHit(victim);

    expect(victim.stats.health.value).toBe(START_HEALTH - VAYNE_E_DAMAGE - VAYNE_E_WALL_BONUS);
    const pin = victim.buffs.find(buff => buff instanceof Stun);
    expect(pin).toBeDefined();
    expect(pin?.duration).toBe(VAYNE_E_STUN_MS);
    // Stopped short of the wall face at x = 150, having moved at all.
    const stop = knockOn(victim).dashDestination?.x ?? 0;
    expect(stop).toBeGreaterThan(100);
    expect(stop).toBeLessThan(150);
  });

  it('R scales Q’s cooldown down while it lasts, and releases it when it ends', () => {
    const q = new Vayne_Q(owner);
    expect(q.effectiveCoolDownMs).toBe(q.coolDown);

    new Vayne_R(owner).onSpellCast();
    expect(q.effectiveCoolDownMs).toBe(q.coolDown * VAYNE_R_Q_CDR);

    game.objectManager.addObject(owner);
    vi.stubGlobal('deltaTime', 500);
    for (let frame = 0; frame < VAYNE_R_DURATION_MS / 500 + 3; frame++) {
      game.objectManager.update();
    }

    expect(q.effectiveCoolDownMs).toBe(q.coolDown);
  });
});

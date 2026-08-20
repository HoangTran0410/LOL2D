import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));

import Teemo_E, {
  MANA_COST,
  ON_HIT_DAMAGE,
  POISON_DAMAGE_PER_TICK,
  POISON_DURATION_MS,
  POISON_TICK_INTERVAL_MS,
  RANGE,
  Teemo_E_Object,
  Teemo_E_Splash,
} from '../../../src/game/gameObject/spells/Teemo_E';
import BasicAttack from '../../../src/game/gameObject/coreSpells/BasicAttack';
import DamageOverTime from '../../../src/game/gameObject/buffs/DamageOverTime';
import EventManager from '../../../src/managers/EventManager';
import EventType from '../../../src/game/enums/EventType';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import SpellInputController from '../../../src/game/spell/input/SpellInputController';
import { HotKeys, SpellHotKeys } from '../../../src/game/constants';
import { BasicAttackSwing, MELEE_WINDUP_MS } from '../../../src/game/combat/BasicAttack';
import { TestVector } from '../spell/fixtures';
import { createGame, indexObjects, stubGameGlobals } from '../fixtures';

const target = (teamId: string) =>
  Object.assign(Object.create(AttackableUnit.prototype) as AttackableUnit, {
    position: new TestVector(100, 0),
    animatedValues: { displaySize: 40 },
    teamId,
    // AttackableUnit.isDead is a getter over deathData, so leaving it unset
    // makes a fresh fixture read as already dead
    deathData: null,
    takeDamage: vi.fn(),
    addBuff: vi.fn(),
  });

const owner = () => {
  const objects: unknown[] = [];
  const manaStat = {
    baseValue: 200,
    get value() {
      return this.baseValue;
    },
    set value(value: number) {
      this.baseValue = value;
    },
  };
  return {
    position: new TestVector(0, 0),
    teamId: 'blue',
    isDead: false,
    canCast: true,
    stats: { mana: manaStat, health: { value: 100 } },
    game: {
      eventManager: new EventManager(),
      objectManager: { addObject: (object: unknown) => objects.push(object) },
    },
    objects,
  };
};

// Toxic Shot is a passive in the real game. It was an active-only dart here
// while the project had no basic attacks; now that it does, the passive is the
// real thing and the dart is the second way to deliver the same poison.
describe('Teemo E passive', () => {
  beforeEach(() => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => new TestVector(x, y));
    vi.stubGlobal('p5', { Vector: TestVector });
    vi.stubGlobal('deltaTime', 16);
    vi.stubGlobal('random', () => 0.5);
    vi.stubGlobal('TWO_PI', Math.PI * 2);
  });
  afterEach(() => vi.unstubAllGlobals());

  const landAttack = (caster: ReturnType<typeof owner>, attacker: unknown, victim: unknown) =>
    caster.game.eventManager.emit(EventType.ON_ATTACK_HIT, {
      attacker,
      victim,
      damage: 16,
      ranged: true,
    });

  it('poisons whatever a basic attack from its owner lands on', () => {
    const caster = owner();
    const spell = new Teemo_E(caster);
    const victim = target('red');

    spell.onUpdate(); // wires the listener on the first frame
    landAttack(caster, caster, victim);

    expect(victim.addBuff).toHaveBeenCalledTimes(1);
    const poison = (victim.addBuff as ReturnType<typeof vi.fn>).mock.calls[0][0] as DamageOverTime;
    expect(poison).toBeInstanceOf(DamageOverTime);
    expect(poison).toMatchObject({
      damagePerTick: POISON_DAMAGE_PER_TICK,
      tickInterval: POISON_TICK_INTERVAL_MS,
      duration: POISON_DURATION_MS,
    });
  });

  it('ignores attacks by anyone else, since the event is global', () => {
    const caster = owner();
    const spell = new Teemo_E(caster);
    const victim = target('red');

    spell.onUpdate();
    landAttack(caster, target('red'), victim);

    expect(victim.addBuff).not.toHaveBeenCalled();
  });

  it('subscribes once however many frames run', () => {
    const caster = owner();
    const spell = new Teemo_E(caster);
    const victim = target('red');

    spell.onUpdate();
    spell.onUpdate();
    spell.onUpdate();
    landAttack(caster, caster, victim);

    expect(victim.addBuff).toHaveBeenCalledTimes(1);
  });

  it('stops poisoning once the spell is removed from the champion', () => {
    const caster = owner();
    const spell = new Teemo_E(caster);
    const victim = target('red');

    spell.onUpdate();
    spell.onRemoved();
    landAttack(caster, caster, victim);

    expect(victim.addBuff).not.toHaveBeenCalled();
  });
});

/**
 * The passive's real seam, driven end to end.
 *
 * `landBasicAttack` in src/game/combat/BasicAttack.ts is the only place
 * `ON_ATTACK_HIT` is emitted, and the two delivery objects in that file are its
 * only callers. Every way of ordering an attack — the A slot spell, a right
 * click, the AI's own scan — therefore has to arrive at the same
 * `BasicAttackController.order()` and let the controller swing, or the passive
 * silently stops firing for that route. The A slot is the newest route and the
 * one the player will use most, so it gets the regression test: a real key
 * press through SpellInputController, and a real swing landing on a real unit,
 * with nothing emitting the event by hand.
 */
describe('Teemo E passive, through the A slot', () => {
  beforeEach(() => {
    stubGameGlobals();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('poisons a target attacked by pressing A', () => {
    const game = createGame();
    const teemo = new Champion({
      game,
      position: createVector(0, 0),
      teamId: 'blue',
      preset: {
        // melee, so one wind-up resolves the swing instead of a bolt flight
        attack: { damage: 20, attacksPerSecond: 1, range: 100 },
        spells: [BasicAttack, Teemo_E],
      },
    });
    const victim = new Champion({ game, position: createVector(100, 0), teamId: 'red' });
    game.setPlayer(teemo);
    indexObjects(game, [teemo, victim]);

    const input = new SpellInputController({
      keyBindings: SpellHotKeys,
      getSpell: slot => teemo.spells[slot],
      createContext: () =>
        Object.freeze({
          spellId: 'basic-attack',
          activationId: 'activation',
          startedAtMs: 0,
          caster: teemo,
          origin: Object.freeze({ x: 0, y: 0 }),
          cursorWorld: Object.freeze({ x: victim.position.x, y: victim.position.y }),
          direction: Object.freeze({ x: 1, y: 0 }),
        }),
    });

    // one frame to let Teemo E wire its listener, exactly as Champion.update does
    teemo.update();

    input.keyDown(HotKeys.A, false);
    input.keyUp(HotKeys.A);
    expect(teemo.basicAttack.target).toBe(victim);

    teemo.basicAttack.update();
    const swing = game.objectManager._objectToBeAdd[0];
    expect(swing).toBeInstanceOf(BasicAttackSwing);

    vi.stubGlobal('deltaTime', MELEE_WINDUP_MS);
    (swing as BasicAttackSwing).update();

    const poison = victim.buffs.find(buff => buff instanceof DamageOverTime);
    expect(poison).toBeInstanceOf(DamageOverTime);
    expect(poison).toMatchObject({
      damagePerTick: POISON_DAMAGE_PER_TICK,
      tickInterval: POISON_TICK_INTERVAL_MS,
      duration: POISON_DURATION_MS,
    });
    // and the swing really landed, so the poison is not the whole of it
    expect(victim.stats.health.value).toBe(80);
  });
});

describe('Teemo E', () => {
  beforeEach(() => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => new TestVector(x, y));
    vi.stubGlobal('p5', { Vector: TestVector });
    vi.stubGlobal('deltaTime', 16);
    vi.stubGlobal('random', () => 0.5);
    vi.stubGlobal('TWO_PI', Math.PI * 2);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('fires a single-target vial clamped to range', () => {
    const caster = owner();
    caster.position = new TestVector(0, 0);
    const spell = new Teemo_E(caster);
    spell.press?.({
      spellId: 'teemo-e',
      activationId: 'a',
      startedAtMs: 0,
      caster: {},
      origin: { x: 0, y: 0 },
      cursorWorld: { x: RANGE * 5, y: 0 },
      direction: { x: 1, y: 0 },
    } as never);

    const vial = caster.objects[0] as Teemo_E_Object;
    expect(vial).toBeInstanceOf(Teemo_E_Object);
    expect(vial.destination.x).toBeCloseTo(RANGE);
    expect(vial.maxHitCount).toBe(1);
    expect(caster.stats.mana.value).toBe(200 - MANA_COST);
  });

  it('hits the first enemy for on-hit damage and applies its own poison stack', () => {
    const caster = owner();
    const enemy = target('red');
    const vial = new Teemo_E_Object(caster as never);

    vial.onHit(enemy);

    expect(enemy.takeDamage).toHaveBeenCalledWith(ON_HIT_DAMAGE, caster);
    expect(enemy.addBuff).toHaveBeenCalledTimes(1);
    const poison = (enemy.addBuff as ReturnType<typeof vi.fn>).mock.calls[0][0] as DamageOverTime;
    expect(poison).toBeInstanceOf(DamageOverTime);
    expect(poison.stackId).toBe('teemo_e_toxicshot');
    expect(poison.damagePerTick).toBe(POISON_DAMAGE_PER_TICK);
    expect(poison.tickInterval).toBe(POISON_TICK_INTERVAL_MS);
    expect(poison.duration).toBe(POISON_DURATION_MS);
    // 4 ticks over the duration, matching the imported rank-1 total (24)
    expect((poison.duration / poison.tickInterval) * poison.damagePerTick).toBe(24);
  });

  it('embeds in the first hit only — maxHitCount stops it from piercing to a second target', () => {
    const caster = owner();
    const vial = new Teemo_E_Object(caster as never);
    const first = target('red');

    vial.hitTargets.push(first);
    expect(vial.hitTargets.length).toBeGreaterThanOrEqual(vial.maxHitCount);
  });

  it('does not use a bare DamageOverTime that would collide with another poison spell', () => {
    const caster = owner();
    const enemy = target('red');
    const vial = new Teemo_E_Object(caster as never);
    vial.onHit(enemy);
    const poison = (enemy.addBuff as ReturnType<typeof vi.fn>).mock.calls[0][0] as DamageOverTime;
    expect(poison.stackId).not.toBe(DamageOverTime);
  });

  it('draws a procedural vial and splash, never blitting the ability icon', () => {
    const caster = owner();
    const vial = new Teemo_E_Object(caster as never);
    vial.destination = new TestVector(100, 0) as never;

    const draw = { ellipse: vi.fn(), rect: vi.fn(), arc: vi.fn(), circle: vi.fn() };
    for (const [name, spy] of Object.entries(draw)) vi.stubGlobal(name, spy);
    for (const name of [
      'push',
      'pop',
      'translate',
      'rotate',
      'blendMode',
      'fill',
      'stroke',
      'noFill',
      'noStroke',
      'strokeWeight',
    ]) {
      vi.stubGlobal(name, vi.fn());
    }
    for (const name of ['ADD', 'BLEND', 'PI']) vi.stubGlobal(name, name === 'PI' ? Math.PI : name);
    vi.stubGlobal('cos', Math.cos);
    vi.stubGlobal('sin', Math.sin);

    expect(vial.image).toBeUndefined();
    vial.draw();
    expect(draw.ellipse).toHaveBeenCalled();
    expect(draw.rect).toHaveBeenCalled();

    const box = vial.getDisplayBoundingBox();
    expect(box.w).toBeGreaterThanOrEqual(vial.size);

    const splash = new Teemo_E_Splash(caster as never);
    splash.position = new TestVector(0, 0) as never;
    vi.stubGlobal('constrain', (value: number, low: number, high: number) =>
      Math.min(Math.max(value, low), high)
    );
    splash.onAdded();
    splash.draw();
    expect(draw.circle).toHaveBeenCalled();
    const splashBox = splash.getDisplayBoundingBox();
    expect(splashBox.w).toBeGreaterThan(splash.targetSize);
  });
});

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: vi.fn(() => undefined), getAsset: vi.fn(() => undefined) },
}));

import Anivia_R, { Anivia_R_Object } from '../../../src/game/gameObject/spells/Anivia_R';
import type { CastContext } from '../../../src/game/spell/runtime/types';

class TestVector {
  constructor(public x = 0, public y = 0) {}

  copy(): TestVector { return new TestVector(this.x, this.y); }
  limit(maximum: number): TestVector {
    const magnitude = Math.hypot(this.x, this.y);
    if (magnitude > maximum) {
      this.x = (this.x / magnitude) * maximum;
      this.y = (this.y / magnitude) * maximum;
    }
    return this;
  }
}

Object.assign(globalThis, {
  createVector: (x = 0, y = 0) => new TestVector(x, y),
  map: (value: number, fromLow: number, fromHigh: number, toLow: number, toHigh: number) =>
    toLow + ((value - fromLow) / (fromHigh - fromLow)) * (toHigh - toLow),
  p5: {
    Vector: {
      add: (left: TestVector, right: TestVector) =>
        new TestVector(left.x + right.x, left.y + right.y),
      sub: (left: TestVector, right: TestVector) =>
        new TestVector(left.x - right.x, left.y - right.y),
    },
  },
});

const vector = (x: number, y: number): p5.Vector =>
  new TestVector(x, y) as unknown as p5.Vector;

const context = (cursorWorld: { x: number; y: number }): CastContext => ({
  spellId: 'anivia-r',
  activationId: 'activation',
  startedAtMs: 0,
  caster: {},
  origin: { x: 0, y: 0 },
  cursorWorld,
  direction: { x: 1, y: 0 },
});

const setup = (mana = 240) => {
  const added: Anivia_R_Object[] = [];
  const enemy = {
    position: new TestVector(100, 0),
    collisionRadius: 0,
    damage: [] as number[],
    buffs: [] as unknown[],
    takeDamage(damage: number) { this.damage.push(damage); },
    addBuff(buff: unknown) { this.buffs.push(buff); },
  };
  const manaStat = {
    baseValue: mana,
    get value() { return this.baseValue; },
    set value(value: number) { this.baseValue = value; },
  };
  const owner = {
    game: {
      worldMouse: { x: 100, y: 0 },
      eventManager: { emit: vi.fn() },
      objectManager: {
        addObject: (object: Anivia_R_Object) => added.push(object),
        queryObjects: vi.fn(() => [enemy]),
      },
    },
    position: vector(0, 0),
    teamId: 'blue',
    isDead: false,
    canCast: true,
    inStasis: false,
    hasBuff: vi.fn(function (this: { inStasis: boolean }, BuffClass: { name: string }) {
      return this.inStasis && BuffClass.name === 'Stasis';
    }),
    stats: { mana: manaStat, health: { value: 100 } },
  };

  return { spell: new Anivia_R(owner), owner, enemy, added };
};

const updateSpell = (spell: Anivia_R, deltaMs: number) => {
  vi.stubGlobal('deltaTime', deltaMs);
  spell.update();
  vi.stubGlobal('deltaTime', 16);
};

describe('Anivia R', () => {
  it('creates one ACTIVE storm at the selected point', () => {
    const { spell, added } = setup();

    spell.press(context({ x: 300, y: 0 }));

    expect(spell.state).toBe('ACTIVE');
    expect(added).toHaveLength(1);
    expect(added[0].center).toEqual({ x: 300, y: 0 });
  });

  it('lets Anivia move and cast while the storm remains active', () => {
    const { spell, owner } = setup();

    spell.press(context({ x: 300, y: 0 }));
    owner.position.x = 200;
    spell.update();

    expect(spell.state).toBe('ACTIVE');
  });

  it('applies the initial damage and slow tick at 0ms', () => {
    const { spell, added, enemy } = setup();

    spell.press(context({ x: 100, y: 0 }));

    expect(added[0].radius).toBe(200);
    expect(enemy.damage).toEqual([2]);
    expect(enemy.buffs).toHaveLength(1);
    expect(enemy.buffs[0]).toMatchObject({ percent: 0.2, duration: 1_000 });
  });

  it('grows and empowers damage and slow at exactly 1500ms', () => {
    const { spell, added, enemy } = setup();

    spell.press(context({ x: 100, y: 0 }));
    added[0].update(1_500);

    expect(added[0].radius).toBe(400);
    expect(enemy.damage).toEqual([2, 2, 2, 12]);
    expect(enemy.buffs).toHaveLength(4);
    expect(enemy.buffs.at(-1)).toMatchObject({ percent: 0.3, duration: 1_500 });
  });

  it('uses each due tick radius when catching up a long frame', () => {
    const { spell, added, enemy } = setup();
    enemy.position.x = 450;

    spell.press(context({ x: 100, y: 0 }));
    added[0].update(1_500);

    expect(enemy.damage).toEqual([12]);
    expect(enemy.buffs).toHaveLength(1);
  });

  it('queries the imported 200 267 333 and 400 radius checkpoints', () => {
    const { spell, owner, added } = setup();

    spell.press(context({ x: 100, y: 0 }));
    added[0].update(1_500);

    const radii = owner.game.objectManager.queryObjects.mock.calls
      .map(([query]) => query.area.r as number);
    expect(radii).toContain(200);
    expect(radii).toContain(267);
    expect(radii).toContain(333);
    expect(radii).toContain(400);
  });

  it('pays 60 mana on activation, then 35 mana once per second', () => {
    const { spell, owner } = setup();

    spell.press(context({ x: 100, y: 0 }));
    expect(owner.stats.mana.value).toBe(180);
    updateSpell(spell, 999);
    expect(owner.stats.mana.value).toBe(180);
    updateSpell(spell, 1);

    expect(owner.stats.mana.value).toBe(145);
  });

  it('does not mistake Stasis for interrupting crowd control', () => {
    const { spell, owner, added } = setup();
    spell.press(context({ x: 100, y: 0 }));
    owner.canCast = false;
    owner.inStasis = true;

    spell.update();

    expect(spell.state).toBe('ACTIVE');
    expect(added[0].toRemove).toBe(false);
  });

  it('ends after a permitted second press', () => {
    const { spell, added, enemy } = setup();

    spell.press(context({ x: 100, y: 0 }));
    spell.press(context({ x: 100, y: 0 }));

    expect(spell.state).toBe('COOLDOWN');
    expect(added[0].toRemove).toBe(true);
    expect(enemy.damage).toEqual([2, 2]);
  });

  it.each([
    ['death', (owner: ReturnType<typeof setup>['owner'], spell: Anivia_R) => { owner.isDead = true; spell.update(); }],
    ['no mana', (owner: ReturnType<typeof setup>['owner'], spell: Anivia_R) => { owner.stats.mana.baseValue = 0; updateSpell(spell, 1_000); }],
    ['tether violation', (owner: ReturnType<typeof setup>['owner'], spell: Anivia_R) => { owner.position.x = 600; spell.update(); }],
    ['silence', (_owner: ReturnType<typeof setup>['owner'], spell: Anivia_R) => { spell.cancel('SILENCE'); }],
  ])('ends on %s', (_reason, end) => {
    const { spell, owner, added } = setup();

    spell.press(context({ x: 100, y: 0 }));
    end(owner, spell);

    expect(spell.state).toBe('COOLDOWN');
    expect(added[0].toRemove).toBe(true);
  });

  it('starts cooldown and cleans storm members exactly once', () => {
    const { spell, added, enemy } = setup();

    spell.press(context({ x: 100, y: 0 }));
    added[0].update(500);
    spell.press(context({ x: 100, y: 0 }));
    spell.press(context({ x: 100, y: 0 }));
    added[0].onRemoved();
    added[0].onRemoved();

    expect(spell.currentCooldown).toBe(spell.coolDown);
    expect(added[0].members?.size).toBe(0);
    expect(enemy.damage).toEqual([2, 2, 2]);
  });

  it('tears down its active area idempotently on deactivate and removal', () => {
    const { spell, added } = setup();
    spell.press(context({ x: 100, y: 0 }));

    spell.deactivate();
    spell.onRemoved();

    expect(added[0].toRemove).toBe(true);
    expect(spell.activeStorm).toBeUndefined();
  });

  it('tears down its active storm through base spell deactivation exactly once', () => {
    const { spell, added } = setup();
    const onCancel = vi.spyOn(spell, 'onCancel');
    spell.press(context({ x: 100, y: 0 }));

    spell.deactivate();
    spell.onRemoved();

    expect(added[0].toRemove).toBe(true);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(spell.state).toBe('READY');
    expect(spell.currentCooldown).toBe(0);
  });
});

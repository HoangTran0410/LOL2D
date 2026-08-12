import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { getAsset: vi.fn(() => undefined) },
}));

import Anivia_R from '../../../src/game/gameObject/spells/Anivia_R';
import Janna_Q from '../../../src/game/gameObject/spells/Janna_Q';
import Janna_R from '../../../src/game/gameObject/spells/Janna_R';
import Lux_R from '../../../src/game/gameObject/spells/Lux_R';
import Malphite_Q from '../../../src/game/gameObject/spells/Malphite_Q';
import Pantheon_Q, {
  Pantheon_Q_Spear,
} from '../../../src/game/gameObject/spells/Pantheon_Q';
import Varus_Q, { Varus_Q_Arrow } from '../../../src/game/gameObject/spells/Varus_Q';
import BeamSpellObject from '../../../src/game/gameObject/spellObjects/BeamSpellObject';
import type {
  ActivationPattern,
  CastContext,
} from '../../../src/game/spell/runtime/types';

class TestVector {
  constructor(public x = 0, public y = 0) {}

  copy(): TestVector { return new TestVector(this.x, this.y); }
  set(x: number, y: number): this { this.x = x; this.y = y; return this; }
  add(value: TestVector): this { this.x += value.x; this.y += value.y; return this; }
  mult(value: number): this { this.x *= value; this.y *= value; return this; }
  mag(): number { return Math.hypot(this.x, this.y); }
  setMag(value: number): this {
    const length = this.mag();
    if (length > 0) this.mult(value / length);
    return this;
  }
  dist(value: TestVector): number { return Math.hypot(this.x - value.x, this.y - value.y); }
  static add(first: TestVector, second: TestVector): TestVector {
    return first.copy().add(second);
  }
  static sub(first: TestVector, second: TestVector): TestVector {
    return new TestVector(first.x - second.x, first.y - second.y);
  }
}

const context = (caster: unknown, target?: unknown): CastContext => Object.freeze({
  spellId: 'representative-spell',
  activationId: 'activation',
  startedAtMs: 0,
  caster,
  origin: Object.freeze({ x: 0, y: 0 }),
  cursorWorld: Object.freeze({ x: 100, y: 0 }),
  direction: Object.freeze({ x: 1, y: 0 }),
  ...(target === undefined ? {} : { target }),
});

const makeOwner = (mana = 200) => {
  const objects: unknown[] = [];
  const owner = {
    position: new TestVector(),
    destination: new TestVector(),
    collisionRadius: 20,
    teamId: 'blue',
    isDead: false,
    canCast: true,
    willDraw: true,
    targetable: true,
    spells: [] as unknown[],
    stats: {
      mana: { value: mana },
      health: { value: 100 },
      speed: { value: 10 },
      addModifier: vi.fn(),
      removeModifier: vi.fn(),
    },
    stopMovement() { this.destination.set(this.position.x, this.position.y); },
    addBuff: vi.fn((buff: { activateBuff?: () => void }) => buff.activateBuff?.()),
    takeHeal: vi.fn(),
    takeDamage: vi.fn(),
    game: {
      worldMouse: new TestVector(100, 0),
      eventManager: {
        emit: vi.fn(),
        on: vi.fn(() => () => undefined),
      },
      terrainMap: { getObstaclesInArea: vi.fn(() => []) },
      objectManager: {
        objects,
        addObject: vi.fn((object: unknown) => { objects.push(object); }),
        queryObjects: vi.fn(() => []),
      },
    },
    objects,
  };
  return owner;
};

const makeTarget = () => ({
  position: new TestVector(100, 0),
  collisionRadius: 10,
  teamId: 'red',
  isDead: false,
  toRemove: false,
  willDraw: true,
  targetable: true,
  stats: { speed: { value: 10 } },
  takeDamage: vi.fn(),
  addBuff: vi.fn(),
});

class InspectableLuxR extends Lux_R {
  get activationPattern(): ActivationPattern { return this.castSpec.activation; }
}
class InspectableJannaR extends Janna_R {
  get activationPattern(): ActivationPattern { return this.castSpec.activation; }
}
class InspectableJannaQ extends Janna_Q {
  get activationPattern(): ActivationPattern { return this.castSpec.activation; }
}
class InspectableAniviaR extends Anivia_R {
  get activationPattern(): ActivationPattern { return this.castSpec.activation; }
}
class InspectableVarusQ extends Varus_Q {
  get activationPattern(): ActivationPattern { return this.castSpec.activation; }
}
class InspectablePantheonQ extends Pantheon_Q {
  get activationPattern(): ActivationPattern { return this.castSpec.activation; }
}
class InspectableMalphiteQ extends Malphite_Q {
  get activationPattern(): ActivationPattern { return this.castSpec.activation; }
}

describe('representative spells through public commands', () => {
  beforeEach(() => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => new TestVector(x, y));
    vi.stubGlobal('p5', { Vector: TestVector });
    vi.stubGlobal('deltaTime', 16);
    vi.stubGlobal('random', () => 0.5);
    vi.stubGlobal('TWO_PI', Math.PI * 2);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('publishes all seven activation patterns', () => {
    expect({
      luxR: new InspectableLuxR(makeOwner()).activationPattern,
      jannaR: new InspectableJannaR(makeOwner()).activationPattern,
      jannaQ: new InspectableJannaQ(makeOwner()).activationPattern,
      aniviaR: new InspectableAniviaR(makeOwner()).activationPattern,
      varusQ: new InspectableVarusQ(makeOwner()).activationPattern,
      pantheonQ: new InspectablePantheonQ(makeOwner()).activationPattern,
      malphiteQ: new InspectableMalphiteQ(makeOwner()).activationPattern,
    }).toEqual({
      luxR: 'PRESS',
      jannaR: 'PRESS',
      jannaQ: 'RECAST',
      aniviaR: 'TOGGLE',
      varusQ: 'HOLD_RELEASE',
      pantheonQ: 'TAP_OR_HOLD',
      malphiteQ: 'PRESS',
    });
  });

  it('honors PRESS, RECAST, and TOGGLE commit points', () => {
    const luxOwner = makeOwner();
    const luxR = new Lux_R(luxOwner);
    expect(luxR.press(context(luxOwner))).toBe(true);
    expect(luxR.state).toBe('CASTING');
    expect(luxOwner.stats.mana.value).toBe(200 - luxR.manaCost);
    expect(luxR.currentCooldown).toBe(0);
    vi.stubGlobal('deltaTime', 1_000);
    luxR.update();
    expect(luxR.currentCooldown).toBe(luxR.coolDown);

    const jannaROwner = makeOwner();
    const jannaR = new Janna_R(jannaROwner);
    expect(jannaR.press(context(jannaROwner))).toBe(true);
    expect(jannaR.state).toBe('CHANNELING');
    expect(jannaROwner.stats.mana.value).toBe(200 - jannaR.manaCost);
    expect(jannaR.currentCooldown).toBe(0);
    vi.stubGlobal('deltaTime', 3_000);
    jannaR.update();
    expect(jannaR.currentCooldown).toBe(jannaR.coolDown);

    const jannaQOwner = makeOwner();
    const jannaQ = new Janna_Q(jannaQOwner);
    expect(jannaQ.press(context(jannaQOwner))).toBe(true);
    expect(jannaQ.state).toBe('ACTIVE');
    expect(jannaQOwner.stats.mana.value).toBe(200 - jannaQ.manaCost);
    expect(jannaQ.currentCooldown).toBe(0);
    expect(jannaQ.release(context(jannaQOwner))).toBe(false);
    expect(jannaQ.state).toBe('ACTIVE');
    expect(jannaQ.press(context(jannaQOwner))).toBe(true);
    expect(jannaQ.currentCooldown).toBe(jannaQ.coolDown);

    const aniviaOwner = makeOwner();
    const aniviaR = new Anivia_R(aniviaOwner);
    expect(aniviaR.press(context(aniviaOwner))).toBe(true);
    expect(aniviaR.state).toBe('ACTIVE');
    expect(aniviaOwner.stats.mana.value).toBe(200);
    expect(aniviaR.currentCooldown).toBe(0);
    vi.stubGlobal('deltaTime', 500);
    aniviaR.update();
    expect(aniviaOwner.stats.mana.value).toBe(200 - aniviaR.manaCost);
    expect(aniviaR.currentCooldown).toBe(0);
    expect(aniviaR.press(context(aniviaOwner))).toBe(true);
    expect(aniviaR.currentCooldown).toBe(aniviaR.coolDown);
  });

  it('honors HOLD_RELEASE and both TAP_OR_HOLD releases', () => {
    const varusOwner = makeOwner();
    const varusQ = new Varus_Q(varusOwner);
    expect(varusQ.press(context(varusOwner))).toBe(true);
    expect(varusQ.state).toBe('CHARGING');
    expect(varusOwner.stats.mana.value).toBe(200 - varusQ.manaCost);
    expect(varusQ.currentCooldown).toBe(0);
    expect(varusQ.release(context(varusOwner))).toBe(true);
    expect(varusOwner.objects[0]).toBeInstanceOf(Varus_Q_Arrow);
    expect(varusQ.currentCooldown).toBe(varusQ.coolDown);

    const tapOwner = makeOwner();
    const tapQ = new Pantheon_Q(tapOwner);
    expect(tapQ.press(context(tapOwner))).toBe(true);
    expect(tapOwner.stats.mana.value).toBe(200 - tapQ.manaCost);
    expect(tapQ.currentCooldown).toBe(0);
    expect(tapQ.release(context(tapOwner))).toBe(true);
    expect(tapOwner.objects[0]).toBeInstanceOf(BeamSpellObject);
    expect(tapQ.currentCooldown).toBe(tapQ.coolDown * 0.4);

    const holdOwner = makeOwner();
    const holdQ = new Pantheon_Q(holdOwner);
    expect(holdQ.press(context(holdOwner))).toBe(true);
    vi.stubGlobal('deltaTime', 351);
    holdQ.update();
    expect(holdQ.currentCooldown).toBe(0);
    expect(holdQ.release(context(holdOwner))).toBe(true);
    expect(holdOwner.objects[0]).toBeInstanceOf(Pantheon_Q_Spear);
    expect(holdOwner.stats.mana.value).toBe(200 - holdQ.manaCost);
    expect(holdQ.currentCooldown).toBe(holdQ.coolDown);
  });

  it('rejects an absent UNIT target and commits only when a target releases', () => {
    const owner = makeOwner();
    const spell = new Malphite_Q(owner);
    expect(spell.press(context(owner))).toBe(false);
    expect(owner.stats.mana.value).toBe(200);
    expect(spell.currentCooldown).toBe(0);

    const target = makeTarget();
    expect(spell.press(context(owner, target))).toBe(true);
    expect(spell.state).toBe('CASTING');
    expect(owner.stats.mana.value).toBe(200);
    expect(spell.currentCooldown).toBe(0);
    vi.stubGlobal('deltaTime', 250);
    spell.update();
    expect(owner.stats.mana.value).toBe(200 - spell.manaCost);
    expect(spell.currentCooldown).toBe(spell.coolDown);
  });
});

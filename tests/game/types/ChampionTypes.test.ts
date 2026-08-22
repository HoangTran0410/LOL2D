import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { TEST_AVATAR_KEY } from '../fixtures';
import { Rectangle } from '../../../src/libs/quadtree';
import AssetManager from '../../../src/managers/AssetManager';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import AIChampion from '../../../src/game/gameObject/attackableUnits/AIChampion';
import DummyChampion from '../../../src/game/gameObject/attackableUnits/DummyChampion';
import Monster from '../../../src/game/gameObject/attackableUnits/Monster';
import Turret, { TurretBolt } from '../../../src/game/gameObject/structures/Turret';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import Buff from '../../../src/game/gameObject/Buff';
import Shield from '../../../src/game/gameObject/buffs/Shield';
import ObjectManager from '../../../src/game/managers/ObjectManager';
import Spell from '../../../src/game/gameObject/Spell';
import type { GameObjectRuntimeContext } from '../../../src/game/gameObject/GameObject';
import EventManager from '../../../src/managers/EventManager';
import {
  requireChargeSpec,
  type ChargeCastSpec,
  type ChargeSpec,
} from '../../../src/game/spell/runtime/types';
import championSource from '../../../src/game/gameObject/attackableUnits/Champion.ts?raw';
import aiChampionSource from '../../../src/game/gameObject/attackableUnits/AIChampion.ts?raw';
import dummyChampionSource from '../../../src/game/gameObject/attackableUnits/DummyChampion.ts?raw';
import monsterSource from '../../../src/game/gameObject/attackableUnits/Monster.ts?raw';
import turretSource from '../../../src/game/gameObject/structures/Turret.ts?raw';

/**
 * Comments stripped before any of these are matched. The rule is about the
 * *code* — an explicit `any`, a deprecated asset lookup — and `\bany\b` against
 * a raw file matches the English word as readily as the type, so a doc comment
 * saying "hitting any one of them" failed the type-safety scan. Every scan in
 * this repo strips first for the same reason; see the Testing section of
 * CLAUDE.md.
 */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

const scopedSources = [
  championSource,
  aiChampionSource,
  dummyChampionSource,
  monsterSource,
  turretSource,
].map(stripComments);

class TestVector {
  constructor(
    public x = 0,
    public y = 0
  ) {}
  copy() {
    return new TestVector(this.x, this.y);
  }
  set(x: number, y: number) {
    this.x = x;
    this.y = y;
    return this;
  }
  add(vector: TestVector) {
    this.x += vector.x;
    this.y += vector.y;
    return this;
  }
  mult(value: number) {
    this.x *= value;
    this.y *= value;
    return this;
  }
  normalize() {
    return this.setMag(1);
  }
  magSq() {
    return this.x * this.x + this.y * this.y;
  }
  setMag(value: number) {
    const magnitude = Math.hypot(this.x, this.y);
    if (magnitude > 0) this.mult(value / magnitude);
    return this;
  }
  dist(vector: TestVector) {
    return Math.hypot(this.x - vector.x, this.y - vector.y);
  }
  static sub(a: TestVector, b: TestVector) {
    return new TestVector(a.x - b.x, a.y - b.y);
  }
  static dist(a: TestVector, b: TestVector) {
    return a.dist(b);
  }
}

function createGame(): GameObjectRuntimeContext & { setPlayer(player: AttackableUnit): void } {
  const camera = { getBoundingBox: () => new Rectangle({ x: 0, y: 0, w: 0, h: 0 }) };
  const objectManager = new ObjectManager({ mapSize: 1000, camera });
  let player: AttackableUnit | undefined;

  return {
    mapSize: 1000,
    camera,
    objectManager,
    eventManager: new EventManager(),
    get player() {
      if (!player) throw new Error('Player is not available in this test context.');
      return player;
    },
    randomSpawnPoint: () => createVector(),
    createSpellContext: () => undefined,
    setPlayer(value: AttackableUnit) {
      player = value;
    },
  };
}

function indexObjects(game: GameObjectRuntimeContext, objects: AttackableUnit[]): void {
  game.objectManager.objects = objects;
  game.objectManager._objectsTree.clear();
  for (const object of objects) {
    game.objectManager._objectsTree.insert(object.getDisplayBoundingBox());
  }
}

describe('champion and direct-subclass type boundary', () => {
  beforeEach(() => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => new TestVector(x, y));
    vi.stubGlobal('p5', { Vector: TestVector });
    vi.stubGlobal('random', () => 0);
    vi.stubGlobal('deltaTime', 16);
    vi.stubGlobal(
      'lerp',
      (from: number, to: number, amount: number) => from + (to - from) * amount
    );
    vi.stubGlobal(
      'map',
      (value: number, start1: number, stop1: number, start2: number, stop2: number) =>
        start2 + ((value - start1) / (stop1 - start1)) * (stop2 - start2)
    );
    vi.stubGlobal('push', vi.fn());
    vi.stubGlobal('pop', vi.fn());
    vi.stubGlobal('fill', vi.fn());
    vi.stubGlobal('stroke', vi.fn());
    vi.stubGlobal('strokeWeight', vi.fn());
    vi.stubGlobal('rect', vi.fn());
    vi.stubGlobal('line', vi.fn());
    vi.stubGlobal('constrain', (n: number, low: number, high: number) =>
      Math.min(high, Math.max(low, n))
    );
    vi.stubGlobal('textSize', vi.fn());
    vi.stubGlobal('text', vi.fn());
    vi.stubGlobal('noStroke', vi.fn());
    vi.stubGlobal('image', vi.fn());
    vi.stubGlobal('tint', vi.fn());
    vi.stubGlobal('textAlign', vi.fn());
    vi.stubGlobal('RIGHT', 'RIGHT');
    vi.stubGlobal('BOTTOM', 'BOTTOM');
    vi.stubGlobal('LEFT', 'LEFT');
    vi.stubGlobal('BASELINE', 'BASELINE');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not use explicit any or deprecated asset lookups in scoped production files', () => {
    for (const source of scopedSources) {
      expect(source).not.toMatch(/\bany\b/);
      expect(source).not.toContain('AssetManager.getAsset(');
    }
    expect(stripComments(aiChampionSource)).not.toContain('charge!');
  });

  it('constructs champion presets with generated avatar handles and owned spells', () => {
    const game = createGame();
    class TestSpell extends Spell {}
    const champion = new Champion({
      game,
      avatar: AssetManager.get('buff_stun'),
      preset: { name: 'Ahri', spells: [TestSpell] },
    });

    expect(champion.avatar).toBe(AssetManager.get('buff_stun'));
    expect(champion.name).toBe('Ahri');
    expect(champion.spells[0]).toBeInstanceOf(TestSpell);
    expectTypeOf(champion.spells).toEqualTypeOf<Spell[]>();
  });

  it('keeps champion score attribution and direct-subclass targets concrete', () => {
    const game = createGame();
    const attacker = new Champion({ game });
    const target = new Champion({ game });
    target.die({ attacker, reviveAfter: 10 });

    const monster = new Monster({ game });
    const turret = new Turret({ game, position: createVector() });
    monster.aggroOn(target);
    turret.fireAt(target);

    expect(target.score).toBe(-1);
    expect(attacker.score).toBe(1);
    expect(monster.targetLock).toBe(target);
    expect(turret.target).toBeNull();
    expect(game.objectManager._objectToBeAdd[0]).toBeInstanceOf(TurretBolt);
    // A camp fights back against whatever hits it — a champion, a pet, a minion.
    expectTypeOf(monster.targetLock).toEqualTypeOf<AttackableUnit | null>();
    // a turret is a team building now: it shoots minions as well as champions
    expectTypeOf(turret.target).toEqualTypeOf<AttackableUnit | null>();
  });

  it('selects the nearest valid champion and resets monster and turret targets after loss', () => {
    const game = createGame();
    const player = new Champion({ game, teamId: 'blue' });
    game.setPlayer(player);
    const monster = new Monster({
      game,
      preset: {
        name: 'Test Monster',
        avatar: TEST_AVATAR_KEY,
        camp: { x: 0, y: 0, r: 100 },
        speed: 0,
        size: 100,
        attackRange: 100,
        reviveTime: 100,
        health: 100,
      },
    });
    const turret = new Turret({ game, position: createVector() });
    const nearest = new Champion({ game, teamId: 'red', position: createVector(20, 0) });
    const farther = new Champion({ game, teamId: 'red', position: createVector(60, 0) });
    indexObjects(game, [monster, turret, nearest, farther]);

    expect(turret.findTarget()).toBe(nearest);
    monster.aggroOn(nearest);
    turret.target = nearest;
    nearest.die({ reviveAfter: 100 });

    monster.updateAttack();
    turret.update();

    expect(monster.targetLock).toBeNull();
    expect(monster.phase).toBe(Monster.PHASES.BACK_TO_CAMP);
    expect(turret.target).toBe(farther);
  });

  it('keeps turret bolt identity, homes while its target lives, and attributes arrival damage to the turret', () => {
    const game = createGame();
    const player = new Champion({ game, teamId: 'blue' });
    game.setPlayer(player);
    const turret = new Turret({ game, position: createVector() });
    const target = new Champion({ game, teamId: 'red', position: createVector(20, 0) });
    turret.fireAt(target);
    const object = game.objectManager._objectToBeAdd[0];
    if (!(object instanceof TurretBolt)) throw new Error('Turret fire must create a turret bolt.');
    const bolt = object;

    expect(bolt.target).toBe(target);
    expect(bolt.owner).toBe(turret);
    bolt.onBeforeMove();
    expect(bolt.destination).toMatchObject({ x: 20, y: 0 });

    target.stats.health.baseValue = 10;
    bolt.onArrive();
    expect(target.deathData?.attacker).toBe(turret);

    target.position.set(40, 0);
    bolt.onBeforeMove();
    expect(bolt.destination).toMatchObject({ x: 20, y: 0 });
  });

  it('draws one champion buff icon per stack identity and labels its stack count', () => {
    const game = createGame();
    const champion = new Champion({ game });
    game.setPlayer(champion);
    const first = new Buff(100, champion, champion);
    const second = new Buff(100, champion, champion);
    first.image = AssetManager.get('buff_stun');
    second.image = AssetManager.get('buff_stun');
    first.stackId = 'test-stack';
    second.stackId = 'test-stack';
    champion.buffs = [first, second];

    champion.drawHealthBar();

    expect(image).toHaveBeenCalledTimes(1);
    expect(text).toHaveBeenCalledWith(2, expect.any(Number), expect.any(Number));
  });

  const shieldedChampion = (
    game: ReturnType<typeof createGame>,
    health: number,
    shieldAmount: number,
    maxHealth = 100
  ) => {
    const champion = new Champion({ game, position: createVector(100, 100) });
    game.setPlayer(champion);
    champion.stats.health.baseValue = health;
    champion.stats.maxHealth.baseValue = maxHealth;
    champion.stats.mana.baseValue = 100;
    champion.stats.maxMana.baseValue = 100;
    const shield = new Shield(1_000, champion, champion);
    shield.amount = shieldAmount;
    champion.buffs = [shield];
    return champion;
  };

  it('draws the shield next to health when there is room for it', () => {
    const champion = shieldedChampion(createGame(), 50, 25);

    champion.drawHealthBar();

    const [, health, shieldSegment] = vi.mocked(rect).mock.calls;
    expect(shieldSegment[0]).toBe(health[0] + health[2]);
    expect(fill).toHaveBeenCalledWith(225, 230, 238, expect.any(Number));
  });

  it('keeps the frame fixed and the shield inside it however big the shield is', () => {
    const champion = shieldedChampion(createGame(), 100, 500);

    champion.drawHealthBar();

    const rectCalls = vi.mocked(rect).mock.calls;
    const frame = rectCalls[0];
    const shieldSegment = rectCalls[2];
    // 125 frame + 3 border, i.e. exactly what an unshielded champion draws
    expect(frame[2]).toBe(128);
    expect(shieldSegment[2]).toBe(108);
    expect(shieldSegment[0] + shieldSegment[2]).toBeLessThanOrEqual(frame[0] + frame[2]);
    // mana keeps its own full-width track rather than following the shield
    expect(rectCalls.at(-1)?.[2]).toBe(108);
  });

  it('ticks the bar by health so two champions can be compared at a glance', () => {
    const small = shieldedChampion(createGame(), 100, 0, 100);
    small.drawHealthBar();
    const smallTicks = vi.mocked(line).mock.calls.length;

    vi.mocked(line).mockClear();
    const big = shieldedChampion(createGame(), 300, 0, 300);
    big.drawHealthBar();

    expect(smallTicks).toBe(1);
    expect(vi.mocked(line).mock.calls.length).toBe(5);
  });

  it('draws spell overlays after the champion body and health UI', () => {
    const game = createGame();
    const champion = new Champion({ game });
    const order: string[] = [];
    const drawUnit = vi.spyOn(AttackableUnit.prototype, 'draw').mockImplementation(() => {
      order.push('unit');
    });
    class OverlaySpell extends Spell {
      drawVfx(): void {
        order.push('vfx');
      }
    }
    champion.spells = [new OverlaySpell(champion)];

    champion.draw();

    expect(order).toEqual(['unit', 'vfx']);
    drawUnit.mockRestore();
  });

  it('requires a charge configuration for hold activations', () => {
    const holdSpec: ChargeCastSpec = {
      activation: 'HOLD_RELEASE',
      targeting: 'DIRECTION',
      charge: { maxDurationMs: 100, releaseAtMax: false },
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'end', durationMs: 0 },
    };
    const malformedHoldSpec: ChargeCastSpec = {
      ...holdSpec,
      charge: undefined,
    };

    expectTypeOf(requireChargeSpec(holdSpec)).toEqualTypeOf<ChargeSpec>();
    expect(() => requireChargeSpec(malformedHoldSpec)).toThrow(
      'HOLD_RELEASE activation requires charge'
    );
  });

  it('keeps dummy construction and AI respawn preset replacement compatible with typed options', () => {
    const game = createGame();
    const dummy = new DummyChampion({ game, position: createVector() });
    const ai = new AIChampion({ game, preset: { spells: [] } });

    expect(dummy.name).toBe('Hình Nộm');
    expect(ai.spells).toEqual([]);
  });
});

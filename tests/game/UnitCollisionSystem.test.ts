import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_AVATAR_KEY } from './fixtures';
import { Rectangle } from '../../src/libs/quadtree';
import AttackableUnit from '../../src/game/gameObject/attackableUnits/AttackableUnit';
import Minion from '../../src/game/gameObject/attackableUnits/Minion';
import Monster from '../../src/game/gameObject/attackableUnits/Monster';
import Turret from '../../src/game/gameObject/structures/Turret';
import TeamId from '../../src/game/enums/TeamId';
import { Lane } from '../../src/game/lanes';
import ObjectManager from '../../src/game/managers/ObjectManager';
import UnitCollisionSystem from '../../src/game/managers/UnitCollisionSystem';
import type { GameObjectRuntimeContext } from '../../src/game/gameObject/GameObject';
import EventManager from '../../src/managers/EventManager';
import ActionState from '../../src/game/enums/ActionState';
import type { MonsterPresetData } from '../../src/game/gameObject/attackableUnits/Monster';

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
  dist(vector: TestVector) {
    return Math.hypot(this.x - vector.x, this.y - vector.y);
  }
  static dist(a: TestVector, b: TestVector) {
    return a.dist(b);
  }
}

type TestGame = GameObjectRuntimeContext & { setPlayer(player: AttackableUnit): void };

function createGame(): TestGame {
  const camera = { getBoundingBox: () => new Rectangle({ x: 0, y: 0, w: 0, h: 0 }) };
  const objectManager = new ObjectManager({ mapSize: 2000, camera });
  let player: AttackableUnit | undefined;

  return {
    mapSize: 2000,
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

function makeUnit(game: GameObjectRuntimeContext, x: number, y: number, size = 60): AttackableUnit {
  const unit = new AttackableUnit({ game, position: createVector(x, y) });
  unit.stats.size.baseValue = size;
  return unit;
}

function distanceBetween(a: AttackableUnit, b: AttackableUnit): number {
  return Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
}

function overlapOf(a: AttackableUnit, b: AttackableUnit): number {
  return a.bodyRadius + b.bodyRadius - distanceBetween(a, b);
}

/** Run the pass on a fixed set of bodies for `frames` frames. */
function settle(system: UnitCollisionSystem, units: AttackableUnit[], frames: number): void {
  for (let frame = 0; frame < frames; frame++) system.resolve(units);
}

describe('unit body separation', () => {
  beforeEach(() => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => new TestVector(x, y));
    vi.stubGlobal('p5', { Vector: TestVector });
    vi.stubGlobal('random', () => 0);
    vi.stubGlobal('deltaTime', 16);
    vi.stubGlobal(
      'lerp',
      (from: number, to: number, amount: number) => from + (to - from) * amount
    );
    vi.stubGlobal('constrain', (n: number, low: number, high: number) =>
      Math.min(high, Math.max(low, n))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('separates two overlapping units until their bodies no longer touch', () => {
    const game = createGame();
    const system = new UnitCollisionSystem();
    const left = makeUnit(game, 500, 500);
    const right = makeUnit(game, 520, 500);

    expect(overlapOf(left, right)).toBeGreaterThan(0);

    settle(system, [left, right], 40);

    expect(overlapOf(left, right)).toBeLessThanOrEqual(0.5);
    // symmetric: two equal movable bodies each take half of the correction
    expect(left.position.x).toBeCloseTo(1020 / 2 - distanceBetween(left, right) / 2, 5);
    expect(right.position.y).toBeCloseTo(500, 5);
  });

  it('splits perfectly stacked centres instead of leaving them inside each other', () => {
    const game = createGame();
    const system = new UnitCollisionSystem();
    const first = makeUnit(game, 300, 300);
    const second = makeUnit(game, 300, 300);

    settle(system, [first, second], 60);

    expect(overlapOf(first, second)).toBeLessThanOrEqual(0.5);
  });

  it('gives a turret nothing and the unit beside it the whole correction', () => {
    const game = createGame();
    const system = new UnitCollisionSystem();
    const turret = new Turret({ game, position: createVector(800, 800) });
    const walker = makeUnit(game, 830, 800);
    const turretStart = { x: turret.position.x, y: turret.position.y };

    expect(turret.isImmovable).toBe(true);

    settle(system, [turret, walker], 40);

    expect(turret.position.x).toBe(turretStart.x);
    expect(turret.position.y).toBe(turretStart.y);
    // the walker alone carries the separation, so it ends up clear of the body
    expect(distanceBetween(turret, walker)).toBeGreaterThanOrEqual(
      turret.bodyRadius + walker.bodyRadius - 0.5
    );
    expect(walker.position.x).toBeGreaterThan(830);
  });

  it('treats a camp with no speed as immovable and a walking camp as movable', () => {
    const game = createGame();
    const system = new UnitCollisionSystem();
    const rooted: MonsterPresetData = {
      name: 'Baron',
      avatar: TEST_AVATAR_KEY,
      camp: { x: 1000, y: 1000, r: 100 },
      speed: 0,
      size: 100,
      attackRange: 400,
      reviveTime: 3000,
      health: 1000,
    };
    const walking: MonsterPresetData = { ...rooted, camp: { x: 1040, y: 1000, r: 100 }, speed: 2 };

    const baron = new Monster({ game, preset: rooted });
    const wolf = new Monster({ game, preset: walking });

    expect(baron.isImmovable).toBe(true);
    expect(wolf.isImmovable).toBe(false);

    settle(system, [baron, wolf], 40);

    expect(baron.position.x).toBe(1000);
    expect(wolf.position.x).toBeGreaterThan(1040);
  });

  it('leaves a displaced unit alone for the frames after it was displaced', () => {
    const game = createGame();
    const system = new UnitCollisionSystem();
    const hooked = makeUnit(game, 400, 400);
    const bystander = makeUnit(game, 410, 400);

    hooked.markDisplaced();
    expect(hooked.collidesWithUnits).toBe(false);

    system.resolve([hooked, bystander]);
    // the displacement wins outright: the hooked unit does not budge, and with
    // it out of the pass nothing pushes the bystander either
    expect(hooked.position.x).toBe(400);
    expect(bystander.position.x).toBe(410);

    // the grace runs out over the next two updates and normal separation resumes
    hooked.update();
    hooked.update();
    expect(hooked.collidesWithUnits).toBe(true);
    system.resolve([hooked, bystander]);
    expect(hooked.position.x).toBeLessThan(400);
  });

  it('leaves a ghosted unit alone for the whole displacement', () => {
    const game = createGame();
    const system = new UnitCollisionSystem();
    const dashing = makeUnit(game, 600, 600);
    const bystander = makeUnit(game, 615, 600);
    dashing.stats.setActionState(ActionState.IS_GHOSTED, true);

    expect(dashing.collidesWithUnits).toBe(false);

    settle(system, [dashing, bystander], 10);

    expect(dashing.position.x).toBe(600);
    expect(bystander.position.x).toBe(615);
  });

  it('skips dead units', () => {
    const game = createGame();
    const system = new UnitCollisionSystem();
    const corpse = makeUnit(game, 200, 200);
    const walker = makeUnit(game, 210, 200);
    corpse.die({ reviveAfter: 5000 });

    settle(system, [corpse, walker], 10);

    expect(corpse.position.x).toBe(200);
    expect(walker.position.x).toBe(210);
  });

  it('skips objects that are not attackable units', () => {
    const game = createGame();
    const system = new UnitCollisionSystem();
    const walker = makeUnit(game, 100, 100);
    const floor = { position: createVector(100, 100) } as unknown as AttackableUnit;

    settle(system, [walker, floor], 10);

    expect(walker.position.x).toBe(100);
    expect(system.bodyCount).toBe(1);
  });

  it('settles a unit crowded from every side instead of letting it oscillate', () => {
    const game = createGame();
    const system = new UnitCollisionSystem();
    const centre = makeUnit(game, 1000, 1000);
    const crowd: AttackableUnit[] = [centre];
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      crowd.push(makeUnit(game, 1000 + Math.cos(angle) * 18, 1000 + Math.sin(angle) * 18));
    }

    const steps: number[] = [];
    for (let frame = 0; frame < 120; frame++) {
      const before = crowd.map(unit => ({ x: unit.position.x, y: unit.position.y }));
      system.resolve(crowd);
      let step = 0;
      for (let i = 0; i < crowd.length; i++) {
        step = Math.max(
          step,
          Math.hypot(crowd[i].position.x - before[i].x, crowd[i].position.y - before[i].y)
        );
      }
      steps.push(step);
    }

    // The first frames rearrange the pile, then the corrections shrink every
    // single frame until the crowd stops dead. A pass that ping-ponged would
    // show a floor it never gets under, or a step that keeps growing back.
    for (let frame = 12; frame < steps.length; frame++) {
      expect(steps[frame]).toBeLessThanOrEqual(steps[frame - 1] + 1e-9);
    }
    expect(steps[steps.length - 1]).toBe(0);

    // and it stays settled — no residual vibration once the overlaps are gone
    const settled = crowd.map(unit => ({ x: unit.position.x, y: unit.position.y }));
    settle(system, crowd, 30);
    for (let i = 0; i < crowd.length; i++) {
      expect(crowd[i].position.x).toBe(settled[i].x);
      expect(crowd[i].position.y).toBe(settled[i].y);
    }

    for (let i = 0; i < crowd.length; i++) {
      for (let j = i + 1; j < crowd.length; j++) {
        expect(overlapOf(crowd[i], crowd[j])).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it('caps how far one frame may move a body', () => {
    const game = createGame();
    const system = new UnitCollisionSystem();
    // a 400px body barely off-centre inside another produces a huge overlap
    const first = makeUnit(game, 500, 500, 800);
    const second = makeUnit(game, 505, 500, 800);

    system.resolve([first, second]);

    expect(500 - first.position.x).toBeLessThanOrEqual(12.0001);
    expect(second.position.x - 505).toBeLessThanOrEqual(12.0001);
  });

  it('finds pairs that straddle a grid cell boundary', () => {
    const game = createGame();
    const system = new UnitCollisionSystem();
    // cell size is 2 * the largest radius (60 here), so 120px cells; these two
    // sit either side of the x = 600 boundary
    const left = makeUnit(game, 598, 600, 120);
    const right = makeUnit(game, 640, 600, 120);

    settle(system, [left, right], 60);

    expect(overlapOf(left, right)).toBeLessThanOrEqual(0.5);
  });

  it('runs from ObjectManager.update() and can be switched off', () => {
    const game = createGame();
    const manager = game.objectManager;
    const left = makeUnit(game, 700, 700);
    const right = makeUnit(game, 715, 700);
    game.setPlayer(left);
    manager.objects = [left, right];

    manager.unitCollision.enabled = false;
    manager.update();
    expect(left.position.x).toBe(700);

    manager.unitCollision.enabled = true;
    manager.update();
    expect(left.position.x).toBeLessThan(700);
    expect(right.position.x).toBeGreaterThan(715);
  });

  // The separation pass was written against a tree that had no Minion class, so
  // nothing in it names one. Minions get solid bodies by inheriting the defaults
  // — which is the point of putting them on AttackableUnit, and worth pinning
  // down, because a wave is where bodies piling up is most visible.
  it('gives lane minions solid bodies without naming them', () => {
    const game = createGame();
    const wave = [Lane.TOP, Lane.MID].map(
      (lane, index) =>
        new Minion({
          game,
          teamId: TeamId.BLUE,
          lane,
          waypoints: [
            { x: 0, y: 0 },
            { x: 400, y: 0 },
          ],
          position: createVector(600 + index * 8, 600),
        } as ConstructorParameters<typeof Minion>[0])
    );

    for (const minion of wave) {
      expect(minion.collidesWithUnits).toBe(true);
      expect(minion.bodyRadius).toBeGreaterThan(0);
      expect(minion.isImmovable).toBe(false);
    }

    const gap = () => Math.abs(wave[0].position.x - wave[1].position.x);
    const before = gap();
    new UnitCollisionSystem().resolve(wave);

    expect(gap()).toBeGreaterThan(before);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Game from '../../../src/game/Game';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import Minion from '../../../src/game/gameObject/attackableUnits/Minion';
import CombatText from '../../../src/game/gameObject/helpers/CombatText';
import ParticleSystem from '../../../src/game/gameObject/helpers/ParticleSystem';
import TrailSystem from '../../../src/game/gameObject/helpers/TrailSystem';
import GameObject from '../../../src/game/gameObject/GameObject';
import ObjectManager from '../../../src/game/managers/ObjectManager';
import { Rectangle } from '../../../src/libs/quadtree';
import { createGame, indexObjects, stubGameGlobals } from '../fixtures';

const camera = {
  getBoundingBox: () => new Rectangle({ x: 0, y: 0, w: 100, h: 100 }),
  constantSize: (pixels: number) => pixels,
  currentScale: 1,
};

const drawParticles = (touchUi: boolean, renderQuality?: string): number => {
  let drawn = 0;
  const manager = new ObjectManager({ mapSize: 1_000, camera, touchUi, renderQuality } as any);
  manager.objects = Array.from({ length: 2 }, () => {
    const system = new ParticleSystem({
      isDeadFn: () => false,
      drawFn: () => drawn++,
      getParticlePosFn: particle => particle,
      getParticleSizeFn: () => 4,
    });
    system.particles = Array.from({ length: 1_000 }, () => ({ x: 50, y: 50 }));
    return system;
  });
  for (const object of manager.objects) {
    manager._objectsTree.insert(object.getDisplayBoundingBox());
  }

  manager.draw();
  return drawn;
};

beforeEach(() => stubGameGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('the decoration index', () => {
  /**
   * Particles and trails are `GameObject`s so the loop carries them, but no
   * gameplay question is ever about them. Indexed with everything else they
   * were still retrieved, stamped and intersect-tested by every one of the
   * ~150 `queryObjects` call sites, to be discarded by each caller's own type
   * filter — worst exactly when a fight has the most of them.
   *
   * Both halves matter and they pull against each other: skipping them in
   * queries is the point, and painting them anyway is what stops that being a
   * regression. A split that dropped them from the draw pass would make the
   * game faster by deleting its effects.
   */
  it('keeps decoration out of gameplay queries while still painting it', () => {
    const manager = new ObjectManager({ mapSize: 1_000, camera } as never);
    const solid = new GameObject({ visionRadius: 20 });
    solid.position.set(50, 50);

    let particlesPainted = 0;
    const decoration = new ParticleSystem({
      isDeadFn: () => false,
      drawFn: () => particlesPainted++,
      getParticlePosFn: particle => particle,
      getParticleSizeFn: () => 4,
    });
    decoration.particles = [{ x: 50, y: 50 }];

    manager.addObject(solid);
    manager.addObject(decoration);
    manager.update();

    const hits = manager.queryObjects({
      area: new Rectangle({ x: 0, y: 0, w: 100, h: 100 }),
      queryByDisplayBoundingBox: true,
    });
    expect(hits).toContain(solid);
    expect(hits).not.toContain(decoration);

    manager.draw();
    expect(particlesPainted).toBeGreaterThan(0);
  });

  /**
   * `CombatText` fits the same criterion as particles and trails — it deals no
   * damage, holds no target and blocks nothing — and a teamfight is exactly
   * when `_objectsTree` is biggest and busiest. See the doc comment on
   * `isDecoration` for why it used to be kept out (a worry that turned out not
   * to match any actual query) and `tests/e2e/measure-combattext-perf.mjs` for
   * the measured cost.
   */
  it('routes CombatText into the decoration tree, not the gameplay one', () => {
    const manager = new ObjectManager({ mapSize: 1_000, camera } as never);
    const host = { mapSize: 1_000, camera, objectManager: manager } as any;
    const owner = new AttackableUnit({ game: host, position: createVector(50, 50) });
    const combatText = new CombatText(owner);

    manager.addObject(combatText);
    manager.update();

    const countNode = (node: any): number =>
      node.objects.length +
      node.nodes.reduce((sum: number, child: any) => sum + countNode(child), 0);
    expect(countNode(manager._decorTree)).toBe(1);
    expect(countNode(manager._objectsTree)).toBe(0);

    const hits = manager.queryObjects({
      area: new Rectangle({ x: 0, y: 0, w: 100, h: 100 }),
      queryByDisplayBoundingBox: true,
    });
    expect(hits).not.toContain(combatText);
  });
});

describe('ObjectManager mobile rendering', () => {
  it('keeps the mobile render budget in sync with the live touch toggle', () => {
    const game = {
      touchUi: false,
      touchControls: {
        enabled: false,
        setEnabled(enabled: boolean) {
          this.enabled = enabled;
        },
      },
      applyTouchUiClass: vi.fn(),
    };

    Game.prototype.setTouchControlsEnabled.call(game as unknown as Game, true, false);

    expect(game.touchUi).toBe(true);
  });

  it('shares one 800-particle draw budget across visible systems', () => {
    expect(drawParticles(true)).toBe(800);
  });

  it('keeps pointer rendering unlimited', () => {
    expect(drawParticles(false)).toBe(2_000);
  });

  it('lets low quality force the smaller particle budget', () => {
    expect(drawParticles(true, 'low')).toBe(400);
  });

  it('lets high quality disable the mobile particle cap', () => {
    expect(drawParticles(true, 'high')).toBe(2_000);
  });

  it('halves the particle budget in a crowded zoomed-out mobile fight', () => {
    let drawn = 0;
    const mobileCamera = { ...camera, currentScale: 0.3 };
    const host = { mapSize: 1_000, camera: mobileCamera, touchUi: true } as any;
    const manager = new ObjectManager(host);
    host.objectManager = manager;
    const units = Array.from({ length: 8 }, (_, index) => {
      const unit = new AttackableUnit({ game: host, position: createVector(20 + index * 8, 50) });
      unit.draw = vi.fn();
      return unit;
    });
    host.player = units[0];
    const particles = Array.from({ length: 2 }, () => {
      const system = new ParticleSystem({
        isDeadFn: () => false,
        drawFn: () => drawn++,
        getParticlePosFn: particle => particle,
        getParticleSizeFn: () => 4,
      });
      system.particles = Array.from({ length: 1_000 }, () => ({ x: 50, y: 50 }));
      return system;
    });
    const effects = Array.from(
      { length: 31 },
      () => new GameObject({ position: createVector(50, 50) })
    );
    manager.objects = [...units, ...particles, ...effects];
    for (const object of manager.objects) {
      manager._objectsTree.insert(object.getDisplayBoundingBox());
    }

    manager.draw();

    expect(drawn).toBe(400);
  });

  it('does not draw an allied body whose vision box alone intersects the camera', () => {
    const game = createGame();
    Object.assign(game.camera, camera);
    const unit = new AttackableUnit({
      game,
      position: createVector(1_050, 50),
      visionRadius: 1_000,
    });
    game.setPlayer(unit);
    unit.draw = vi.fn();
    indexObjects(game, [unit]);

    game.objectManager.draw();

    expect(unit.draw).not.toHaveBeenCalled();
  });

  it('requests compact unit rendering when a zoomed-out mobile view is crowded', () => {
    const mobileCamera = { ...camera, currentScale: 0.3 };
    const host = { mapSize: 1_000, camera: mobileCamera, touchUi: true } as any;
    const manager = new ObjectManager(host);
    host.objectManager = manager;
    const units = Array.from({ length: 8 }, (_, index) => {
      const unit = new AttackableUnit({
        game: host,
        position: createVector(20 + index * 8, 50),
      });
      unit.draw = vi.fn();
      return unit;
    });
    host.player = units[0];
    manager.objects = units;
    for (const unit of units) manager._objectsTree.insert(unit.getDisplayBoundingBox());

    manager.draw();

    expect(units[0].draw).toHaveBeenCalledWith({ compactUnits: true });
  });

  it('lets low quality force compact rendering without a crowd', () => {
    const host = { mapSize: 1_000, camera, touchUi: true, renderQuality: 'low' } as any;
    const manager = new ObjectManager(host);
    host.objectManager = manager;
    const unit = new AttackableUnit({ game: host, position: createVector(50, 50) });
    unit.draw = vi.fn();
    host.player = unit;
    manager.objects = [unit];
    manager._objectsTree.insert(unit.getDisplayBoundingBox());

    manager.draw();

    expect(unit.draw).toHaveBeenCalledWith({ compactUnits: true });
  });

  it('lets high quality disable automatic compact rendering', () => {
    const mobileCamera = { ...camera, currentScale: 0.3 };
    const host = {
      mapSize: 1_000,
      camera: mobileCamera,
      touchUi: true,
      renderQuality: 'high',
    } as any;
    const manager = new ObjectManager(host);
    host.objectManager = manager;
    const units = Array.from({ length: 8 }, (_, index) => {
      const unit = new AttackableUnit({ game: host, position: createVector(20 + index * 8, 50) });
      unit.draw = vi.fn();
      return unit;
    });
    host.player = units[0];
    manager.objects = units;
    for (const unit of units) manager._objectsTree.insert(unit.getDisplayBoundingBox());

    manager.draw();

    expect(units[0].draw).toHaveBeenCalledWith({ compactUnits: false });
  });

  it('keeps state-changing buff VFX but skips cosmetic buff VFX in compact mode', () => {
    const host = { mapSize: 1_000, camera, touchUi: true } as any;
    const unit = new AttackableUnit({ game: host });
    const cosmeticDraw = vi.fn();
    const crowdControlDraw = vi.fn();
    unit.buffs = [
      { statusFlagsToEnable: 0, statusFlagsToDisable: 0, draw: cosmeticDraw },
      { statusFlagsToEnable: 1, statusFlagsToDisable: 0, draw: crowdControlDraw },
    ] as any;

    unit.drawBuffs(true);

    expect(cosmeticDraw).not.toHaveBeenCalled();
    expect(crowdControlDraw).toHaveBeenCalledOnce();
  });

  it('applies compact buff VFX rendering to minions too', () => {
    const host = { mapSize: 1_000, camera, touchUi: true } as any;
    const minion = new Minion({
      game: host,
      teamId: 'blue',
      waypoints: [{ x: 0, y: 0 }],
    });
    const cosmeticDraw = vi.fn();
    minion.buffs = [{ statusFlagsToEnable: 0, statusFlagsToDisable: 0, draw: cosmeticDraw }] as any;

    minion.draw({ compactUnits: true } as any);

    expect(cosmeticDraw).not.toHaveBeenCalled();
  });

  it('reduces crowded mobile trails to one line segment', () => {
    const draw = stubGameGlobals();
    const mobileCamera = { ...camera, currentScale: 0.3 };
    const host = { mapSize: 1_000, camera: mobileCamera, touchUi: true } as any;
    const manager = new ObjectManager(host);
    host.objectManager = manager;
    const units = Array.from({ length: 8 }, (_, index) => {
      const unit = new AttackableUnit({ game: host, position: createVector(20 + index * 8, 50) });
      unit.draw = vi.fn();
      return unit;
    });
    host.player = units[0];
    const trail = new TrailSystem();
    trail.trails = [
      { pos: createVector(20, 20), lifeSpan: 100 },
      { pos: createVector(30, 30), lifeSpan: 100 },
      { pos: createVector(40, 40), lifeSpan: 100 },
    ];
    manager.objects = [...units, trail];
    for (const object of manager.objects) {
      manager._objectsTree.insert(object.getDisplayBoundingBox());
    }

    manager.draw();

    expect(draw.line).toHaveBeenCalledWith(20, 20, 40, 40);
    expect(draw.beginShape).not.toHaveBeenCalled();
  });
});

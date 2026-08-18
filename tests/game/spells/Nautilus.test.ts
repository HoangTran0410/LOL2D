import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));

import { Rectangle } from '../../../src/libs/quadtree';
import SpellObject from '../../../src/game/gameObject/SpellObject';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import Dash from '../../../src/game/gameObject/buffs/Dash';
import Stun from '../../../src/game/gameObject/buffs/Stun';
import { slabVertices } from '../../../src/game/gameObject/map/DynamicTerrain';
import Nautilus_Q, {
  Nautilus_Q_Object,
  Q_DAMAGE,
  Q_RANGE,
} from '../../../src/game/gameObject/spells/Nautilus_Q';
import Nautilus_E, {
  E_RADII,
  E_WAVE_DAMAGE,
  Nautilus_E_Object,
} from '../../../src/game/gameObject/spells/Nautilus_E';
import Nautilus_R, {
  Nautilus_R_Eruption,
  Nautilus_R_Object,
  R_DAMAGE,
  R_PASS_DAMAGE,
} from '../../../src/game/gameObject/spells/Nautilus_R';
import {
  createGame,
  createUnit,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  type TestGame,
} from '../spell/fixtures';

/** A spell-built slab: real, impassable terrain that `terrainMap` knows nothing about. */
class TestSlab extends SpellObject {
  blocksMovement = true;

  wallVertices(): { x: number; y: number }[] {
    return slabVertices(this.position, 0, 160, 40);
  }

  update(): void {}

  getDisplayBoundingBox(): Rectangle {
    return new Rectangle({
      x: this.position.x - 80,
      y: this.position.y - 20,
      w: 160,
      h: 40,
      data: this,
    });
  }
}

describe('Nautilus spells', () => {
  let game: TestGame;
  let owner: AttackableUnit;

  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
    game = createGame();
    owner = unit(0, 'blue');
    game.setPlayer(owner);
    (game as any).worldMouse = createVector(Q_RANGE, 0);
  });

  afterEach(() => vi.unstubAllGlobals());

  function unit(x: number, teamId: string): AttackableUnit {
    const result = createUnit(game, x, teamId);
    result.collisionRadius = 1;
    result.stats.speed.baseValue = 10;
    result.stats.mana.baseValue = 100;
    result.stats.health.baseValue = 100;
    result.stats.maxHealth.baseValue = 100;
    result.animatedValues.displaySize = 20;
    game.objectManager.addObject(result);
    return result;
  }

  /** A hand-built cast context: createGame's createSpellContext returns undefined. */
  function context(dx: number, dy: number, target?: AttackableUnit) {
    return {
      spellId: 'test',
      activationId: 'test',
      startedAtMs: 0,
      caster: owner,
      origin: { x: owner.position.x, y: owner.position.y },
      cursorWorld: { x: owner.position.x + dx, y: owner.position.y + dy },
      direction: { x: Math.sign(dx), y: Math.sign(dy) },
      target,
    } as any;
  }

  function findFirst<T>(Type: { new (...args: any[]): T }): T | undefined {
    const manager = game.objectManager as unknown as {
      objects: unknown[];
      _objectToBeAdd: unknown[];
    };
    for (const object of [...manager.objects, ...manager._objectToBeAdd]) {
      if (object instanceof Type) return object;
    }
    return undefined;
  }

  function drive(object: { update(): void; toRemove: boolean }, frames: number): void {
    for (let i = 0; i < frames && !object.toRemove; i++) object.update();
  }

  function throwAnchor(): Nautilus_Q_Object {
    new Nautilus_Q(owner).onSpellCast(context(Q_RANGE, 0));
    const hook = findFirst(Nautilus_Q_Object);
    if (!hook) throw new Error('Nautilus Q spawned no anchor');
    drive(hook, 60);
    const haul = owner.buffs.find(buff => buff instanceof Dash) as Dash | undefined;
    if (haul) drive(haul, 80);
    return hook;
  }

  it('Q hooks an enemy: damage, stun, and Nautilus hauled in beside it', () => {
    const victim = unit(200, 'red');
    game.objectManager.update();

    throwAnchor();

    expect(victim.stats.health.value).toBe(100 - Q_DAMAGE);
    expect(victim.buffs.some(buff => buff instanceof Stun)).toBe(true);
    expect(owner.position.x).toBeGreaterThan(50);
  });

  it('Q catches on a map wall: Nautilus is hauled to it and nobody is damaged', () => {
    const bystander = unit(300, 'red');
    (game as any).terrainMap = {
      getObstaclesInArea: () => [
        {
          vertices: [
            { x: 120, y: -120 },
            { x: 180, y: -120 },
            { x: 180, y: 120 },
            { x: 120, y: 120 },
          ],
        },
      ],
    };
    game.objectManager.update();

    const hook = throwAnchor();

    expect(hook.hitTargets.length).toBe(0);
    expect(bystander.stats.health.value).toBe(100);
    expect(owner.position.x).toBeGreaterThan(50);
  });

  it('Q catches on a spell-built slab, not only on the map', () => {
    const slab = new TestSlab(owner);
    slab.position = createVector(250, 0);
    game.objectManager.addObject(slab);
    game.objectManager.update();

    const hook = throwAnchor();

    expect(hook.hitTargets.length).toBe(0);
    expect(owner.position.x).toBeGreaterThan(90);
  });

  it('E fires three independent waves: standing still costs three hits, walking in costs one', () => {
    const inside = unit(80, 'red');
    const outer = unit(250, 'red');
    game.objectManager.update();

    new Nautilus_E(owner).onSpellCast();
    const tide = findFirst(Nautilus_E_Object);
    if (!tide) throw new Error('Nautilus E spawned no tide');
    drive(tide, 120);

    expect(inside.stats.health.value).toBe(100 - 3 * E_WAVE_DAMAGE);
    expect(outer.stats.health.value).toBe(100 - E_WAVE_DAMAGE);
    expect(outer.position.x).toBeGreaterThan(E_RADII[1]);
  });

  it('no single E wave damages the same unit twice', () => {
    const victim = unit(80, 'red');
    game.objectManager.update();

    new Nautilus_E(owner).onSpellCast();
    const tide = findFirst(Nautilus_E_Object);
    if (!tide) throw new Error('Nautilus E spawned no tide');
    tide.fireWave(tide.waves[0]);
    tide.fireWave(tide.waves[0]);

    expect(victim.stats.health.value).toBe(100 - E_WAVE_DAMAGE);
  });

  it('R passes each bystander once and finishes its target for the full blast', () => {
    const bystander = unit(60, 'red');
    const target = unit(300, 'red');
    game.objectManager.update();

    new Nautilus_R(owner).onSpellCast(context(300, 0, target));
    const charge = findFirst(Nautilus_R_Object);
    if (!charge) throw new Error('Nautilus R spawned no charge');
    drive(charge, 200);

    expect(bystander.stats.health.value).toBe(100 - R_PASS_DAMAGE);
    expect(target.stats.health.value).toBe(100 - R_DAMAGE);
  });

  it('R erupts where it is when its target dies mid-flight', () => {
    const target = unit(300, 'red');
    game.objectManager.update();

    new Nautilus_R(owner).onSpellCast(context(300, 0, target));
    const charge = findFirst(Nautilus_R_Object);
    if (!charge) throw new Error('Nautilus R spawned no charge');
    for (let i = 0; i < 20; i++) charge.update();
    const stalled = charge.position.x;

    target.takeDamage(1000, owner);
    charge.update();

    const eruption = findFirst(Nautilus_R_Eruption);
    expect(charge.toRemove).toBe(true);
    expect(eruption).toBeDefined();
    expect(Math.abs((eruption as Nautilus_R_Eruption).position.x - stalled)).toBeLessThan(1);
    expect(stalled).toBeLessThan(200);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));

import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import Syndra_E, {
  SYNDRA_E_DAMAGE,
  Syndra_E_Sphere,
} from '../../../src/game/gameObject/spells/Syndra_E';
import Syndra_Q, {
  MAX_SPHERES,
  SPHERE_GRAB_RADIUS,
  SPHERE_LIFETIME_MS,
  SYNDRA_Q_DAMAGE,
  SYNDRA_Q_FALL_MS,
  Syndra_Sphere,
  groundedSpheres,
} from '../../../src/game/gameObject/spells/Syndra_Q';
import Syndra_R, {
  SYNDRA_R_BASE,
  SYNDRA_R_CONVERGE_MS,
  SYNDRA_R_MAX,
  SYNDRA_R_PER_SPHERE,
} from '../../../src/game/gameObject/spells/Syndra_R';
import Syndra_W, { SYNDRA_W_DAMAGE } from '../../../src/game/gameObject/spells/Syndra_W';
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
  result.stats.health.baseValue = 100;
  result.stats.maxHealth.baseValue = 100;
  result.animatedValues.displaySize = 20;
  return result;
}

describe('Syndra — the sphere economy', () => {
  let game: TestGame;
  let owner: AttackableUnit;

  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
    vi.stubGlobal('deltaTime', 50);
    vi.stubGlobal('createVector', (x = 0, y = 0) => new (p5 as any).Vector(x, y));
    game = createGame();
    owner = unit(game, 0, 'blue');
    game.setPlayer(owner);
    (game as any).worldMouse = createVector(300, 0);
  });

  afterEach(() => vi.unstubAllGlobals());

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

  /** Drives real object updates: `ms` of game time in `step`-sized frames. */
  function advance(ms: number, step = 50): void {
    vi.stubGlobal('deltaTime', step);
    for (let elapsed = 0; elapsed < ms; elapsed += step) game.objectManager.update();
  }

  function sphere(x: number, y = 0): Syndra_Sphere {
    const made = new Syndra_Sphere(owner, createVector(x, y));
    game.objectManager.addObject(made);
    return made;
  }

  function enemy(x: number, y = 0): AttackableUnit {
    const made = unit(game, x, 'red');
    made.position.y = y;
    game.objectManager.addObject(made);
    return made;
  }

  function pending(): any[] {
    return (game.objectManager as any)._objectToBeAdd;
  }

  it('Q cannot skip its fall, then leaves exactly one grounded sphere where it landed', () => {
    const victim = enemy(330);
    game.objectManager.update();

    new Syndra_Q(owner).onSpellCast(context(300, 0));
    advance(SYNDRA_Q_FALL_MS - 150);
    expect(groundedSpheres(owner).length).toBe(0);
    expect(victim.tally.damageTaken).toBe(0);

    advance(300);
    const spheres = groundedSpheres(owner);
    expect(spheres.length).toBe(1);
    expect(spheres[0].position.x).toBeCloseTo(300, 0);
    expect(victim.tally.damageTaken).toBe(SYNDRA_Q_DAMAGE);
  });

  it('a sphere past MAX_SPHERES evicts her oldest one', () => {
    const oldest = sphere(0);
    for (let i = 1; i <= MAX_SPHERES; i++) sphere(60 * i);
    game.objectManager.update();

    expect(oldest.toRemove).toBe(true);
    const spheres = groundedSpheres(owner);
    expect(spheres.length).toBe(MAX_SPHERES);
    expect(spheres.indexOf(oldest)).toBe(-1);
  });

  it('a grounded sphere expires on its own lifetime', () => {
    sphere(120);
    advance(SPHERE_LIFETIME_MS - 500);
    expect(groundedSpheres(owner).length).toBe(1);

    advance(1000);
    expect(groundedSpheres(owner).length).toBe(0);
  });

  it('W is refused before it can be paid for when no sphere is in reach', () => {
    const w = new Syndra_W(owner);
    expect(w.checkCastCondition()).toBe(false);

    sphere(SPHERE_GRAB_RADIUS + 200);
    game.objectManager.update();
    expect(w.checkCastCondition()).toBe(false);

    w.onActivate(context(200, 0));
    expect(w.heldSphere).toBe(null);

    sphere(SPHERE_GRAB_RADIUS - 100);
    game.objectManager.update();
    expect(w.checkCastCondition()).toBe(true);
  });

  it('W moves the sphere to the impact point instead of consuming it', () => {
    const carried = sphere(100);
    const victim = enemy(400);
    game.objectManager.update();

    const w = new Syndra_W(owner);
    w.onActivate(context(400, 0));
    expect(carried.mode).toBe('held');
    expect(groundedSpheres(owner).length).toBe(0);

    w.onRecast(context(400, 0));
    advance(700);

    expect(victim.tally.damageTaken).toBe(SYNDRA_W_DAMAGE);
    expect(victim.buffs.length).toBeGreaterThan(0);
    const spheres = groundedSpheres(owner);
    expect(spheres.length).toBe(1);
    expect(spheres[0]).toBe(carried);
    expect(spheres[0].position.x).toBeCloseTo(400, 0);
  });

  it('W letting its window lapse drops the sphere at her feet, still hers', () => {
    const carried = sphere(200);
    game.objectManager.update();

    const w = new Syndra_W(owner);
    w.onActivate(context(300, 0));
    expect(carried.mode).toBe('held');

    owner.position.x = 40;
    w.onComplete(context(300, 0));

    expect(carried.mode).toBe('grounded');
    expect(carried.position.x).toBeCloseTo(40, 0);
    expect(groundedSpheres(owner).length).toBe(1);
  });

  it('E launches only the spheres standing inside its cone', () => {
    const inside = sphere(150);
    const outside = sphere(-150);
    const victim = enemy(100, 60);
    game.objectManager.update();

    new Syndra_E(owner).onSpellCast(context(300, 0));

    const flying = pending().filter(object => object instanceof Syndra_E_Sphere);
    expect(flying.length).toBe(1);
    expect(inside.toRemove).toBe(true);
    expect(outside.toRemove).toBe(false);
    expect(groundedSpheres(owner).length).toBe(1);
    expect(victim.tally.damageTaken).toBe(SYNDRA_E_DAMAGE);
  });

  /** Casts R at a fresh victim with `count` spheres on the floor; returns what landed. */
  function castRWith(count: number): number {
    const victim = enemy(300);
    for (let i = 0; i < count; i++) sphere(-80 * (i + 1));
    game.objectManager.update();

    new Syndra_R(owner).onSpellCast(context(300, 0, victim));
    advance(SYNDRA_R_CONVERGE_MS + 200);
    return victim.tally.damageTaken;
  }

  it('R pays out its base plus one step per sphere, and clamps', () => {
    expect(castRWith(0)).toBe(SYNDRA_R_BASE);
    expect(castRWith(2)).toBe(SYNDRA_R_BASE + 2 * SYNDRA_R_PER_SPHERE);
    expect(castRWith(5)).toBe(SYNDRA_R_MAX);
  });

  it('R consumes every sphere it gathers, and spares the bystanders', () => {
    const victim = enemy(300);
    const bystander = enemy(320, 40);
    sphere(-100);
    sphere(-200);
    game.objectManager.update();
    expect(groundedSpheres(owner).length).toBe(2);

    new Syndra_R(owner).onSpellCast(context(300, 0, victim));
    expect(groundedSpheres(owner).length).toBe(0);

    advance(SYNDRA_R_CONVERGE_MS + 200);
    expect(victim.tally.damageTaken).toBeGreaterThan(0);
    expect(bystander.tally.damageTaken).toBe(0);
  });
});

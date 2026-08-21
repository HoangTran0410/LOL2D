import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));

import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import {
  createGame,
  createUnit,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  type TestGame,
} from '../spell/fixtures';
import { buildContentApi } from '../../../src/content/ContentApi';
import { SYNDRA_E_DAMAGE } from '../../../packs/riot/spells/Syndra_E';
import makeSyndra_E, { makeSyndra_E_Sphere } from '../../../packs/riot/spells/Syndra_E';
import { MAX_SPHERES, SPHERE_GRAB_RADIUS, SPHERE_LIFETIME_MS, SYNDRA_Q_DAMAGE, SYNDRA_Q_FALL_MS } from '../../../packs/riot/spells/Syndra_Q';
import makeSyndra_Q, { makeSyndra_Sphere, makeGroundedSpheres } from '../../../packs/riot/spells/Syndra_Q';
import { SYNDRA_R_BASE, SYNDRA_R_CONVERGE_MS, SYNDRA_R_MAX, SYNDRA_R_PER_SPHERE } from '../../../packs/riot/spells/Syndra_R';
import makeSyndra_R from '../../../packs/riot/spells/Syndra_R';
import { SYNDRA_W_DAMAGE } from '../../../packs/riot/spells/Syndra_W';
import makeSyndra_W from '../../../packs/riot/spells/Syndra_W';
const __api = buildContentApi();
const Syndra_E = makeSyndra_E(__api);
const Syndra_E_Sphere = makeSyndra_E_Sphere(__api);
const Syndra_Q = makeSyndra_Q(__api);
const Syndra_Sphere = makeSyndra_Sphere(__api);
const groundedSpheres = makeGroundedSpheres(__api);
const Syndra_R = makeSyndra_R(__api);
const Syndra_W = makeSyndra_W(__api);

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
    expect(['reeling', 'held']).toContain(carried.mode);
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

  /**
   * Driven through `press()` rather than by calling `onActivate`/`onRecast`
   * directly, which is the whole point: the two tests above do call them
   * directly, and that is why neither could see this. The runtime handed
   * `onRecast` the context snapshotted when the window *opened*, so the throw
   * went wherever the cursor had been at pickup — and she has to be standing
   * next to a sphere to pick it up, so that is roughly back where the sphere
   * already was. Reported as "it throws it back to the old sphere position".
   */
  it('W throws to where the cursor is on the second press, not the first', () => {
    const carried = sphere(100);
    game.objectManager.update();

    const w = new Syndra_W(owner);
    // Press one: cursor on the sphere she is picking up, 100px away.
    expect(w.press(context(100, 0))).toBe(true);
    expect(['reeling', 'held']).toContain(carried.mode);

    // Press two: cursor somewhere else entirely, inside the 450px throw range.
    expect(w.press(context(400, 0))).toBe(true);
    advance(700);

    const spheres = groundedSpheres(owner);
    expect(spheres.length).toBe(1);
    expect(spheres[0].position.x).toBeCloseTo(400, 0);
    expect(spheres[0].position.y).toBeCloseTo(0, 0);
  });

  it('W letting its window lapse drops the sphere at her feet, still hers', () => {
    const carried = sphere(200);
    game.objectManager.update();

    const w = new Syndra_W(owner);
    w.onActivate(context(300, 0));
    expect(['reeling', 'held']).toContain(carried.mode);

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

  it('R refuses to target self or ally and does not bombard self', () => {
    const r = new Syndra_R(owner);
    const ally = unit(game, 200, 'blue');
    game.objectManager.addObject(ally);
    sphere(-100);
    game.objectManager.update();

    r.onSpellCast(context(0, 0, owner));
    expect(owner.tally.damageTaken).toBe(0);
    expect(groundedSpheres(owner).length).toBe(1);

    r.onSpellCast(context(200, 0, ally));
    expect(ally.tally.damageTaken).toBe(0);
    expect(groundedSpheres(owner).length).toBe(1);

    const pressed = r.press(context(0, 0));
    expect(pressed).toBe(false);
    expect(owner.tally.damageTaken).toBe(0);
  });
});

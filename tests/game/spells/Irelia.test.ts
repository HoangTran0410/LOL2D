import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));

import Irelia_Q, { Q_DAMAGE, Q_RANGE } from '../../../src/game/gameObject/spells/Irelia_Q';
import Irelia_W, {
  Irelia_W_Guard,
  W_CHARGE_MS,
  W_DAMAGE_REDUCTION,
  W_HEAL_PER_HIT,
  W_MAX_DAMAGE,
  W_MIN_DAMAGE,
  W_MIN_REACH,
} from '../../../src/game/gameObject/spells/Irelia_W';
import Irelia_E, {
  E_DAMAGE,
  E_RANGE,
  E_RECAST_DELAY_MS,
  E_THROW_SPEED,
  E_WINDOW_MS,
  Irelia_E_Blade,
  Irelia_E_Throw,
} from '../../../src/game/gameObject/spells/Irelia_E';
import Irelia_R, {
  Irelia_R_Arrow,
  Irelia_R_Volley,
  R_ARM_LENGTH,
  R_DAMAGE,
  R_RANGE,
  R_VOLLEY_SIZE,
  R_VOLLEY_SPEED,
  R_WALL_COLLAPSE_MS,
  R_WALL_DAMAGE,
  R_WALL_MS,
} from '../../../src/game/gameObject/spells/Irelia_R';
import Dash from '../../../src/game/gameObject/buffs/Dash';
import Slow from '../../../src/game/gameObject/buffs/Slow';
import Stun from '../../../src/game/gameObject/buffs/Stun';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import type Spell from '../../../src/game/gameObject/Spell';
import {
  createGame,
  createUnit,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  pressSpell,
  releaseSpell,
  type TestGame,
} from '../spell/fixtures';

const FRAME_MS = 16;

function unit(game: TestGame, x: number, teamId: string, y = 0): AttackableUnit {
  const result = createUnit(game, x, teamId);
  result.position.y = y;
  result.destination.y = y;
  result.collisionRadius = 1;
  result.stats.speed.baseValue = 10;
  result.stats.mana.baseValue = 100;
  result.stats.maxMana.baseValue = 100;
  result.stats.health.baseValue = 100;
  result.stats.maxHealth.baseValue = 100;
  result.stats.healthRegen.baseValue = 0;
  result.stats.manaRegen.baseValue = 0;
  result.animatedValues.displaySize = 20;
  return result;
}

describe('Irelia spells', () => {
  let game: TestGame;
  let owner: AttackableUnit;

  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
    vi.stubGlobal('deltaTime', FRAME_MS);
    vi.stubGlobal('createVector', (x = 0, y = 0) => new (p5 as any).Vector(x, y));
    game = createGame();
    owner = unit(game, 0, 'blue');
    game.setPlayer(owner);
    game.objectManager.addObject(owner);
    (game as any).worldMouse = createVector(600, 0);
    game.objectManager.update();
  });

  afterEach(() => vi.unstubAllGlobals());

  /** A world point `dx`/`dy` away from Irelia. */
  function at(dx: number, dy = 0) {
    return { x: owner.position.x + dx, y: owner.position.y + dy };
  }

  function enemy(x: number, y = 0): AttackableUnit {
    const victim = unit(game, x, 'red', y);
    game.objectManager.addObject(victim);
    game.objectManager.update();
    return victim;
  }

  function health(of: AttackableUnit): number {
    return of.stats.health.baseValue;
  }

  /** One frame of the world, plus the spells that are mid-cast. */
  function frames(count: number, ...spells: Spell[]): void {
    for (let i = 0; i < count; i++) {
      game.objectManager.update();
      for (const spell of spells) spell.update();
    }
  }

  /** Every live object of a type, including the ones still queued to be added. */
  function objectsOf<T>(Type: new (...args: never[]) => T): T[] {
    const manager = game.objectManager as unknown as {
      objects: unknown[];
      _objectToBeAdd: unknown[];
    };
    const found: T[] = [];
    for (const candidate of [...manager.objects, ...manager._objectToBeAdd]) {
      if (candidate instanceof Type) found.push(candidate);
    }
    return found;
  }

  function place(target: AttackableUnit, x: number, y: number): void {
    target.position.x = x;
    target.position.y = y;
    target.stopMovement();
  }

  // ------------------------------------------------------------------ Q

  it('Q surges onto the enemy under the cursor and cuts them once', () => {
    const victim = enemy(200);
    const q = new Irelia_Q(owner);

    expect(pressSpell(q, { target: victim })).toBe(true);
    expect(owner.buffs.some(buff => buff instanceof Dash)).toBe(true);
    expect(health(victim)).toBe(100);

    frames(60);

    expect(health(victim)).toBe(100 - Q_DAMAGE);
    // and she stopped beside the body rather than inside it
    expect(owner.position.x).toBeGreaterThan(120);
    expect(owner.position.x).toBeLessThan(200);
  });

  it('Q is refused with nobody in reach, and charges nothing for the attempt', () => {
    enemy(Q_RANGE + 400);
    const q = new Irelia_Q(owner);
    const manaBefore = owner.stats.mana.baseValue;

    expect(pressSpell(q, { at: at(600) })).toBe(false);
    expect(owner.stats.mana.baseValue).toBe(manaBefore);
    expect(q.state).toBe('READY');
    expect(owner.buffs.some(buff => buff instanceof Dash)).toBe(false);
  });

  it('Q charges its mana and its cooldown on the surge that is allowed', () => {
    const victim = enemy(200);
    const q = new Irelia_Q(owner);

    expect(pressSpell(q, { target: victim })).toBe(true);
    expect(owner.stats.mana.baseValue).toBe(100 - q.manaCost);
    expect(q.currentCooldown).toBe(q.coolDown);
  });

  it('a surge that kills hands the key straight back; one that does not, does not', () => {
    const doomed = enemy(200);
    doomed.stats.health.baseValue = Q_DAMAGE - 1;
    const killer = new Irelia_Q(owner);

    expect(pressSpell(killer, { target: doomed })).toBe(true);
    expect(killer.currentCooldown).toBe(killer.coolDown);
    frames(60);

    expect(doomed.isDead).toBe(true);
    expect(killer.currentCooldown).toBe(0);
    expect(killer.state).toBe('READY');

    // the control: a surge that only hurt keeps the cooldown it started
    place(owner, 0, 0);
    const survivor = enemy(200);
    const spent = new Irelia_Q(owner);
    expect(pressSpell(spent, { target: survivor })).toBe(true);
    frames(60);

    expect(survivor.isDead).toBe(false);
    expect(spent.currentCooldown).toBeGreaterThan(0);
  });

  it('a surge whose caster dies on the way lands nothing', () => {
    const victim = enemy(300);
    const q = new Irelia_Q(owner);

    expect(pressSpell(q, { target: victim })).toBe(true);
    frames(2);
    // Still airborne, still short of the body.
    expect(owner.buffs.some(buff => buff instanceof Dash)).toBe(true);
    expect(health(victim)).toBe(100);

    owner.takeDamage(1000, victim);
    expect(owner.isDead).toBe(true);

    frames(10);
    expect(health(victim)).toBe(100);
  });

  it('a surge taken off its feet mid-flight lands nothing', () => {
    const victim = enemy(300);
    const q = new Irelia_Q(owner);

    expect(pressSpell(q, { target: victim })).toBe(true);
    frames(2);
    expect(owner.buffs.some(buff => buff instanceof Dash)).toBe(true);

    // Someone else's stun: `DASH_INTERRUPT_BUFFS` cancels the surge, which is
    // the whole counterplay to a dash that damages on arrival.
    owner.addBuff(new Stun(600, victim, owner));
    frames(10);

    expect(owner.buffs.some(buff => buff instanceof Dash)).toBe(false);
    expect(health(victim)).toBe(100);
  });

  // ------------------------------------------------------------------ W

  it('W guards her while the blades wind up, and stops the moment she lets go', () => {
    const foe = enemy(600);
    const w = new Irelia_W(owner);

    expect(pressSpell(w, { at: at(600) })).toBe(true);
    expect(w.state).toBe('CHARGING');
    const guard = owner.buffs.find(buff => buff instanceof Irelia_W_Guard) as Irelia_W_Guard;
    expect(guard).toBeDefined();

    owner.takeDamage(20, foe);
    expect(health(owner)).toBe(100 - Math.round(20 * (1 - W_DAMAGE_REDUCTION)));

    expect(releaseSpell(w, { at: at(600) })).toBe(true);
    expect(guard.toRemove).toBe(true);

    // Asserted on the damage rather than on `owner.buffs`: a deactivated buff
    // sits in that list until the next `updateBuffs()`, so membership would
    // still say "guarded" on the frame she let go.
    const guarded = health(owner);
    owner.takeDamage(20, foe);
    expect(health(owner)).toBe(guarded - 20);
  });

  it('W released at once reaches W_MIN_REACH for W_MIN_DAMAGE and no further', () => {
    const near = enemy(W_MIN_REACH - 60);
    const far = enemy(W_MIN_REACH + 100);
    const aside = enemy(120, 300);
    const w = new Irelia_W(owner);

    expect(pressSpell(w, { at: at(600) })).toBe(true);
    expect(releaseSpell(w, { at: at(600) })).toBe(true);

    expect(health(near)).toBe(100 - W_MIN_DAMAGE);
    expect(health(far)).toBe(100);
    expect(health(aside)).toBe(100);
  });

  it('W held to the full reaches further and hits harder, and fires itself', () => {
    const far = enemy(W_MIN_REACH + 100);
    const w = new Irelia_W(owner);

    expect(pressSpell(w, { at: at(600) })).toBe(true);
    vi.stubGlobal('deltaTime', W_CHARGE_MS);
    w.update();
    vi.stubGlobal('deltaTime', FRAME_MS);

    expect(w.state).not.toBe('CHARGING');
    expect(health(far)).toBe(100 - W_MAX_DAMAGE);
  });

  it('W slows what it cuts and pays her back per body, once each', () => {
    const first = enemy(80);
    const second = enemy(160);
    owner.stats.health.baseValue = 50;
    const w = new Irelia_W(owner);

    expect(pressSpell(w, { at: at(600) })).toBe(true);
    expect(releaseSpell(w, { at: at(600) })).toBe(true);

    expect(first.buffs.some(buff => buff instanceof Slow)).toBe(true);
    expect(second.buffs.some(buff => buff instanceof Slow)).toBe(true);
    expect(health(owner)).toBe(50 + W_HEAL_PER_HIT * 2);
  });

  // ------------------------------------------------------------------ E

  it('E throws the blade rather than placing it: nothing stands until it lands', () => {
    const bystander = enemy(300);
    const e = new Irelia_E(owner);

    expect(pressSpell(e, { at: { x: 300, y: -200 } })).toBe(true);
    expect(e.state).toBe('ACTIVE');
    // Airborne, and the ground where it is going is still empty.
    expect(objectsOf(Irelia_E_Throw).length).toBe(1);
    expect(e.firstBlade).toBeNull();
    expect(objectsOf(Irelia_E_Blade).length).toBe(0);

    frames(40, e);

    expect(objectsOf(Irelia_E_Throw).length).toBe(0);
    expect(e.firstBlade).not.toBeNull();
    expect(objectsOf(Irelia_E_Blade).length).toBe(1);
    expect(health(bystander)).toBe(100);
  });

  it('E: the throw lands where it was aimed, not on top of Irelia', () => {
    const e = new Irelia_E(owner);
    expect(pressSpell(e, { at: { x: 300, y: -200 } })).toBe(true);
    frames(40, e);

    const blade = e.firstBlade!;
    expect(blade).not.toBeNull();
    expect(Math.hypot(blade.position.x - 300, blade.position.y + 200)).toBeLessThan(E_THROW_SPEED);
  });

  it('E: the recast lockout outlasts the longest throw', () => {
    // The whole of `closeDuet` is written on the assumption that the first
    // blade is already standing when a second press is legal. That is only true
    // because of this relationship, so it is asserted rather than commented.
    const framesToCross = Math.ceil(E_RANGE / E_THROW_SPEED);
    expect(framesToCross * FRAME_MS).toBeLessThan(E_RECAST_DELAY_MS);
  });

  it('E: the second blade cuts and stuns the line only once it lands', () => {
    const caught = enemy(300, 0);
    const clear = enemy(100, 0);
    const e = new Irelia_E(owner);

    expect(pressSpell(e, { at: { x: 300, y: -200 } })).toBe(true);
    // the recast lockout is a real wait, not a formality
    expect(pressSpell(e, { at: { x: 300, y: 200 } })).toBe(false);

    // The first blade flies out and stands; the lockout lapses on the way, so
    // by the time the throw has landed the second press is already legal.
    frames(40, e);
    expect(e.firstBlade).not.toBeNull();

    expect(pressSpell(e, { at: { x: 300, y: 200 } })).toBe(true);
    // still in the air: nobody has been touched yet
    expect(health(caught)).toBe(100);
    expect(caught.buffs.some(buff => buff instanceof Stun)).toBe(false);

    frames(40, e);

    expect(health(caught)).toBe(100 - E_DAMAGE);
    expect(caught.buffs.some(buff => buff instanceof Stun)).toBe(true);
    expect(health(clear)).toBe(100);
    expect(clear.buffs.some(buff => buff instanceof Stun)).toBe(false);
  });

  it('E: the window lapsing pulls the blade back out and cuts nobody', () => {
    const bystander = enemy(300, 0);
    const e = new Irelia_E(owner);

    expect(pressSpell(e, { at: { x: 300, y: -200 } })).toBe(true);
    frames(40, e);
    const blade = e.firstBlade;
    expect(blade).not.toBeNull();

    vi.stubGlobal('deltaTime', E_WINDOW_MS);
    e.update();
    vi.stubGlobal('deltaTime', FRAME_MS);

    expect(e.firstBlade).toBeNull();
    expect(blade!.retracting).toBe(true);
    expect(health(bystander)).toBe(100);
    expect(e.state).toBe('COOLDOWN');
  });

  // ------------------------------------------------------------------ R

  it('R throws one tight cluster, which stops on the first body it meets', () => {
    const blocker = enemy(200, 0);
    const r = new Irelia_R(owner);

    expect(pressSpell(r, { at: at(600) })).toBe(true);
    // one object, not a fan: the blades travel held together
    expect(objectsOf(Irelia_R_Volley).length).toBe(1);
    expect(objectsOf(Irelia_R_Arrow).length).toBe(0);

    frames(60);

    const arrow = objectsOf(Irelia_R_Arrow);
    expect(arrow.length).toBe(1);
    // it opened on the body, well short of its own maximum reach
    expect(arrow[0].position.x).toBeLessThan(R_RANGE / 2);
    expect(Math.abs(arrow[0].position.x - blocker.position.x)).toBeLessThan(
      R_VOLLEY_SPEED + R_VOLLEY_SIZE
    );
  });

  it('R opens at the end of its reach when it meets nobody', () => {
    const r = new Irelia_R(owner);
    expect(pressSpell(r, { at: at(600) })).toBe(true);
    frames(60);

    const arrow = objectsOf(Irelia_R_Arrow);
    expect(arrow.length).toBe(1);
    expect(Math.abs(arrow[0].position.x - R_RANGE)).toBeLessThan(R_VOLLEY_SPEED + 1);
  });

  it('R: the arrowhead sweeps back from the apex, both arms, along the throw', () => {
    const r = new Irelia_R(owner);
    expect(pressSpell(r, { at: at(600) })).toBe(true);
    frames(60);

    const arrow = objectsOf(Irelia_R_Arrow)[0];
    expect(arrow.arms.length).toBe(2);
    for (const arm of arrow.arms) {
      // thrown along +x, so both arms end *behind* the apex
      expect(arm.end.x).toBeLessThan(arm.start.x);
      expect(Math.hypot(arm.end.x - arm.start.x, arm.end.y - arm.start.y)).toBeCloseTo(
        R_ARM_LENGTH,
        3
      );
    }
    // and to opposite sides of it
    expect(arrow.arms[0].end.y * arrow.arms[1].end.y).toBeLessThan(0);
  });

  it('R cuts and slows what the opening catches', () => {
    // Beside the apex, inside an arm once it tears open.
    const caught = enemy(200, 0);
    const r = new Irelia_R(owner);

    expect(pressSpell(r, { at: at(600) })).toBe(true);
    frames(60);

    expect(health(caught)).toBe(100 - R_DAMAGE);
    expect(caught.buffs.some(buff => buff instanceof Slow)).toBe(true);
  });

  it('R charges again for walking back into the standing blades', () => {
    const r = new Irelia_R(owner);
    expect(pressSpell(r, { at: at(600) })).toBe(true);
    frames(60);

    const arrow = objectsOf(Irelia_R_Arrow)[0];
    const walker = enemy(0, 900);
    expect(health(walker)).toBe(100);

    // Step onto an arm...
    const arm = arrow.arms[0];
    place(walker, (arm.start.x + arm.end.x) / 2, (arm.start.y + arm.end.y) / 2);
    game.objectManager.update();
    frames(2);
    expect(health(walker)).toBe(100 - R_WALL_DAMAGE);
    expect(walker.buffs.some(buff => buff instanceof Slow)).toBe(true);

    // ...standing still in it is not charged again...
    frames(6);
    expect(health(walker)).toBe(100 - R_WALL_DAMAGE);

    // ...but leaving and stepping back in is.
    place(walker, 0, 900);
    game.objectManager.update();
    frames(2);
    place(walker, (arm.start.x + arm.end.x) / 2, (arm.start.y + arm.end.y) / 2);
    game.objectManager.update();
    frames(2);
    expect(health(walker)).toBe(100 - R_WALL_DAMAGE * 2);
  });

  it('R: the blades let everyone through — they cut, they do not block', () => {
    const r = new Irelia_R(owner);
    expect(pressSpell(r, { at: at(600) })).toBe(true);
    frames(60);

    const arrow = objectsOf(Irelia_R_Arrow)[0];
    const arm = arrow.arms[0];
    const standing = { x: (arm.start.x + arm.end.x) / 2, y: (arm.start.y + arm.end.y) / 2 };

    const foe = enemy(0, 900);
    place(foe, standing.x, standing.y);
    game.objectManager.update();
    frames(3);

    expect(foe.position.x).toBe(standing.x);
    expect(foe.position.y).toBe(standing.y);
  });

  it('R: the blades come down when their time is up', () => {
    const r = new Irelia_R(owner);
    expect(pressSpell(r, { at: at(600) })).toBe(true);
    frames(60);
    expect(objectsOf(Irelia_R_Arrow).length).toBe(1);

    vi.stubGlobal('deltaTime', R_WALL_MS);
    frames(1);
    vi.stubGlobal('deltaTime', R_WALL_COLLAPSE_MS);
    frames(2);
    vi.stubGlobal('deltaTime', FRAME_MS);

    expect(objectsOf(Irelia_R_Arrow).length).toBe(0);
  });
});

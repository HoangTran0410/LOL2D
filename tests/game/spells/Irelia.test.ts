import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));
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
import { buildContentApi } from '../../../src/content/ContentApi';
import { IRELIA_MARK_MS, Q_DAMAGE, Q_RANGE } from '../../../packs/riot/spells/Irelia_Q';
import makeIrelia_Q, { makeApplyIreliaMark, makeIrelia_Q_Blades, makeFindIreliaMark } from '../../../packs/riot/spells/Irelia_Q';
import { W_CHARGE_MS, W_DAMAGE_REDUCTION, W_HEAL_PER_HIT, W_MAX_DAMAGE, W_MIN_DAMAGE, W_MIN_REACH } from '../../../packs/riot/spells/Irelia_W';
import makeIrelia_W, { makeIrelia_W_Guard } from '../../../packs/riot/spells/Irelia_W';
import { E_DAMAGE, E_RANGE, E_RECAST_DELAY_MS, E_THROW_SPEED, E_WINDOW_MS } from '../../../packs/riot/spells/Irelia_E';
import makeIrelia_E, { makeIrelia_E_Blade, makeIrelia_E_Throw } from '../../../packs/riot/spells/Irelia_E';
import { R_APEX_OVERSHOOT, R_ARM_LENGTH, R_HOOK_LENGTH, R_HOOK_TURN, R_OPEN_MS, R_DAMAGE, R_RANGE, R_VOLLEY_SIZE, R_VOLLEY_SPEED, R_WALL_COLLAPSE_MS, R_WALL_DAMAGE, R_WALL_MS } from '../../../packs/riot/spells/Irelia_R';
import makeIrelia_R, { makeIrelia_R_Volley, makeIrelia_R_Wall } from '../../../packs/riot/spells/Irelia_R';
const __api = buildContentApi();
const Irelia_Q = makeIrelia_Q(__api);
const applyIreliaMark = makeApplyIreliaMark(__api);
const Irelia_Q_Blades = makeIrelia_Q_Blades(__api);
const findIreliaMark = makeFindIreliaMark(__api);
const Irelia_W = makeIrelia_W(__api);
const Irelia_W_Guard = makeIrelia_W_Guard(__api);
const Irelia_E = makeIrelia_E(__api);
const Irelia_E_Blade = makeIrelia_E_Blade(__api);
const Irelia_E_Throw = makeIrelia_E_Throw(__api);
const Irelia_R = makeIrelia_R(__api);
const Irelia_R_Volley = makeIrelia_R_Volley(__api);
const Irelia_R_Wall = makeIrelia_R_Wall(__api);

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

  it('Q brings her blades with it, and takes them away when the slot is swapped out', () => {
    const q = new Irelia_Q(owner);
    expect(objectsOf(Irelia_Q_Blades).length).toBe(0);

    frames(1, q);
    expect(objectsOf(Irelia_Q_Blades).length).toBe(1);

    // One set of blades, not one per frame.
    frames(5, q);
    expect(objectsOf(Irelia_Q_Blades).length).toBe(1);

    // Swapped out in the practice panel: the art goes with the spell that owns
    // it, or a custom kit accumulates the orbits of every spell it ever held.
    q.onRemoved();
    game.objectManager.update();
    expect(objectsOf(Irelia_Q_Blades).length).toBe(0);
  });

  it('Q takes the enemy it can finish over the one under the cursor', () => {
    // The cursor is parked on the healthy one, which is also the nearest body —
    // exactly the pick `TargetResolver` makes on its own, and exactly the wrong
    // one when a surge somewhere else would come straight back.
    const healthy = enemy(120, 0);
    const doomed = enemy(0, 260);
    doomed.stats.health.baseValue = Q_DAMAGE - 1;

    const q = new Irelia_Q(owner);
    expect(pressSpell(q, { at: { x: 140, y: 0 } })).toBe(true);
    frames(60);

    expect(doomed.isDead).toBe(true);
    expect(health(healthy)).toBe(100);
    expect(q.currentCooldown).toBe(0);
  });

  it('Q takes a marked enemy over the one under the cursor', () => {
    // Same setup as the finisher test, except nobody dies: the mark is the
    // reason to fly past the near one, because it is also a reset.
    const healthy = enemy(120, 0);
    const marked = enemy(0, 260);
    applyIreliaMark(owner, marked);

    const q = new Irelia_Q(owner);
    expect(pressSpell(q, { at: { x: 140, y: 0 } })).toBe(true);
    frames(60);

    expect(health(marked)).toBe(100 - Q_DAMAGE);
    expect(health(healthy)).toBe(100);
    expect(q.currentCooldown).toBe(0);
  });

  it('Q takes the enemy it can finish over a marked one', () => {
    const marked = enemy(120, 0);
    applyIreliaMark(owner, marked);
    const doomed = enemy(0, 260);
    doomed.stats.health.baseValue = Q_DAMAGE - 1;

    const q = new Irelia_Q(owner);
    expect(pressSpell(q, { at: { x: 140, y: 0 } })).toBe(true);
    frames(60);

    expect(doomed.isDead).toBe(true);
    // The mark is a reset she did not have to spend, so it is still standing.
    expect(health(marked)).toBe(100);
    expect(findIreliaMark(marked)).not.toBeNull();
  });

  it('Q leaves the cursor in charge when nothing in reach dies to it', () => {
    const near = enemy(120, 0);
    const far = enemy(0, 260);

    const q = new Irelia_Q(owner);
    expect(pressSpell(q, { at: { x: 140, y: 0 } })).toBe(true);
    frames(60);

    expect(health(near)).toBe(100 - Q_DAMAGE);
    expect(health(far)).toBe(100);
  });

  it('Q reports the enemies it would finish, for the on-screen mark', () => {
    const healthy = enemy(120, 0);
    const doomed = enemy(0, 260);
    doomed.stats.health.baseValue = Q_DAMAGE - 1;
    const outOfReach = enemy(Q_RANGE + 300, 0);
    outOfReach.stats.health.baseValue = 1;

    const q = new Irelia_Q(owner);
    const candidates = q.executeCandidates();

    expect(candidates).toContain(healthy);
    expect(candidates).toContain(doomed);
    expect(candidates).not.toContain(outOfReach);
    expect(q.executeDamageAgainst(doomed)).toBe(Q_DAMAGE);
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

  it('W plants her feet: she cannot move while the blades wind up', () => {
    const w = new Irelia_W(owner);
    expect(owner.canMove).toBe(true);

    expect(pressSpell(w, { at: at(600) })).toBe(true);
    frames(1, w);
    expect(w.state).toBe('CHARGING');
    expect(owner.canMove).toBe(false);

    expect(releaseSpell(w, { at: at(600) })).toBe(true);
    frames(2, w);
    expect(owner.canMove).toBe(true);
  });

  it('W: a move order neither moves her nor ends the charge', () => {
    const w = new Irelia_W(owner);
    expect(pressSpell(w, { at: at(600) })).toBe(true);
    frames(1, w);
    const stood = { x: owner.position.x, y: owner.position.y };

    owner.navigateTo(owner.position.x + 400, owner.position.y);
    frames(5, w);

    // Refusing the order is not the same as cancelling on it. Under the old
    // form the click ended the charge even though she never took a step, which
    // is the worst of both: she is rooted *and* punished for asking to move.
    expect(w.state).toBe('CHARGING');
    expect(owner.position.x).toBe(stood.x);
    expect(owner.position.y).toBe(stood.y);
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
    expect(objectsOf(Irelia_R_Wall).length).toBe(0);

    frames(60);

    const wall = objectsOf(Irelia_R_Wall);
    expect(wall.length).toBe(1);
    // it stopped on the body, well short of its own maximum reach
    expect(wall[0].impact.x).toBeLessThan(R_RANGE / 2);
    expect(Math.abs(wall[0].impact.x - blocker.position.x)).toBeLessThan(
      R_VOLLEY_SPEED + R_VOLLEY_SIZE
    );
  });

  it('R opens at the end of its reach when it meets nobody', () => {
    const r = new Irelia_R(owner);
    expect(pressSpell(r, { at: at(600) })).toBe(true);
    frames(60);

    const wall = objectsOf(Irelia_R_Wall);
    expect(wall.length).toBe(1);
    expect(Math.abs(wall[0].position.x - R_RANGE)).toBeLessThan(R_VOLLEY_SPEED + 1);
  });

  it('R: the apex stands past the body it struck, so the V closes around it', () => {
    const blocker = enemy(200, 0);
    const r = new Irelia_R(owner);
    expect(pressSpell(r, { at: at(600) })).toBe(true);
    frames(60);

    const wall = objectsOf(Irelia_R_Wall)[0];
    expect(wall.impact.x).toBeCloseTo(blocker.position.x, 3);
    // Thrown along +x, so the vertex is further along the throw than the body,
    // which leaves the body in the mouth of the V rather than at its tip.
    expect(wall.position.x).toBeCloseTo(blocker.position.x + R_APEX_OVERSHOOT, 3);
    for (const arm of wall.arms) {
      expect(arm[0].start.x).toBeGreaterThan(blocker.position.x);
    }
  });

  it('R opens at the point it stopped when it meets nobody, with no overshoot', () => {
    // Nothing to close around, and pushing the vertex out anyway would hand the
    // ability free reach past R_RANGE.
    const r = new Irelia_R(owner);
    expect(pressSpell(r, { at: at(600) })).toBe(true);
    frames(60);

    const wall = objectsOf(Irelia_R_Wall)[0];
    expect(wall.position.x).toBeCloseTo(wall.impact.x, 3);
  });

  it('R: the wall sweeps back from the apex, both arms, along the throw', () => {
    const r = new Irelia_R(owner);
    expect(pressSpell(r, { at: at(600) })).toBe(true);
    frames(60);

    const wall = objectsOf(Irelia_R_Wall)[0];
    expect(wall.arms.length).toBe(2);

    for (const arm of wall.arms) {
      // rooted at the vertex, and each segment carries on from the last
      expect(arm[0].start.x).toBeCloseTo(wall.position.x, 3);
      expect(arm[0].start.y).toBeCloseTo(wall.position.y, 3);
      for (let i = 1; i < arm.length; i++) {
        expect(arm[i].start.x).toBeCloseTo(arm[i - 1].end.x, 6);
        expect(arm[i].start.y).toBeCloseTo(arm[i - 1].end.y, 6);
      }

      // thrown along +x, so the straight run goes *behind* the apex
      const run = arm[0];
      expect(run.end.x).toBeLessThan(run.start.x);
      expect(Math.hypot(run.end.x - run.start.x, run.end.y - run.start.y)).toBeCloseTo(
        R_ARM_LENGTH,
        3
      );

      let hook = 0;
      for (let i = 1; i < arm.length; i++) {
        hook += Math.hypot(arm[i].end.x - arm[i].start.x, arm[i].end.y - arm[i].start.y);
      }
      expect(hook).toBeCloseTo(R_HOOK_LENGTH, 3);
    }

    // and the two run to opposite sides of the throw
    const tips = wall.arms.map(arm => arm[arm.length - 1].end);
    expect(tips[0].y * tips[1].y).toBeLessThan(0);
  });

  it('R: each arm ends in a hook curling back toward the throw', () => {
    const r = new Irelia_R(owner);
    expect(pressSpell(r, { at: at(600) })).toBe(true);
    frames(60);

    const wall = objectsOf(Irelia_R_Wall)[0];
    for (const arm of wall.arms) {
      const run = arm[0];
      const tail = arm[arm.length - 1];
      const runAngle = Math.atan2(run.end.y - run.start.y, run.end.x - run.start.x);
      const tailAngle = Math.atan2(tail.end.y - tail.start.y, tail.end.x - tail.start.x);

      const turned = Math.atan2(Math.sin(tailAngle - runAngle), Math.cos(tailAngle - runAngle));
      expect(Math.abs(turned)).toBeCloseTo(R_HOOK_TURN, 3);

      // Turning is not enough — it has to turn the right way. The straight run
      // leans away from the throw axis; by the end of the hook the tail leans
      // back across it, which is what makes the shape close rather than flare.
      const runAcross = run.end.y - run.start.y;
      const tailAcross = tail.end.y - tail.start.y;
      expect(Math.sign(tailAcross)).toBe(-Math.sign(runAcross));
    }
  });

  it('R: the blades charge nobody until they have finished travelling out', () => {
    const r = new Irelia_R(owner);
    expect(pressSpell(r, { at: at(600) })).toBe(true);

    for (let i = 0; i < 120 && objectsOf(Irelia_R_Wall).length === 0; i++) frames(1);
    // two more, so the opening burst has happened and is behind us
    frames(2);
    const wall = objectsOf(Irelia_R_Wall)[0];
    expect(wall).toBeDefined();

    const walker = enemy(0, 900);
    const run = wall.arms[0][0];
    place(walker, (run.start.x + run.end.x) / 2, (run.start.y + run.end.y) / 2);
    game.objectManager.update();

    // Still in flight: the blades are not standing there yet, so neither is
    // the toll. Charging for a wall that is visibly still travelling is the
    // one direction of the draw/damage gap that is never defensible.
    frames(3);
    expect(health(walker)).toBe(100);

    // And once they land, standing in them costs.
    frames(Math.ceil(R_OPEN_MS / FRAME_MS) + 2);
    expect(health(walker)).toBe(100 - R_WALL_DAMAGE);
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

    const wall = objectsOf(Irelia_R_Wall)[0];
    const walker = enemy(0, 900);
    expect(health(walker)).toBe(100);

    // Step onto an arm...
    const arm = wall.arms[0][0];
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

    const wall = objectsOf(Irelia_R_Wall)[0];
    const arm = wall.arms[0][0];
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
    expect(objectsOf(Irelia_R_Wall).length).toBe(1);

    vi.stubGlobal('deltaTime', R_WALL_MS);
    frames(1);
    vi.stubGlobal('deltaTime', R_WALL_COLLAPSE_MS);
    frames(2);
    vi.stubGlobal('deltaTime', FRAME_MS);

    expect(objectsOf(Irelia_R_Wall).length).toBe(0);
  });

  // --------------------------------------------------------------- the mark

  it('E marks everyone the duet catches, and nobody it missed', () => {
    const caught = enemy(300, 0);
    const clear = enemy(100, 0);
    const e = new Irelia_E(owner);

    expect(pressSpell(e, { at: { x: 300, y: -200 } })).toBe(true);
    frames(40, e);
    expect(pressSpell(e, { at: { x: 300, y: 200 } })).toBe(true);
    frames(40, e);

    expect(findIreliaMark(caught)).not.toBeNull();
    expect(findIreliaMark(clear)).toBeNull();
  });

  it('R marks everyone the opening catches', () => {
    const caught = enemy(200, 0);
    const r = new Irelia_R(owner);

    expect(pressSpell(r, { at: at(600) })).toBe(true);
    frames(60);

    expect(findIreliaMark(caught)).not.toBeNull();
  });

  it('a surge onto a marked target hands the key back and spends the mark', () => {
    const victim = enemy(200);
    applyIreliaMark(owner, victim);
    expect(findIreliaMark(victim)).not.toBeNull();

    const q = new Irelia_Q(owner);
    expect(pressSpell(q, { target: victim })).toBe(true);
    expect(q.currentCooldown).toBe(q.coolDown);

    frames(60);

    // It survived, so this reset is the mark's doing and nothing else's.
    expect(victim.isDead).toBe(false);
    expect(q.currentCooldown).toBe(0);
    expect(findIreliaMark(victim)).toBeNull();
  });

  it('a mark nobody spends lapses on its own', () => {
    const victim = enemy(200);
    applyIreliaMark(owner, victim);
    expect(findIreliaMark(victim)).not.toBeNull();

    vi.stubGlobal('deltaTime', IRELIA_MARK_MS);
    frames(2);
    vi.stubGlobal('deltaTime', FRAME_MS);

    expect(findIreliaMark(victim)).toBeNull();
  });
});

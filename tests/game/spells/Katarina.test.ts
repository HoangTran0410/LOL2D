import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));

import Katarina_Q, {
  KATARINA_MAX_DAGGERS,
  KATARINA_PICKUP_RADIUS,
  KATARINA_Q_BOUNCE_DAMAGE,
  KATARINA_Q_FIRST_DAMAGE,
  KATARINA_Q_MAX_TARGETS,
  Katarina_Dagger,
  type Katarina_Q_Object,
} from '../../../src/game/gameObject/spells/Katarina_Q';
import Katarina_W, {
  KATARINA_W_HOP,
  KATARINA_W_SLOW_RADIUS,
} from '../../../src/game/gameObject/spells/Katarina_W';
import Katarina_E, {
  KATARINA_E_DAGGER_DAMAGE,
  KATARINA_E_Q_REFUND_MS,
} from '../../../src/game/gameObject/spells/Katarina_E';
import Katarina_R, {
  KATARINA_R_DURATION_MS,
  KATARINA_R_TICK_DAMAGE,
  KATARINA_R_TICK_MS,
  type Katarina_R_Lotus,
} from '../../../src/game/gameObject/spells/Katarina_R';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import {
  createGame,
  createUnit,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  type TestGame,
} from '../spell/fixtures';

/** Ticks the channel is allowed, worked out here rather than read back from the spell. */
const EXPECTED_R_TICKS = Math.floor(KATARINA_R_DURATION_MS / KATARINA_R_TICK_MS);

function unit(game: TestGame, x: number, teamId: string, y = 0): AttackableUnit {
  const result = createUnit(game, x, teamId);
  result.position.y = y;
  result.destination.y = y;
  result.collisionRadius = 1;
  result.stats.speed.baseValue = 10;
  result.stats.mana.baseValue = 100;
  result.stats.health.baseValue = 100;
  result.stats.maxHealth.baseValue = 100;
  // Regen would drift the exact-damage assertions over a multi-second channel.
  result.stats.healthRegen.baseValue = 0;
  result.stats.manaRegen.baseValue = 0;
  result.animatedValues.displaySize = 20;
  return result;
}

describe('Katarina — the dagger economy', () => {
  let game: TestGame;
  let owner: AttackableUnit;

  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
    vi.stubGlobal('deltaTime', 250);
    vi.stubGlobal('createVector', (x = 0, y = 0) => new (p5 as any).Vector(x, y));
    game = createGame();
    owner = unit(game, 0, 'blue');
    game.setPlayer(owner);
    game.objectManager.addObject(owner);
    (game as any).worldMouse = createVector(300, 0);
  });

  afterEach(() => vi.unstubAllGlobals());

  function context(dx: number, dy: number) {
    return {
      spellId: 'test',
      activationId: 'test',
      startedAtMs: 0,
      caster: owner,
      origin: { x: owner.position.x, y: owner.position.y },
      cursorWorld: { x: owner.position.x + dx, y: owner.position.y + dy },
      direction: { x: Math.sign(dx), y: Math.sign(dy) },
    } as any;
  }

  function enemy(x: number, y = 0): AttackableUnit {
    const victim = unit(game, x, 'red', y);
    game.objectManager.addObject(victim);
    return victim;
  }

  function flyQ(): Katarina_Q_Object {
    const q = new Katarina_Q(owner);
    q.onSpellCast(context(300, 0));
    const missile = game.objectManager._objectToBeAdd.find(
      object => object instanceof Object && 'struck' in (object as any)
    ) as Katarina_Q_Object;
    for (let frame = 0; frame < 600 && !missile.toRemove; frame++) game.objectManager.update();
    return missile;
  }

  it('Q chains at most MAX_TARGETS units and never bills one twice', () => {
    const first = enemy(300);
    const second = enemy(450);
    const third = enemy(600);
    const fourth = enemy(750);

    const missile = flyQ();

    expect(missile.struck.length).toBe(KATARINA_Q_MAX_TARGETS);
    expect(new Set(missile.struck).size).toBe(KATARINA_Q_MAX_TARGETS);
    expect(first.stats.health.value).toBe(100 - KATARINA_Q_FIRST_DAMAGE);
    expect(second.stats.health.value).toBe(100 - KATARINA_Q_BOUNCE_DAMAGE);
    expect(third.stats.health.value).toBe(100 - KATARINA_Q_BOUNCE_DAMAGE);
    expect(fourth.stats.health.value).toBe(100);
  });

  it('Q leaves exactly one dagger, and a fourth dagger evicts the oldest', () => {
    enemy(300);
    flyQ();
    expect(Katarina_Dagger.aliveFor(owner).length).toBe(1);

    const oldest = Katarina_Dagger.aliveFor(owner)[0];
    for (let i = 1; i <= KATARINA_MAX_DAGGERS; i++) Katarina_Dagger.plant(owner, i * 40, 400);

    expect(Katarina_Dagger.aliveFor(owner).length).toBe(KATARINA_MAX_DAGGERS);
    expect(oldest.toRemove).toBe(true);
  });

  it('W drops its dagger where she left, not where she lands', () => {
    const victim = enemy(120);
    game.objectManager.update();
    new Katarina_W(owner).onSpellCast(context(200, 0));

    const daggers = Katarina_Dagger.aliveFor(owner);
    expect(daggers.length).toBe(1);
    expect(daggers[0].position.x).toBe(0);

    const dash = owner.buffs.find(buff => 'dashDestination' in (buff as any)) as any;
    expect(dash.dashDestination.x).toBeCloseTo(-KATARINA_W_HOP, 5);
    expect(daggers[0].position.dist(dash.dashDestination)).toBeCloseTo(KATARINA_W_HOP, 5);
    // The slow is measured from the departure point, so a unit ahead of her is caught.
    expect(victim.position.dist(daggers[0].position)).toBeLessThan(KATARINA_W_SLOW_RADIUS);
    expect(victim.buffs.length).toBeGreaterThan(0);
  });

  it('E snaps to a dagger inside the pickup radius and to the raw point outside it', () => {
    Katarina_Dagger.plant(owner, 300, KATARINA_PICKUP_RADIUS - 50);
    const near = Katarina_Dagger.aliveFor(owner)[0];
    new Katarina_E(owner).onSpellCast(context(300, 0));
    expect(owner.position.x).toBe(300);
    expect(owner.position.y).toBe(KATARINA_PICKUP_RADIUS - 50);
    expect(near.toRemove).toBe(true);

    // Now a dagger far from the click: the click point wins, untouched.
    const far = Katarina_Dagger.plant(owner, 0, KATARINA_PICKUP_RADIUS + 200);
    new Katarina_E(owner).onSpellCast(context(0, -300));
    expect(owner.position.x).toBe(300);
    expect(owner.position.y).toBe(KATARINA_PICKUP_RADIUS - 50 - 300);
    expect(far.toRemove).toBe(false);
    expect(owner.position.dist(far.position)).toBeGreaterThan(KATARINA_PICKUP_RADIUS);
  });

  it('E only refunds Q when it actually eats a dagger, and detonates around the arrival', () => {
    const q = new Katarina_Q(owner);
    const e = new Katarina_E(owner);
    (owner as any).spells = [q, new Katarina_W(owner), e, new Katarina_R(owner)];

    q.currentCooldown = 5000;
    e.onSpellCast(context(300, 0));
    expect(q.currentCooldown).toBe(5000);
    expect(owner.position.x).toBe(300);

    // A dagger under her feet, a click just off it: she eats it this time.
    Katarina_Dagger.plant(owner, owner.position.x, owner.position.y);
    const bystander = enemy(340);
    game.objectManager.update();
    q.currentCooldown = 5000;
    e.onSpellCast(context(0, 40));
    expect(q.currentCooldown).toBe(5000 - KATARINA_E_Q_REFUND_MS);
    expect(bystander.stats.health.value).toBeLessThanOrEqual(100 - KATARINA_E_DAGGER_DAMAGE);
  });

  it('R ticks duration/tick times and stops, converging on one cleanup', () => {
    const victim = enemy(200);
    const r = new Katarina_R(owner);
    r.onCastStart(context(0, 0));
    const lotus = game.objectManager._objectToBeAdd.find(
      object => 'ticksDone' in (object as any)
    ) as Katarina_R_Lotus;

    for (let frame = 0; frame < 200 && !lotus.toRemove; frame++) game.objectManager.update();

    expect(lotus.ticksDone).toBe(EXPECTED_R_TICKS);
    expect(victim.stats.health.value).toBe(100 - EXPECTED_R_TICKS * KATARINA_R_TICK_DAMAGE);
    expect(lotus.toRemove).toBe(true);

    // Interrupt and natural end converge: finishing again changes nothing.
    r.onCancel(context(0, 0), 'STUN');
    expect(lotus.ticksDone).toBe(EXPECTED_R_TICKS);
  });
});

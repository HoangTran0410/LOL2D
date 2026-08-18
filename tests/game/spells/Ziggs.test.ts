import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));

import Ziggs_Q, {
  Q_BLAST_RADIUS,
  Q_BOUNCE_COUNT,
  Q_BOUNCE_GAP_MS,
  Q_BOUNCE_STEP,
  Q_DAMAGE,
  Q_TRAVEL_MS,
  Ziggs_Q_Object,
} from '../../../src/game/gameObject/spells/Ziggs_Q';
import Ziggs_W, {
  W_DAMAGE,
  W_FUSE_MS,
  W_PUSH,
  Ziggs_W_Object,
} from '../../../src/game/gameObject/spells/Ziggs_W';
import Ziggs_E, {
  E_ARM_MS,
  E_DAMAGE,
  E_MAX_TRIPS_PER_UNIT,
  E_MINE_COUNT,
  Ziggs_E_Object,
} from '../../../src/game/gameObject/spells/Ziggs_E';
import Ziggs_R, {
  R_FLIGHT_MS,
  R_INNER_DAMAGE,
  R_OUTER_DAMAGE,
  Ziggs_R_Object,
} from '../../../src/game/gameObject/spells/Ziggs_R';
import Dash from '../../../src/game/gameObject/buffs/Dash';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
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

/** The freshly spawned object still sitting in _objectToBeAdd. A plain loop: filter cannot narrow. */
function pending<T>(game: TestGame, Type: new (...args: never[]) => T): T {
  const queue = (game.objectManager as unknown as { _objectToBeAdd: unknown[] })._objectToBeAdd;
  for (const candidate of queue) {
    if (candidate instanceof Type) return candidate;
  }
  throw new Error(`no pending ${Type.name}`);
}

function place(target: AttackableUnit, x: number, y: number): void {
  target.position.x = x;
  target.position.y = y;
  target.stopMovement();
}

function dashOn(target: AttackableUnit): { dashDestination: { x: number; y: number } } {
  const found = target.buffs.find(buff => buff instanceof Dash);
  if (!found) throw new Error('no displacement buff');
  return found as unknown as { dashDestination: { x: number; y: number } };
}

describe('Ziggs spells', () => {
  let game: TestGame;
  let owner: AttackableUnit;

  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
    vi.stubGlobal('deltaTime', 16);
    vi.stubGlobal('createVector', (x = 0, y = 0) => new (p5 as any).Vector(x, y));
    game = createGame();
    owner = unit(game, 0, 'blue');
    game.setPlayer(owner);
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

  it('Q lands three blasts Q_BOUNCE_STEP apart along the cast axis', () => {
    new Ziggs_Q(owner).onSpellCast(context(300, 0));
    const bomb = pending(game, Ziggs_Q_Object);

    expect(bomb.landings.length).toBe(Q_BOUNCE_COUNT);
    // cursor sits 300 away, well inside the 450 cast range, so the first hop lands on it
    expect(bomb.landings[0].x).toBeCloseTo(300, 3);
    expect(bomb.landings[0].y).toBeCloseTo(0, 3);
    expect(bomb.landings[1].x - bomb.landings[0].x).toBeCloseTo(Q_BOUNCE_STEP, 3);
    expect(bomb.landings[2].x - bomb.landings[1].x).toBeCloseTo(Q_BOUNCE_STEP, 3);
  });

  it('Q hits a unit standing in the overlap of two blasts twice', () => {
    // blasts land at 300 / 430 / 560 with a 120 radius, so 365 sits inside the first two only
    const single = unit(game, 250, 'red');
    const overlap = unit(game, 365, 'red');
    const clear = unit(game, 760, 'red');
    game.objectManager.addObject(single);
    game.objectManager.addObject(overlap);
    game.objectManager.addObject(clear);
    game.objectManager.update();

    new Ziggs_Q(owner).onSpellCast(context(300, 0));
    const bomb = pending(game, Ziggs_Q_Object);

    vi.stubGlobal('deltaTime', Q_TRAVEL_MS);
    bomb.update();
    expect(overlap.tally.damageTaken).toBe(Q_DAMAGE);

    vi.stubGlobal('deltaTime', Q_BOUNCE_GAP_MS);
    bomb.update();
    bomb.update();

    expect(bomb.blastsFired).toBe(Q_BOUNCE_COUNT);
    expect(single.tally.damageTaken).toBe(Q_DAMAGE);
    expect(overlap.tally.damageTaken).toBe(2 * Q_DAMAGE);
    expect(clear.tally.damageTaken).toBe(0);
    expect(Q_BLAST_RADIUS).toBeGreaterThan(0);
  });

  it('W detonates on recast, and only once', () => {
    const victim = unit(game, 200, 'red');
    game.objectManager.addObject(victim);
    game.objectManager.update();

    const w = new Ziggs_W(owner);
    w.onActivate(context(100, 0));
    const satchel = pending(game, Ziggs_W_Object);
    satchel.onAdded();

    vi.stubGlobal('deltaTime', 500);
    satchel.update();
    expect(victim.tally.damageTaken).toBe(0);

    w.onRecast();
    expect(victim.tally.damageTaken).toBe(W_DAMAGE);

    w.onRecast();
    satchel.update();
    expect(victim.tally.damageTaken).toBe(W_DAMAGE);
  });

  it('W blows itself up on its own fuse when it is never recast', () => {
    const victim = unit(game, 200, 'red');
    game.objectManager.addObject(victim);
    game.objectManager.update();

    const w = new Ziggs_W(owner);
    w.onActivate(context(100, 0));
    const satchel = pending(game, Ziggs_W_Object);
    satchel.onAdded();

    vi.stubGlobal('deltaTime', W_FUSE_MS - 1);
    satchel.update();
    expect(victim.tally.damageTaken).toBe(0);

    vi.stubGlobal('deltaTime', 2);
    satchel.update();
    satchel.update();
    expect(victim.tally.damageTaken).toBe(W_DAMAGE);
  });

  it('W throws Ziggs clear of the blast without hurting him', () => {
    const victim = unit(game, 200, 'red');
    game.objectManager.addObject(victim);
    game.objectManager.update();

    const w = new Ziggs_W(owner);
    w.onActivate(context(100, 0));
    const satchel = pending(game, Ziggs_W_Object);
    satchel.onAdded();
    satchel.detonate();

    expect(owner.tally.damageTaken).toBe(0);
    expect(victim.tally.damageTaken).toBe(W_DAMAGE);
    // satchel at 100: Ziggs stands at 0 and is thrown to -260, the enemy at 200 to 460
    expect(dashOn(owner).dashDestination.x).toBeCloseTo(-W_PUSH, 3);
    expect(dashOn(victim).dashDestination.x).toBeCloseTo(200 + W_PUSH, 3);
  });

  it('E caps a single unit at E_MAX_TRIPS_PER_UNIT mines however many it walks over', () => {
    const walker = unit(game, 300, 'red');
    game.objectManager.addObject(walker);
    game.objectManager.update();

    new Ziggs_E(owner).onSpellCast(context(300, 300));
    const field = pending(game, Ziggs_E_Object);
    field.onAdded();
    expect(field.mines.length).toBe(E_MINE_COUNT);

    vi.stubGlobal('deltaTime', E_ARM_MS + 1);
    field.update();

    vi.stubGlobal('deltaTime', 16);
    for (const mine of field.mines) {
      place(walker, mine.position.x, mine.position.y);
      game.objectManager.update();
      field.update();
    }

    expect(walker.tally.damageTaken).toBe(E_MAX_TRIPS_PER_UNIT * E_DAMAGE);
    let consumed = 0;
    for (const mine of field.mines) if (mine.consumed) consumed++;
    expect(consumed).toBe(E_MAX_TRIPS_PER_UNIT);
  });

  it('E mines do not trip before E_ARM_MS', () => {
    const walker = unit(game, 300, 'red');
    game.objectManager.addObject(walker);
    game.objectManager.update();

    new Ziggs_E(owner).onSpellCast(context(300, 300));
    const field = pending(game, Ziggs_E_Object);
    field.onAdded();

    const spot = field.mines[0].position;
    place(walker, spot.x, spot.y);
    game.objectManager.update();

    vi.stubGlobal('deltaTime', E_ARM_MS - 1);
    field.update();
    expect(walker.tally.damageTaken).toBe(0);

    vi.stubGlobal('deltaTime', 2);
    field.update();
    expect(walker.tally.damageTaken).toBe(E_DAMAGE);
  });

  it('R splits its blast into a core and a band, and lands only at R_FLIGHT_MS', () => {
    // impact at 400: 450 is 50 out (core), 620 is 220 out (band), 760 is 360 out (clear)
    const core = unit(game, 450, 'red');
    const band = unit(game, 620, 'red');
    const clear = unit(game, 760, 'red');
    game.objectManager.addObject(core);
    game.objectManager.addObject(band);
    game.objectManager.addObject(clear);
    game.objectManager.update();

    new Ziggs_R(owner).onSpellCast(context(400, 0));
    const shell = pending(game, Ziggs_R_Object);
    shell.onAdded();
    expect(core.tally.damageTaken).toBe(0);

    vi.stubGlobal('deltaTime', R_FLIGHT_MS - 100);
    shell.update();
    expect(core.tally.damageTaken).toBe(0);

    vi.stubGlobal('deltaTime', 100);
    shell.update();

    expect(core.tally.damageTaken).toBe(R_INNER_DAMAGE);
    expect(band.tally.damageTaken).toBe(R_OUTER_DAMAGE);
    expect(clear.tally.damageTaken).toBe(0);
  });
});

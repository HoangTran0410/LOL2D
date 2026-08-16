import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));

import {
  Camille_R_Object,
  CAMILLE_R_RADIUS,
  CAMILLE_R_SEAL_MS,
} from '../../../src/game/gameObject/spells/Camille_R';
import Dash from '../../../src/game/gameObject/buffs/Dash';
import type AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import {
  createGame,
  createUnit,
  installSpellObjectGlobals,
  installSketchMathGlobals,
  type TestGame,
} from '../spell/fixtures';

/**
 * Hextech Ultimatum is a cage, and the three things that make it one were all
 * wrong: it held people who had never been inside it, it held them by writing
 * their position rather than by pulling them, and it outlived Camille walking
 * away from it.
 *
 * The distinction that matters for all three is **membership**. The field acts
 * on units it has captured and on nobody else, so "am I in this fight" is a
 * question the player can answer by looking, and standing next to the wall from
 * the outside is safe.
 */
describe('Camille R traps only what it captured', () => {
  let game: TestGame;
  let camille: AttackableUnit;

  /** Runs the field past its seal so it is live and holding. */
  function seal(field: Camille_R_Object) {
    vi.stubGlobal('deltaTime', CAMILLE_R_SEAL_MS + 16);
    field.update();
    vi.stubGlobal('deltaTime', 16);
  }

  function dashOn(unit: AttackableUnit): Dash | undefined {
    for (const buff of unit.buffs) if (buff instanceof Dash) return buff;
    return undefined;
  }

  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
    vi.stubGlobal('createVector', (x = 0, y = 0) => new (p5 as any).Vector(x, y));
    game = createGame();
    camille = createUnit(game, 0, 'blue');
    camille.stats.size.baseValue = 20;
    // addBuff reaches for the player to decide whose buff bar to refresh
    game.setPlayer(camille);
  });

  afterEach(() => vi.unstubAllGlobals());

  /** Puts a live field centred on the origin, with Camille standing in it. */
  function fieldAtOrigin(): Camille_R_Object {
    const field = new Camille_R_Object(camille);
    field.position.set(0, 0);
    camille.position.set(0, 0);
    game.objectManager.addObject(field);
    game.objectManager.update();
    return field;
  }

  function enemyAt(x: number, y = 0): AttackableUnit {
    const enemy = createUnit(game, x, 'red');
    enemy.position.set(x, y);
    enemy.stats.size.baseValue = 20;
    game.objectManager.addObject(enemy);
    game.objectManager.update();
    return enemy;
  }

  it('never touches a unit that was outside when it sealed', () => {
    const field = fieldAtOrigin();
    // just beyond the wall, and it has never been inside
    const bystander = enemyAt(CAMILLE_R_RADIUS + 40);
    const before = { x: bystander.position.x, y: bystander.position.y };

    seal(field);
    for (let i = 0; i < 5; i++) field.update();

    expect(bystander.position.x).toBe(before.x);
    expect(bystander.position.y).toBe(before.y);
    expect(dashOn(bystander)).toBeUndefined();
  });

  it('pulls a captured unit back with a dash rather than pinning its position', () => {
    const field = fieldAtOrigin();
    const prisoner = enemyAt(20); // well inside
    seal(field);

    // it walks (or flashes) out past the wall
    prisoner.position.set(CAMILLE_R_RADIUS + 60, 0);
    field.update();

    const pull = dashOn(prisoner);
    expect(pull).toBeDefined();
    // a pull, not a clamp: the destination is inside the ring
    const destination = pull!.dashDestination!;
    expect(Math.hypot(destination.x, destination.y)).toBeLessThan(CAMILLE_R_RADIUS);
    // and the escape is not undone by teleporting it back this same frame
    expect(prisoner.position.x).toBeGreaterThan(CAMILLE_R_RADIUS);
  });

  it('ends the moment Camille leaves her own cage', () => {
    const field = fieldAtOrigin();
    seal(field);
    expect(field.toRemove).toBe(false);

    camille.position.set(CAMILLE_R_RADIUS + 80, 0);
    field.update();

    expect(field.toRemove).toBe(true);
  });

  it('captures a unit that walks in after the seal', () => {
    const field = fieldAtOrigin();
    const latecomer = enemyAt(CAMILLE_R_RADIUS + 40);
    seal(field);
    field.update();
    expect(dashOn(latecomer)).toBeUndefined();

    latecomer.position.set(30, 0); // steps inside
    field.update();
    latecomer.position.set(CAMILLE_R_RADIUS + 60, 0); // and tries to leave
    field.update();

    expect(dashOn(latecomer)).toBeDefined();
  });
});

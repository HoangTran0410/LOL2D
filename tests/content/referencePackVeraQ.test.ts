import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/managers/AssetManager', () => ({
  default: { get: (key: string) => ({ key, path: key, status: 'ready', data: null }) },
}));

import AttackableUnit from '../../src/game/gameObject/attackableUnits/AttackableUnit';
import { buildContentApi } from '../../src/content/ContentApi';
import { makeVeraQObject } from '../../packs/reference/spells/Vera_Q';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../game/fixtures';

/** Any body works — `isAllied` only needs `game.player` to resolve at all. */
const setPlayer = (game: TestGame): void => {
  game.setPlayer(
    new AttackableUnit({ game, position: createVector(-9999, -9999), teamId: 'observer' })
  );
};

/**
 * Vera_Q's own tooltip promises "the first enemy hit", and its doc comment
 * calls it a short straight bolt — not a pierce. Pins `maxHitCount = 1`
 * behaviourally rather than reading the field: two enemies sit on the bolt's
 * path, and only the nearer one may ever take damage.
 */
describe('Vera_Q bolt', () => {
  let game: TestGame;

  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    setPlayer(game);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('hits only the first enemy on its path, never a second one further along', () => {
    const api = buildContentApi();
    const owner = new AttackableUnit({ game, position: createVector(0, 0), teamId: 'blue' });
    const nearEnemy = new AttackableUnit({ game, position: createVector(60, 0), teamId: 'red' });
    const farEnemy = new AttackableUnit({ game, position: createVector(200, 0), teamId: 'red' });
    indexObjects(game, [owner, nearEnemy, farEnemy]);

    const VeraQObject = makeVeraQObject(api);
    const bolt = new VeraQObject(owner);
    bolt.destination.set(400, 0);

    for (let i = 0; i < 60 && !bolt.toRemove; i++) bolt.update();

    expect(nearEnemy.stats.health.value).toBeLessThan(100);
    expect(farEnemy.stats.health.value).toBe(100);
    expect(bolt.hitTargets.length).toBe(1);
  });
});

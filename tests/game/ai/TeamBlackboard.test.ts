import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion, {
  type ChampionPresetData,
} from '../../../src/game/gameObject/attackableUnits/Champion';
import Pet from '../../../src/game/gameObject/attackableUnits/Pet';
import { blackboardFor, BLACKBOARD_TTL_MS } from '../../../src/game/ai/TeamBlackboard';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';
import { buildContentApi } from '../../../src/content/ContentApi';
import { packIsInstalled } from '../../support/installedPacks';

const __api = buildContentApi();

/**
 * Zed's shadow, reached with a *lazy, gated* import so the other ten cases in
 * this file — which are about the blackboard's own snapshot, TTL and bucketing
 * and have nothing to do with any pack — still run in a checkout that has no
 * riot pack.
 *
 * `packs/riot/spells/Zed_W` used to be a plain static import here, and one
 * static import is enough to make the whole file unloadable: batch 5 task 8's
 * first round excluded all eleven of these tests over it. A dynamic `import()`
 * that is never evaluated is inert — Vite leaves the specifier alone and
 * nothing resolves it — so the ternary is what does the work, and
 * `packIsInstalled` is what the exclusion scanner reads to know this file has
 * handled the pack's absence itself.
 *
 * A pet that is not a `Pet` is the thing under test, and Zed's clone is the
 * one in the game that is written that way; there is no core stand-in to
 * substitute, which is why this is gated rather than rewritten.
 */
const Zed_W_Clone = packIsInstalled('riot')
  ? (await import('../../../packs/riot/spells/Zed_W')).makeZed_W_Clone(__api)
  : null;

const PRESET: ChampionPresetData = {
  name: 'Test',
  spells: [],
  attack: { damage: 10, attacksPerSecond: 1, range: 100 },
};

const BLUE = 'team-blue';
const RED = 'team-red';

const spawn = (game: TestGame, teamId: string, x: number, y: number) =>
  new Champion({ game, position: createVector(x, y), teamId, preset: PRESET });

/** Nobody sees anybody unless a test says so; keeps roster tests off the fog. */
const blind = () => false;

describe('TeamBlackboard rosters', () => {
  beforeEach(() => stubGameGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('splits the living champions into allies and enemies per team', () => {
    const game = createGame();
    const blue = spawn(game, BLUE, 0, 0);
    const red = spawn(game, RED, 400, 0);
    game.setPlayer(blue);
    indexObjects(game, [blue, red]);

    const view = blackboardFor(game, 0, blind).viewFor(BLUE);

    expect(view.allies).toEqual([blue]);
    expect(view.enemies).toEqual([red]);
  });

  it('leaves a summon out of both rosters and off the rally point', () => {
    // `Pet extends Champion` and carries its summoner's `teamId`, so
    // `instanceof Champion` swept in Tibbers, Shaco's box and clone, Jinx's
    // chomper and Malzahar's voidling. That made `enemies - allies >= 2` fire
    // on summons and send healthy bots home, dragged `rally` toward a
    // stationary box, and let `pickFocus` hand the whole team a summon to
    // converge on. `killCredit` is the discriminator this repo already treats
    // as authoritative — `Pet` sets it to `'none'` for exactly this reason.
    const game = createGame();
    const blue = spawn(game, BLUE, 0, 0);
    const red = spawn(game, RED, 400, 0);
    const tibbers = new Pet({
      game,
      position: createVector(1_000, 0),
      teamId: BLUE,
      ownerUnit: blue,
      lifeTimeMs: 5_000,
    } as never);
    const voidling = new Pet({
      game,
      position: createVector(1_000, 400),
      teamId: RED,
      ownerUnit: red,
      lifeTimeMs: 5_000,
    } as never);
    game.setPlayer(blue);
    indexObjects(game, [blue, red, tibbers, voidling]);

    const view = blackboardFor(game, 0, blind).viewFor(BLUE);

    expect(view.allies).toEqual([blue]);
    expect(view.enemies).toEqual([red]);
    // The summoner's own position, undragged by a pet standing 1000px away.
    expect(view.rally).toEqual({ x: 0, y: 0 });
  });

  it.skipIf(!Zed_W_Clone)(
    'leaves a Zed shadow out too, which is a Champion without being a Pet',
    () => {
      // `Zed_W_Clone extends Champion` directly, so it does not inherit `Pet`'s
      // override and shipped as `killCredit: 'champion'` — a shadow counted
      // toward a team's roster, and killing one scored a kill on someone's KDA.
      const game = createGame();
      const blue = spawn(game, BLUE, 0, 0);
      const red = spawn(game, RED, 400, 0);
      const shadow = new Zed_W_Clone!({
        game,
        position: createVector(600, 0),
        teamId: RED,
      } as never);
      game.setPlayer(blue);
      indexObjects(game, [blue, red, shadow]);

      expect(shadow.killCredit).toBe('none');
      expect(blackboardFor(game, 0, blind).viewFor(BLUE).enemies).toEqual([red]);
    }
  );

  it('leaves out the dead and the removed', () => {
    const game = createGame();
    const blue = spawn(game, BLUE, 0, 0);
    const deadRed = spawn(game, RED, 100, 0);
    const goneRed = spawn(game, RED, 200, 0);
    deadRed.stats.health.baseValue = 0;
    deadRed.die({ reviveAfter: 5_000 });
    goneRed.toRemove = true;
    game.setPlayer(blue);
    indexObjects(game, [blue, deadRed, goneRed]);

    expect(blackboardFor(game, 0, blind).viewFor(BLUE).enemies).toEqual([]);
  });

  it('puts the rally point at the centre of the living allies', () => {
    const game = createGame();
    const a = spawn(game, BLUE, 0, 0);
    const b = spawn(game, BLUE, 200, 100);
    game.setPlayer(a);
    indexObjects(game, [a, b]);

    // midpoint of (0,0) and (200,100), by hand
    expect(blackboardFor(game, 0, blind).viewFor(BLUE).rally).toEqual({ x: 100, y: 50 });
  });

  it('has no rally point when nobody is left', () => {
    const game = createGame();
    const red = spawn(game, RED, 0, 0);
    game.setPlayer(red);
    indexObjects(game, [red]);

    expect(blackboardFor(game, 0, blind).viewFor(BLUE).rally).toBeNull();
  });

  it('focuses whoever the most allies are already attacking', () => {
    const game = createGame();
    const a = spawn(game, BLUE, 0, 0);
    const b = spawn(game, BLUE, 10, 0);
    const c = spawn(game, BLUE, 20, 0);
    const popular = spawn(game, RED, 300, 0);
    const ignored = spawn(game, RED, 320, 0);
    a.basicAttack.order(popular);
    b.basicAttack.order(popular);
    c.basicAttack.order(ignored);
    game.setPlayer(a);
    indexObjects(game, [a, b, c, popular, ignored]);

    expect(blackboardFor(game, 0, blind).viewFor(BLUE).focusTarget).toBe(popular);
  });

  it('breaks a tie toward the enemy closest to dying', () => {
    const game = createGame();
    const a = spawn(game, BLUE, 0, 0);
    const b = spawn(game, BLUE, 10, 0);
    const healthy = spawn(game, RED, 300, 0);
    const wounded = spawn(game, RED, 320, 0);
    healthy.stats.health.baseValue = 90;
    wounded.stats.health.baseValue = 12;
    a.basicAttack.order(healthy);
    b.basicAttack.order(wounded);
    game.setPlayer(a);
    indexObjects(game, [a, b, healthy, wounded]);

    expect(blackboardFor(game, 0, blind).viewFor(BLUE).focusTarget).toBe(wounded);
  });

  it('picks the weakest enemy when no ally has an order at all', () => {
    const game = createGame();
    const a = spawn(game, BLUE, 0, 0);
    const healthy = spawn(game, RED, 300, 0);
    const wounded = spawn(game, RED, 320, 0);
    healthy.stats.health.baseValue = 90;
    wounded.stats.health.baseValue = 12;
    game.setPlayer(a);
    indexObjects(game, [a, healthy, wounded]);

    expect(blackboardFor(game, 0, blind).viewFor(BLUE).focusTarget).toBe(wounded);
  });

  it('rebuilds at most once per TTL, however many bots ask', () => {
    const game = createGame();
    const blue = spawn(game, BLUE, 0, 0);
    game.setPlayer(blue);
    indexObjects(game, [blue]);

    const first = blackboardFor(game, 1_000, blind).viewFor(BLUE);
    // A second champion joins, but the window has not elapsed.
    indexObjects(game, [blue, spawn(game, BLUE, 50, 0)]);
    const cached = blackboardFor(game, 1_000 + BLACKBOARD_TTL_MS - 1, blind).viewFor(BLUE);
    expect(cached.allies).toBe(first.allies);

    const rebuilt = blackboardFor(game, 1_000 + BLACKBOARD_TTL_MS, blind).viewFor(BLUE);
    expect(rebuilt.allies).toHaveLength(2);
  });

  it('answers for a team that has nobody in it', () => {
    const game = createGame();
    indexObjects(game, []);
    const view = blackboardFor(game, 0, blind).viewFor(BLUE);
    expect(view.allies).toEqual([]);
    expect(view.focusTarget).toBeNull();
  });
});

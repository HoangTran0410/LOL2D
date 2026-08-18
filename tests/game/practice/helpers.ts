/**
 * The bench every `MatchDirector` suite runs on.
 *
 * It hands back the ordinary `createGame()` fixture with the four extra fields
 * `MatchDirectorContext` adds on top of `GameObjectRuntimeContext`, not a
 * `Game`. That is the whole point of the interface: the director's behaviour
 * can be asserted with no p5 scene, no canvas and no `Game` construction, and
 * building a real `Game` here would quietly give that up.
 *
 * The context and the game are the same object, exactly as they are in
 * production (`Game` is its own director context). That matters more than it
 * looks: `addBot` hands the context to the bot as the bot's game, so a bench
 * that kept them apart would give bots a game the fixture never finished
 * wiring — no `eventManager`, no `createSpellContext` — and the first tick that
 * rolled an auto-cast would blow up.
 *
 * Stubs the p5 globals itself — `Champion` reaches for `createVector` while it
 * is being constructed, and `objectManager.update()` reads `deltaTime` — the
 * same arrangement `tests/game/minions/helpers.ts` uses. Undoing it stays the
 * caller's job: every suite here wants `afterEach(() => vi.unstubAllGlobals())`.
 */
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import type { MatchDirectorContext } from '../../../src/game/MatchDirector';
import TeamId from '../../../src/game/enums/TeamId';
import { createGame, stubGameGlobals, type TestGame } from '../fixtures';

export interface PracticeBench {
  /** What the director is constructed with. Writable, so a suite can swap in spies. */
  context: MatchDirectorContext;
  game: TestGame;
  player: Champion;
}

export function context(): PracticeBench {
  stubGameGlobals();

  const game = createGame();
  const player = new Champion({
    game,
    position: createVector(100, 100),
    teamId: TeamId.BLUE,
  });
  game.setPlayer(player);
  game.objectManager.addObject(player);
  // `addObject` only queues; one tick is what actually puts the player in the
  // world. Every roster assertion below is about who is really in it.
  game.objectManager.update();

  const context = Object.assign(game, {
    // A spawn point well away from the player's (100, 100), so "did the bot
    // land where the match said" is answerable.
    randomSpawnPoint: (_teamId?: string) => createVector(500, 500),
    monsters: [],
    minionSpawner: {
      minions: [],
      enabled: true,
      setEnabled(on: boolean) {
        this.enabled = on;
      },
    },
    matchRules: { cooldownMultiplier: 1, manaFree: false },
    spawnJungle: () => {},
    // The one thing the fixture cannot satisfy on its own: `TestGame.player` is
    // typed `AttackableUnit` (it is a getter, and the fixture serves every unit
    // suite, most of which never build a champion), while the director's roster
    // is champions. The value really is a `Champion` — it is `player` above.
  }) as unknown as MatchDirectorContext;

  return { context, game, player };
}

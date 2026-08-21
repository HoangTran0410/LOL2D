import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MinionSpawner, {
  FIRST_WAVE_DELAY_MS,
  MINION_LIVE_CAP,
  MINION_RELEASE_INTERVAL_MS,
  WAVE_COMPOSITION,
  WAVE_INTERVAL_MS,
  waveComposition,
  waveIntervalAt,
} from '../../../src/game/managers/MinionSpawner';
import Minion from '../../../src/game/gameObject/attackableUnits/Minion';
import Fountain from '../../../src/game/gameObject/structures/Fountain';
import TeamId from '../../../src/game/enums/TeamId';
import { LANES, Lane, getLaneWaypoints } from '../../../src/game/lanes';
import { createSpawnerContext, type SpawnerGame } from './helpers';

const FRAME_MS = 16;
/** Minions released per wave, across both bases. */
const WAVE_SIZE = 2 * LANES.length * WAVE_COMPOSITION.length;

let game: SpawnerGame;
let spawner: MinionSpawner;

/** Advances the clock by `ms` in 16ms frames, the way the game loop does. */
const advance = (ms: number) => {
  for (let elapsed = 0; elapsed < ms; elapsed += FRAME_MS) spawner.update();
};

/** Everything the spawner has put in the world, in release order. */
const spawned = () =>
  game.objectManager._objectToBeAdd.filter((o): o is Minion => o instanceof Minion);

describe('MinionSpawner', () => {
  beforeEach(() => {
    game = createSpawnerContext();
    spawner = new MinionSpawner(game);
  });
  afterEach(() => vi.unstubAllGlobals());

  describe('cadence', () => {
    it('uses the League lane formation and adds the first cannon on wave three', () => {
      expect(WAVE_COMPOSITION).toEqual(['melee', 'melee', 'melee', 'ranged', 'ranged', 'ranged']);
      expect(waveComposition(1)).toEqual(WAVE_COMPOSITION);
      expect(waveComposition(2)).toEqual(WAVE_COMPOSITION);
      expect(waveComposition(3)).toEqual([...WAVE_COMPOSITION, 'cannon']);
      expect(waveComposition(6)).toEqual([...WAVE_COMPOSITION, 'cannon']);
    });

    it('accelerates and thins late-game waves at the current Summoner Rift thresholds', () => {
      expect(waveIntervalAt(0)).toBe(30_000);
      expect(waveIntervalAt(14 * 60_000)).toBe(25_000);
      expect(waveIntervalAt(30 * 60_000)).toBe(20_000);

      // Cannon waves lose one melee after 14:00. Cannons come every two waves
      // after 15:00 and every wave after 25:00. Every wave loses a caster at 30:00.
      expect(waveComposition(30, 14 * 60_000)).toEqual([
        'melee',
        'melee',
        'ranged',
        'ranged',
        'ranged',
        'cannon',
      ]);
      expect(waveComposition(31, 15 * 60_000)).not.toContain('cannon');
      expect(waveComposition(32, 15 * 60_000)).toContain('cannon');
      expect(waveComposition(31, 25 * 60_000)).toContain('cannon');
      expect(waveComposition(40, 30 * 60_000)).toEqual([
        'melee',
        'melee',
        'ranged',
        'ranged',
        'cannon',
      ]);
    });

    it('holds the first wave until the opening delay has run', () => {
      advance(FIRST_WAVE_DELAY_MS - 2 * FRAME_MS);
      expect(spawner.waveCount).toBe(0);
      expect(spawned()).toHaveLength(0);

      advance(3 * FRAME_MS);
      expect(spawner.waveCount).toBe(1);
      expect(spawner.nextWaveIn).toBeCloseTo(WAVE_INTERVAL_MS, -2);
    });

    it('queues one wave every interval after that, and no more', () => {
      advance(FIRST_WAVE_DELAY_MS + FRAME_MS);
      expect(spawner.waveCount).toBe(1);

      advance(WAVE_INTERVAL_MS - 2 * FRAME_MS);
      expect(spawner.waveCount).toBe(1);

      advance(3 * FRAME_MS);
      expect(spawner.waveCount).toBe(2);

      advance(WAVE_INTERVAL_MS);
      expect(spawner.waveCount).toBe(3);
    });

    /**
     * Hand-queues one wave and takes the automatic clock out of the picture.
     *
     * These four assert what ONE wave releases, and `advance` drives
     * `update()`, which also runs the wave clock: with `FIRST_WAVE_DELAY_MS` at
     * 1s and a wave taking `MINION_RELEASE_INTERVAL_MS * composition` to leave,
     * a second wave queues itself halfway through the first and the counts read
     * as double. Pushing the countdown out of reach says "one wave" once,
     * instead of every assertion being a sum of however many the opening delay
     * happens to allow today.
     */
    const queueOneWave = () => {
      spawner.queueWave();
      spawner._nextWaveIn = Number.POSITIVE_INFINITY;
    };

    it('releases a wave in a line rather than a clump', () => {
      queueOneWave();

      // the first of each lane leaves immediately: 2 bases x 3 lanes
      spawner.releaseQueued();
      expect(spawned()).toHaveLength(2 * LANES.length);

      advance(MINION_RELEASE_INTERVAL_MS);
      expect(spawned()).toHaveLength(2 * 2 * LANES.length);

      advance(MINION_RELEASE_INTERVAL_MS * (WAVE_COMPOSITION.length - 2) + FRAME_MS);
      expect(spawned()).toHaveLength(WAVE_SIZE);
      expect(spawner.liveCount).toBe(WAVE_SIZE);
    });

    it('sends one wave per lane from each base, in the composition it declares', () => {
      queueOneWave();
      advance(MINION_RELEASE_INTERVAL_MS * WAVE_COMPOSITION.length);

      const minions = spawned();
      expect(minions).toHaveLength(WAVE_SIZE);

      for (const teamId of [TeamId.BLUE, TeamId.RED]) {
        for (const lane of LANES) {
          const group = minions.filter(m => m.teamId === teamId && m.lane === lane);
          expect(group.map(m => m.kind)).toEqual(WAVE_COMPOSITION);
          for (const minion of group) {
            expect(minion.waypoints).toBe(getLaneWaypoints(lane, teamId));
            // Never sent back to its own fountain, which is waypoint 0 of every
            // lane. Which waypoint it *does* head for is pinned separately, in
            // "heads down its lane rather than back to the fountain" below.
            expect(minion.waypointIndex).toBeGreaterThan(0);
          }
        }
      }
    });

    it('releases a cannon for every lane on every third wave', () => {
      spawner.waveCount = 2;
      queueOneWave();
      advance(MINION_RELEASE_INTERVAL_MS * (WAVE_COMPOSITION.length + 1) + FRAME_MS);

      const thirdWave = spawned();
      expect(thirdWave).toHaveLength(2 * LANES.length * (WAVE_COMPOSITION.length + 1));
      for (const teamId of [TeamId.BLUE, TeamId.RED]) {
        for (const lane of LANES) {
          const group = thirdWave.filter(m => m.teamId === teamId && m.lane === lane);
          expect(group.map(m => m.kind)).toEqual([...WAVE_COMPOSITION, 'cannon']);
        }
      }
    });

    it('musters each side between the two turrets guarding its own base', () => {
      // Hand-computed from `summoner_map.json`, not from `musterPointFor`
      // (deleted, Task 6): blue's fountain is 400,6075 and its two nearest
      // turrets are 963,5626 (720px) and 736,5392 (761px); red's is 6100,375
      // with 5646,967 (746px) and 5454,779 (762px). The next building on
      // either side is over 1500px out, so the pair is not a close-run thing.
      // `summonersRiftGeometry.ts` now bakes this pair into `slots.minion`
      // once, at map-build time, and the spawner just looks it up.
      const MUSTER = {
        [TeamId.BLUE]: { x: (963 + 736) / 2, y: (5626 + 5392) / 2 },
        [TeamId.RED]: { x: (5646 + 5454) / 2, y: (967 + 779) / 2 },
      } as Record<string, { x: number; y: number }>;

      spawner.queueWave();
      spawner.releaseQueued();

      const seen = new Set<string>();
      for (const minion of spawned()) {
        const muster = MUSTER[minion.teamId];
        const scatter = game.minionMuster.find(
          slot => slot.teamId === minion.teamId && slot.lane === minion.lane
        )!.scatter;
        seen.add(minion.teamId);
        expect(
          Math.hypot(minion.position.x - muster.x, minion.position.y - muster.y)
        ).toBeLessThanOrEqual(scatter);
        // And no longer standing on the spawn platform, which is what this
        // replaced — a wave used to materialise inside its own fountain.
        const fountain = spawner.fountainFor(minion.teamId)!;
        expect(minion.position.dist(fountain.position)).toBeGreaterThan(fountain.radius);
      }
      expect(seen).toEqual(new Set([TeamId.BLUE, TeamId.RED]));
    });

    it('heads down its lane rather than back to the fountain it no longer starts on', () => {
      /**
       * Pinned to the shipped waypoints, the same contract the rest of
       * `Lanes.test.ts` carries: move a lane and re-derive these.
       *
       * The case that discriminates is **red MID**. Red's muster is (5550, 873)
       * — the midpoint of 5646,967 and 5454,779 — and red walks the blue path
       * backwards, so its waypoint 1 is 5976,856 and its waypoint 2 is
       * 4472,2088. Projected by hand:
       *
       *   segment 0->1 clamps at its far end (5976,856), 426px from the muster
       *   segment 1->2 passes within 257px of it
       *
       * so the muster is already past waypoint 1 and heading for it would walk
       * the wave back toward the red fountain before it set off. Every other
       * lane happens to answer 1 today, which is exactly why "always 1" was
       * wrong rather than merely suboptimal: it depended on the lane, and one
       * lane in six still disagrees with it.
       */
      spawner.queueWave();
      spawner.releaseQueued();

      const released = spawned();
      const indexOf = (teamId: string, lane: string) =>
        released.find(m => m.teamId === teamId && m.lane === lane)!.waypointIndex;

      expect(indexOf(TeamId.BLUE, Lane.TOP)).toBe(1);
      expect(indexOf(TeamId.BLUE, Lane.MID)).toBe(1);
      expect(indexOf(TeamId.BLUE, Lane.BOT)).toBe(1);
      expect(indexOf(TeamId.RED, Lane.TOP)).toBe(1);
      expect(indexOf(TeamId.RED, Lane.MID)).toBe(2);
      expect(indexOf(TeamId.RED, Lane.BOT)).toBe(1);
    });

    it('never falls back to the fountain, whatever the live turrets look like', () => {
      // `musterPointFor` (deleted) recomputed the pair from the live
      // `Turret` objects on every spawn and returned null for a team caught
      // with fewer than two, and the caller answered that null by dropping
      // the whole wave into the fountain — silently, until the first wave
      // walked back out of it. `musterPoint` is a lookup into what the map
      // declared, so the live turret count has nothing to do with it any
      // more; this asserts the muster still holds even with none standing.
      spawner.queueWave();
      spawner.releaseQueued();

      for (const minion of spawned()) {
        const fountain = spawner.fountainFor(minion.teamId)!;
        expect(minion.position.dist(fountain.position)).toBeGreaterThan(fountain.radius);
      }
    });

    it('throws rather than silently falling back to the fountain when a lane has no declared muster point', () => {
      // The failure this used to be: a team with fewer than two turrets got
      // `null` from `musterPointFor` and a wave that quietly spawned in the
      // fountain. `validate.ts` now refuses to install a map missing a slot
      // for a lane it declares, so reaching `musterPoint` with nothing to
      // find means an installed map should have been refused — a bug to
      // surface loudly, not one more silent fountain spawn.
      game.minionMuster = game.minionMuster.filter(
        slot => !(slot.teamId === TeamId.BLUE && slot.lane === Lane.TOP)
      );

      expect(() => spawner.musterPoint(TeamId.BLUE, Lane.TOP)).toThrow(/no muster point/);
    });
  });

  describe('enable toggle', () => {
    it('drops the unreleased tail of a wave when switched off', () => {
      spawner.queueWave();
      spawner.releaseQueued();
      expect(spawner.liveCount).toBe(2 * LANES.length);
      expect(spawner._queue.length).toBeGreaterThan(0);

      spawner.setEnabled(false);

      expect(spawner.enabled).toBe(false);
      expect(spawner._queue).toHaveLength(0);
    });

    it('restarts a full current interval when switched back on without advancing elapsed time', () => {
      const elapsed = 14 * 60_000;
      spawner._elapsedMs = elapsed;
      spawner._nextWaveIn = FRAME_MS;

      spawner.setEnabled(false);
      advance(1_000);
      expect(spawner._elapsedMs).toBe(elapsed);

      spawner.setEnabled(true);

      expect(spawner.enabled).toBe(true);
      expect(spawner._elapsedMs).toBe(elapsed);
      expect(spawner.nextWaveIn).toBe(waveIntervalAt(elapsed));

      advance(waveIntervalAt(elapsed) - 2 * FRAME_MS);
      expect(spawner.waveCount).toBe(0);
      advance(3 * FRAME_MS);
      expect(spawner.waveCount).toBe(1);
    });
  });

  describe('live cap', () => {
    it('stops spawning once the board is full', () => {
      for (let wave = 0; wave < 10; wave++) {
        spawner.queueWave();
        advance(MINION_RELEASE_INTERVAL_MS * (WAVE_COMPOSITION.length + 1));
      }

      expect(spawner.liveCount).toBe(MINION_LIVE_CAP);
      expect(spawned()).toHaveLength(MINION_LIVE_CAP);
      expect(spawner.spawn({ teamId: TeamId.BLUE, lane: LANES[0], kind: 'melee' })).toBeNull();
    });

    it('is a hard cap, not a queue: a full board loses the wave rather than banking it', () => {
      for (let wave = 0; wave < 10; wave++) {
        spawner.queueWave();
        advance(MINION_RELEASE_INTERVAL_MS * (WAVE_COMPOSITION.length + 1));
      }
      expect(spawner._queue).toHaveLength(0);
    });

    it('makes room again as minions die', () => {
      while (spawner.liveCount < MINION_LIVE_CAP) {
        spawner.queueWave();
        advance(MINION_RELEASE_INTERVAL_MS * (WAVE_COMPOSITION.length + 1));
      }
      expect(spawner.spawn({ teamId: TeamId.RED, lane: LANES[1], kind: 'ranged' })).toBeNull();

      spawner.minions[0].die({ reviveAfter: 0 });
      spawner.update();

      expect(spawner.liveCount).toBe(MINION_LIVE_CAP - 1);
      expect(spawner.spawn({ teamId: TeamId.RED, lane: LANES[1], kind: 'ranged' })).toBeInstanceOf(
        Minion
      );
    });

    it('leaves the cap high enough for two waves per lane to be in flight', () => {
      // a lane is ~10.6k px and a minion covers ~156px/s, so a wave is still
      // walking when the next one leaves; anything under this and the second
      // wave would silently never spawn
      const largestWave = 2 * LANES.length * (WAVE_COMPOSITION.length + 1);
      expect(MINION_LIVE_CAP).toBeGreaterThanOrEqual(2 * largestWave);
    });

    it('holds every cohort still traversing at the 30-minute cadence transition', () => {
      // The last pre-30 wave has 6 minions per lane-side and leaves 25s before
      // the first 20s-cadence wave. Forty seconds later it is only 65s into the
      // authored ~68s traversal while three late waves (5 each) are out too:
      // 6 lane-sides * (6 + 3 * 5) = 126. Derive this independently of the
      // composition helpers so a shared mistake cannot make the check agree
      // with itself.
      const laneSides = 2 * LANES.length;
      const minionsPerLaneSide = 6 + 3 * 5;
      expect(MINION_LIVE_CAP).toBeGreaterThanOrEqual(laneSides * minionsPerLaneSide);
    });
  });

  it('drops retired minions from its own list without touching ObjectManager', () => {
    spawner.queueWave();
    spawner.releaseQueued();
    const before = spawner.liveCount;
    expect(before).toBeGreaterThan(0);

    spawner.minions[0].toRemove = true;
    spawner.prune();

    expect(spawner.liveCount).toBe(before - 1);
    expect(spawner.minions.some(m => m.toRemove)).toBe(false);
  });

  it('ignores a fountain that belongs to no team', () => {
    game.fountains.push(new Fountain({ game, preset: { name: 'Orphan', x: 10, y: 10, r: 50 } }));

    spawner.queueWave();
    spawner._nextWaveIn = Number.POSITIVE_INFINITY; // one wave, not however many the clock allows
    advance(MINION_RELEASE_INTERVAL_MS * WAVE_COMPOSITION.length);

    expect(spawned()).toHaveLength(WAVE_SIZE);
  });
});

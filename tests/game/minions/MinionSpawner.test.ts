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
import { LANES, getLaneWaypoints } from '../../../src/game/lanes';
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

    it('releases a wave in a line rather than a clump', () => {
      spawner.queueWave();

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
      spawner.queueWave();
      advance(MINION_RELEASE_INTERVAL_MS * WAVE_COMPOSITION.length);

      const minions = spawned();
      expect(minions).toHaveLength(WAVE_SIZE);

      for (const teamId of [TeamId.BLUE, TeamId.RED]) {
        for (const lane of LANES) {
          const group = minions.filter(m => m.teamId === teamId && m.lane === lane);
          expect(group.map(m => m.kind)).toEqual(WAVE_COMPOSITION);
          for (const minion of group) {
            expect(minion.waypoints).toBe(getLaneWaypoints(lane, teamId));
            // waypoint 0 is the fountain it is standing on
            expect(minion.waypointIndex).toBe(1);
          }
        }
      }
    });

    it('releases a cannon for every lane on every third wave', () => {
      spawner.waveCount = 2;
      spawner.queueWave();
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

    it('spawns each side on its own fountain', () => {
      spawner.queueWave();
      spawner.releaseQueued();

      for (const minion of spawned()) {
        const fountain = spawner.fountainFor(minion.teamId)!;
        expect(fountain.teamId).toBe(minion.teamId);
        expect(minion.position.dist(fountain.position)).toBeLessThanOrEqual(fountain.radius);
      }
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
    advance(MINION_RELEASE_INTERVAL_MS * WAVE_COMPOSITION.length);

    expect(spawned()).toHaveLength(WAVE_SIZE);
  });
});

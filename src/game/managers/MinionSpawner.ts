import TeamId from '../enums/TeamId';
import Minion, { MinionPresets, type MinionKind } from '../gameObject/attackableUnits/Minion';
import type { GameObjectRuntimeContext } from '../gameObject/GameObject';
import type Fountain from '../gameObject/structures/Fountain';
import { LANES, getLaneWaypoints } from '../lanes';

/** ms between waves, per base. */
export const WAVE_INTERVAL_MS = 30_000;
/** ms before the first wave, so a fresh game is not instantly full of minions. */
export const FIRST_WAVE_DELAY_MS = 8_000;
/** ms between the minions of one wave leaving the fountain, so they walk in a line. */
export const MINION_RELEASE_INTERVAL_MS = 650;

/**
 * Hard ceiling on live minions across both teams.
 *
 * A lane is ~10,600px and a minion covers 2.6px/frame ≈ 156px/s, so one takes
 * ~68s to walk a lane end to end — a little over two wave intervals. Two waves
 * per lane per team in flight is therefore the realistic worst case, and 3 lanes
 * x 2 teams x 4 minions x 2 waves = 48. In practice the waves meet near mid at
 * ~34s and kill each other, so the live count sits well under this; the cap only
 * matters when something stalls (both waves grinding on a turret, or nobody
 * dying because every champion is elsewhere) and stops that turning into
 * unbounded growth.
 */
export const MINION_LIVE_CAP = 48;

/**
 * Four per lane per base. Three melee bodies and one caster is enough for a wave
 * to read as a formation and to trade with the enemy wave for a few seconds;
 * six was noticeably heavier on a full board for no extra legibility, and every
 * extra minion costs a quadtree insert, a buff pass and a draw every frame.
 */
export const WAVE_COMPOSITION: MinionKind[] = ['melee', 'melee', 'melee', 'ranged'];

export interface MinionSpawnerContext extends GameObjectRuntimeContext {
  fountains: Fountain[];
}

interface QueuedMinion {
  teamId: string;
  lane: string;
  kind: MinionKind;
  /** ms until this one leaves the fountain. */
  releaseIn: number;
}

/**
 * Wave clock. Not a GameObject: it owns no position and nothing should be able
 * to target or draw it, so Game drives it directly from fixedUpdate().
 *
 * It also owns the live-minion list. ObjectManager already retires `toRemove`
 * objects, so this list is a mirror kept only so the cap can be checked in O(1)
 * instead of scanning every object in the game every frame.
 */
export default class MinionSpawner {
  game: MinionSpawnerContext;
  minions: Minion[] = [];
  /** Waves released so far, across both bases. */
  waveCount = 0;

  _nextWaveIn = FIRST_WAVE_DELAY_MS;
  _queue: QueuedMinion[] = [];

  constructor(game: MinionSpawnerContext) {
    this.game = game;
  }

  get liveCount(): number {
    return this.minions.length;
  }

  /** ms until the next wave leaves the fountains. */
  get nextWaveIn(): number {
    return this._nextWaveIn;
  }

  update() {
    this.prune();

    this._nextWaveIn -= deltaTime;
    if (this._nextWaveIn <= 0) {
      // reset rather than subtract: after a long tab-hidden gap deltaTime can be
      // several intervals wide, and queueing a burst of backdated waves is not
      // what anyone means by "a wave every 30 seconds"
      this._nextWaveIn = WAVE_INTERVAL_MS;
      this.queueWave();
    }

    this.releaseQueued();
  }

  /** Queues one wave per lane from every base. Exposed so tests and the end-to-end
   *  driver can skip the countdown instead of waiting out a real 30 seconds. */
  queueWave() {
    this.waveCount += 1;

    for (const fountain of this.game.fountains) {
      const teamId = fountain.teamId;
      if (teamId !== TeamId.BLUE && teamId !== TeamId.RED) continue;

      for (const lane of LANES) {
        for (let i = 0; i < WAVE_COMPOSITION.length; i++) {
          this._queue.push({
            teamId,
            lane,
            kind: WAVE_COMPOSITION[i],
            releaseIn: i * MINION_RELEASE_INTERVAL_MS,
          });
        }
      }
    }
  }

  releaseQueued() {
    if (this._queue.length === 0) return;

    let write = 0;
    for (let i = 0; i < this._queue.length; i++) {
      const entry = this._queue[i];
      entry.releaseIn -= deltaTime;
      if (entry.releaseIn > 0) {
        this._queue[write++] = entry;
      } else {
        // dropped rather than held back when the board is full: a queue that
        // waits for room would release a whole backdated wave the instant a
        // fight cleared, which is worse than losing it
        this.spawn(entry);
      }
    }
    this._queue.length = write;
  }

  spawn({ teamId, lane, kind }: Pick<QueuedMinion, 'teamId' | 'lane' | 'kind'>): Minion | null {
    if (this.minions.length >= MINION_LIVE_CAP) return null;

    const fountain = this.fountainFor(teamId);
    if (!fountain) return null;

    const minion = new Minion({
      game: this.game,
      position: fountain.randomPointInside(),
      teamId,
      lane,
      waypoints: getLaneWaypoints(lane, teamId),
      preset: MinionPresets[kind],
      // waypoint 0 is the fountain the minion is standing on
      startWaypointIndex: 1,
    });

    this.minions.push(minion);
    this.game.objectManager.addObject(minion);
    return minion;
  }

  fountainFor(teamId: string): Fountain | undefined {
    for (const fountain of this.game.fountains) {
      if (fountain.teamId === teamId) return fountain;
    }
    return undefined;
  }

  /** In-place compaction: this runs every frame and must not allocate. */
  prune() {
    let write = 0;
    for (let i = 0; i < this.minions.length; i++) {
      const minion = this.minions[i];
      if (!minion.toRemove) this.minions[write++] = minion;
    }
    this.minions.length = write;
  }
}

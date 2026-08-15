import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MinionSpawner, {
  FIRST_WAVE_DELAY_MS,
  WAVE_INTERVAL_MS,
} from '../../../src/game/managers/MinionSpawner';
import { createSpawnerContext } from './helpers';

const FRAME_MS = 16;
/** Long enough that a running clock would have queued the opening wave and the one after it. */
const PAST_TWO_WAVES_MS = FIRST_WAVE_DELAY_MS + WAVE_INTERVAL_MS + FRAME_MS;

let spawner: MinionSpawner;

/** Advances the clock by `ms` in 16ms frames, the way the game loop does. */
const advance = (ms: number) => {
  for (let elapsed = 0; elapsed < ms; elapsed += FRAME_MS) spawner.update();
};

describe('MinionSpawner.enabled', () => {
  beforeEach(() => {
    spawner = new MinionSpawner(createSpawnerContext());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("defaults to on, so today's behaviour is unchanged", () => {
    expect(spawner.enabled).toBe(true);

    advance(PAST_TWO_WAVES_MS);
    expect(spawner.waveCount).toBe(2);
    expect(spawner.liveCount).toBeGreaterThan(0);
  });

  it('queues no waves while off', () => {
    spawner.enabled = false;

    advance(PAST_TWO_WAVES_MS);

    expect(spawner.waveCount).toBe(0);
    expect(spawner.liveCount).toBe(0);
  });

  it('holds a wave already queued instead of releasing it', () => {
    spawner.queueWave();
    spawner.releaseQueued();
    const released = spawner.liveCount;
    expect(released).toBeGreaterThan(0);
    expect(spawner._queue.length).toBeGreaterThan(0);

    spawner.enabled = false;
    advance(PAST_TWO_WAVES_MS);

    expect(spawner.liveCount).toBe(released);
  });

  /**
   * The clock freezes rather than draining while off, so switching minions back
   * on gives a full interval of quiet — not a burst of backdated waves, which
   * is the same reason `_nextWaveIn` resets instead of subtracting.
   */
  it('resumes queueing when switched back on, from a clock that did not run', () => {
    spawner.enabled = false;
    advance(PAST_TWO_WAVES_MS);
    expect(spawner.nextWaveIn).toBe(FIRST_WAVE_DELAY_MS);

    spawner.enabled = true;
    advance(FIRST_WAVE_DELAY_MS - 2 * FRAME_MS);
    expect(spawner.waveCount).toBe(0);

    advance(3 * FRAME_MS);
    expect(spawner.waveCount).toBe(1);
    expect(spawner.liveCount).toBeGreaterThan(0);
  });

  it('still prunes dead minions while off, so turning it off does not leak corpses', () => {
    spawner.queueWave();
    spawner.releaseQueued();
    const spawned = spawner.liveCount;
    expect(spawned).toBeGreaterThan(0);

    for (const minion of spawner.minions) minion.toRemove = true;
    spawner.enabled = false;
    spawner.update();

    expect(spawner.liveCount).toBe(0);
  });
});

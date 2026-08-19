/**
 * A unit's speed has to mean the same thing however long a frame lasts.
 *
 * `Stats.speed` is authored per frame — 3 units every time `move()` runs — so
 * the distance covered depended on how many frames happened rather than on how
 * much time passed. Two things fell out of that, and both shipped:
 *
 * - The `30 FPS` render option halved the game's movement speed, while
 *   cooldowns and buff timers, which read `deltaTime`, kept their own pace.
 * - No two real frames are the same length, so a fixed step per frame is a
 *   varying velocity. Once the camera started interpolating over time the
 *   mismatch became plainly visible: the champion the camera is attached to
 *   slid back and forth against the centre of the screen. Before that the two
 *   jittered together, which is what hid it for so long.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import { MAX_FRAME_SCALE, REFERENCE_FRAME_MS } from '../../../src/game/time';
import { createGame, stubGameGlobals, type TestGame } from '../fixtures';

let game: TestGame;

beforeEach(() => {
  stubGameGlobals();
  game = createGame();
});
afterEach(() => vi.unstubAllGlobals());

/** Walks a champion at a far-off destination for `totalMs`, in frames of `frameMs`. */
const walk = (frameMs: number, totalMs: number): number => {
  vi.stubGlobal('deltaTime', frameMs);
  const unit = new Champion({ game, teamId: 'blue' });
  unit.position.set(0, 0);
  unit.moveTo(100_000, 0);
  const frames = Math.round(totalMs / frameMs);
  for (let frame = 0; frame < frames; frame++) unit.move();
  return unit.position.x;
};

describe('distance covered is a function of time, not of frame count', () => {
  it('is unchanged at 60fps', () => {
    // 500ms is 30 reference frames, so the answer is the unit's own per-frame
    // speed thirty times over. The speed is read rather than hard-coded so a
    // retune is not a test edit; the multiplication is written out here, since
    // the per-frame-to-per-time conversion is the thing under test.
    vi.stubGlobal('deltaTime', REFERENCE_FRAME_MS);
    const perFrame = new Champion({ game, teamId: 'blue' }).stats.speed.value;
    expect(walk(REFERENCE_FRAME_MS, 500)).toBeCloseTo(perFrame * 30, 5);
  });

  it('covers the same ground at 30fps — the render option must not halve it', () => {
    expect(walk(1000 / 30, 500)).toBeCloseTo(walk(REFERENCE_FRAME_MS, 500), 5);
  });

  it('covers the same ground at 144fps', () => {
    expect(walk(1000 / 144, 500)).toBeCloseTo(walk(REFERENCE_FRAME_MS, 500), 5);
  });

  it('covers the same ground across uneven frames, which is the real case', () => {
    vi.stubGlobal('deltaTime', REFERENCE_FRAME_MS);
    const unit = new Champion({ game, teamId: 'blue' });
    unit.position.set(0, 0);
    unit.moveTo(100_000, 0);

    // 500ms delivered as a ragged stream, the way a browser actually delivers
    // it. The total is what must match, not the individual steps.
    let spent = 0;
    const lengths = [8, 30, 12, 21, 16, 9, 40, 14];
    for (let i = 0; spent < 500; i++) {
      const frameMs = Math.min(lengths[i % lengths.length], 500 - spent);
      vi.stubGlobal('deltaTime', frameMs);
      unit.move();
      spent += frameMs;
    }

    expect(unit.position.x).toBeCloseTo(unit.stats.speed.value * 30, 5);
  });

  it('clamps one enormous frame rather than teleporting through the world', () => {
    // A backgrounded tab reports seconds. Unclamped that is one step of
    // thousands of units, straight through every wall on the way.
    vi.stubGlobal('deltaTime', REFERENCE_FRAME_MS);
    const perFrame = new Champion({ game, teamId: 'blue' }).stats.speed.value;
    expect(walk(5_000, 5_000)).toBeCloseTo(perFrame * MAX_FRAME_SCALE, 5);
  });

  it('still snaps onto the destination rather than orbiting it', () => {
    vi.stubGlobal('deltaTime', REFERENCE_FRAME_MS);
    const unit = new Champion({ game, teamId: 'blue' });
    unit.position.set(0, 0);
    unit.moveTo(1, 0);
    unit.move();
    expect(unit.position.x).toBe(1);
  });
});

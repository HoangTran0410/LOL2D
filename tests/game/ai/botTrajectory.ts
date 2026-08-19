import type Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import type BotBrain from '../../../src/game/ai/BotBrain';
import { FRAME_MS, type Posture, THINK_INTERVAL_MS } from '../../../src/game/ai/BotBrain';
import type { TeamView } from '../../../src/game/ai/TeamBlackboard';
import type { Vec2 } from '../../../src/game/spell/runtime/types';

/**
 * A bot's decisions **over time**, rather than at one instant.
 *
 * Every `BotBrain` suite in this directory used to work the same way: build a
 * board, call `drive` once, read `destination`. That shape can only find static
 * bugs. A posture layer is a feedback loop — perceive, decide, walk, perceive
 * the consequences of having walked — and a rule can be perfectly stable within
 * one tick and unstable across two, which one sample cannot see by
 * construction.
 *
 * It shipped twice. A bot walked to the keep-out line outside an enemy turret,
 * was let through by a clamp that went quiet exactly where its own answer had
 * parked it, crossed into the guns, was pushed back to the line by DISENGAGE,
 * and repeated that four times a second for as long as anyone watched — while
 * every single-tick test in `BotBrain.turret.test.ts` agreed the rules were
 * right. And `KITE_HOLD_PCT` exists only because a kiting bot that steps one
 * pixel past its hold line has that step undone on the next frame, which reads
 * as vibrating in place: also a two-tick fact.
 *
 * So the multi-tick version is the import, not the thing each suite rewrites
 * when it happens to suspect an oscillation. Assert on the *trace* — nearest
 * approach, direction changes, how often a line was crossed, which postures
 * were actually visited — rather than on a single destination.
 *
 * What this is not: the real `update()` loop. Casting, recall and charge ticks
 * are left out on purpose, because the board is hand-built here rather than
 * gathered from a live `TeamBlackboard`, and the decision loop is what the
 * suites are steering. `tests/e2e/drive-bot-discipline.mjs` is where the whole
 * loop runs against a real match.
 */

/** One decision and the walk it ordered. */
export interface TickSample {
  nowMs: number;
  posture: Posture;
  target: Champion | null;
  /** Where the tick sent the body. */
  destination: Vec2;
  /** Where the body had got to by the end of the tick. */
  position: Vec2;
}

export interface Trajectory {
  readonly samples: readonly TickSample[];
  /** Just the postures, for `toContain` and friends. */
  readonly postures: readonly Posture[];
  /** The same walk with its first `ticks` sliced off — usually the approach. */
  from(ticks: number): Trajectory;
  /** Distance from `at` at the end of each tick. */
  distancesFrom(at: Vec2): number[];
  /** The closest the body ever got to `at`. */
  nearestApproachTo(at: Vec2): number;
  /** How many ticks were spent in `posture`. */
  countOf(posture: Posture): number;
  /**
   * How many times the walk turned round with respect to `at`: in, then out,
   * then in again. This is what "pacing" is, measured.
   *
   * `deadbandPx` ignores steps too small to be a direction — a body that has
   * arrived jitters by fractions of a pixel, and counting those would make
   * every settled walk look like an oscillation.
   */
  reversalsAround(at: Vec2, deadbandPx?: number): number;
  /** How many times the walk crossed the circle of `radius` around `at`. */
  crossingsOf(at: Vec2, radius: number): number;
}

/** Frames of movement between two decisions. 15, at the default tick and 60fps. */
export const FRAMES_PER_THINK = THINK_INTERVAL_MS / FRAME_MS;

const trajectoryOf = (samples: readonly TickSample[]): Trajectory => ({
  samples,
  postures: samples.map(sample => sample.posture),
  from: ticks => trajectoryOf(samples.slice(ticks)),
  distancesFrom: at =>
    samples.map(sample => Math.hypot(sample.position.x - at.x, sample.position.y - at.y)),
  nearestApproachTo(at) {
    return Math.min(...this.distancesFrom(at));
  },
  countOf: posture => samples.filter(sample => sample.posture === posture).length,
  reversalsAround(at, deadbandPx = 1) {
    const away = this.distancesFrom(at);
    let count = 0;
    let heading = 0;
    for (let i = 1; i < away.length; i += 1) {
      const step = away[i] - away[i - 1];
      if (Math.abs(step) < deadbandPx) continue;
      const now = Math.sign(step);
      if (heading !== 0 && now !== heading) count += 1;
      heading = now;
    }
    return count;
  },
  crossingsOf(at, radius) {
    const away = this.distancesFrom(at);
    let count = 0;
    for (let i = 1; i < away.length; i += 1) {
      if (away[i - 1] < radius === away[i] < radius) continue;
      count += 1;
    }
    return count;
  },
});

/**
 * The step `AttackableUnit.update` would have taken between two decisions.
 *
 * Written out rather than driven through the real movement system: what is
 * under test is where the brain *aims*, and a body that walks straight at its
 * destination at full speed is the least generous reading of that — no
 * pathfinding, no collision separation, nothing that could accidentally cover
 * for a bad destination.
 */
const walkTowardDestination = (bot: Champion, distance: number): void => {
  const dx = bot.destination.x - bot.position.x;
  const dy = bot.destination.y - bot.position.y;
  const away = Math.hypot(dx, dy);
  if (away <= distance) {
    bot.position.set(bot.destination.x, bot.destination.y);
    return;
  }
  bot.position.set(
    bot.position.x + (dx / away) * distance,
    bot.position.y + (dy / away) * distance
  );
};

/**
 * Runs `ticks` decisions against `board`, walking the body between each.
 *
 * `between` runs after each tick's movement, for a test that has to move the
 * enemy, drop a wave in or edit the board mid-walk.
 */
export function driveTicks(
  brain: BotBrain,
  bot: Champion,
  board: TeamView,
  ticks: number,
  between?: (tick: number) => void
): Trajectory {
  const samples: TickSample[] = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    const nowMs = tick * THINK_INTERVAL_MS;
    const target = brain.pickTarget(board);
    const posture = brain.evaluatePosture(board, nowMs, target);
    brain.drive(posture, board, target, nowMs);
    const destination = { x: bot.destination.x, y: bot.destination.y };
    walkTowardDestination(bot, bot.moveSpeed * FRAMES_PER_THINK);
    samples.push({
      nowMs,
      posture,
      target,
      destination,
      position: { x: bot.position.x, y: bot.position.y },
    });
    between?.(tick);
  }
  return trajectoryOf(samples);
}

import AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import Minion from '@/game/gameObject/attackableUnits/Minion';
import Turret from '@/game/gameObject/structures/Turret';
import { effectiveHealth } from '@/game/combat/ExecuteTargeting';
import { canSee, type Seeable } from '@/game/combat/Vision';
import { targetVelocity } from '@/game/ai/AimPredictor';
import {
  assignLanes,
  laneAdvance,
  laneNeed,
  laneProgressAt,
  nearestLane,
  LANE_MEMBERSHIP_PX,
  type LaneState,
} from '@/game/ai/LaneObjectives';
import { LANES } from '@/game/lanes';
import type GameObject from '@/game/gameObject/GameObject';
import type { Vec2 } from '@/game/spell/runtime/types';

/**
 * One shared snapshot of the match, rebuilt at most once per tick and read by
 * every bot on both teams — rosters, who the team is focusing, where it is
 * clustered, and a memory of where each enemy was last seen. This is what
 * turns bots from five independent agents into two teams.
 *
 * The memory records *terrain-honest* shared team sight, always. Three tiers
 * read the same board, so it must never carry one tier's advantage — and the
 * advantage a tier does get is `memoryTtlMs`, applied by the *reader*: how long
 * a bot keeps hunting what it lost, not whether it ever loses it. `sees` is
 * injectable only so tests can be deterministic; in the game it is always the
 * honest `canSee`.
 */

/**
 * How long one snapshot serves. Matches the bot think tick, so a board is built
 * once per window for the whole match rather than once per bot: five bots asking
 * cost one pass, not five.
 */
export const BLACKBOARD_TTL_MS = 250;

/**
 * Hard ceiling on a memory entry, above the longest per-tier memory length any
 * bot uses. The per-tier limit is applied by the *reader*, because three
 * difficulties share one board and each forgets at its own pace; this one only
 * stops the map growing without bound over a long match.
 */
export const MEMORY_MAX_MS = 5000;

export interface SeenEnemy {
  unit: Champion;
  atMs: number;
  pos: Vec2;
  vel: Vec2;
}

export interface TeamView {
  allies: readonly Champion[];
  enemies: readonly Champion[];
  focusTarget: Champion | null;
  rally: Vec2 | null;
  memory: ReadonlyMap<Champion, SeenEnemy>;
  /**
   * One entry per lane in `LANES`, scored from this team's side of the map.
   * `LANES` is the active match's own lane set (`lanes.ts`'s
   * `setActiveLanes`, installed by `Game`'s constructor from `map.lanes`) —
   * empty on a map that declares none, which is what leaves `BotBrain`'s
   * PUSH posture with no objective to fall through from.
   */
  lanes: ReadonlyMap<string, LaneState>;
  /** Which lane each of this team's bots is working. Humans are not in it. */
  laneAssignments: ReadonlyMap<Champion, string>;
  /**
   * Every living hostile turret, for `TurretThreat`.
   *
   * Deliberately not the same answer as `LaneState.nextEnemyTurret`, which is
   * the lane *economy* — the next building this team has to break, bucketed by
   * lane and therefore missing any turret standing further than
   * `LANE_MEMBERSHIP_PX` from a waypoint path. A turret nowhere near a lane
   * still shoots, and "may I stand here" has to be asked of all of them.
   */
  enemyTurrets: readonly Turret[];
}

export type SeesFn = (observer: Champion, target: Champion) => boolean;

export interface BlackboardHost {
  objectManager?: { objects: GameObject[] };
}

export const EMPTY_VIEW: TeamView = Object.freeze({
  allies: Object.freeze([]) as readonly Champion[],
  enemies: Object.freeze([]) as readonly Champion[],
  focusTarget: null,
  rally: null,
  memory: new Map<Champion, SeenEnemy>(),
  lanes: new Map<string, LaneState>(),
  laneAssignments: new Map<Champion, string>(),
  enemyTurrets: Object.freeze([]) as readonly Turret[],
});

const defaultSees: SeesFn = (observer, target) =>
  canSee(observer as unknown as Seeable, target as unknown as Seeable);

/** A unit and how far along its lane it is, 0 at the blue end and 1 at the red. */
interface LaneUnit<T> {
  unit: T;
  progress: number;
}

export class TeamBlackboard {
  private views = new Map<unknown, TeamView>();
  private memories = new Map<unknown, Map<Champion, SeenEnemy>>();
  private laneMemories = new Map<unknown, Map<Champion, string>>();
  private builtAtMs = Number.NEGATIVE_INFINITY;

  viewFor(teamId: unknown): TeamView {
    return this.views.get(teamId) ?? EMPTY_VIEW;
  }

  refreshIfStale(game: BlackboardHost, nowMs: number, sees: SeesFn): void {
    if (nowMs - this.builtAtMs < BLACKBOARD_TTL_MS) return;
    this.builtAtMs = nowMs;
    this.rebuild(game, nowMs, sees);
  }

  private rebuild(game: BlackboardHost, nowMs: number, sees: SeesFn): void {
    // One pass over the object list for the whole game. `filter` cannot narrow
    // types here — the polyfilled prototype in `src/main.ts` puts the
    // non-predicate overload first — so this is a plain loop, as MatchDirector.bots() is.
    //
    // It is also the ONLY full-list walk the whole AI layer is allowed, and
    // `tests/game/ai/TeamBlackboard.lanes.test.ts` scans `src/game/ai/` to keep
    // it that way. The lane economy — where each wave has got to, which turret
    // is next — is gathered here rather than in a second pass or a per-frame
    // quadtree query for exactly that reason: five bots asking cost one walk.
    // The list holds every particle and trail in the match, so the
    // `AttackableUnit` test comes first and the three subtype tests only run on
    // what survives it.
    const living: Champion[] = [];
    /** Every standing turret, whatever lane it does or does not belong to. */
    const turrets: Turret[] = [];
    // Seeded from `LANES` — the active match's own lane set, empty on a map
    // with none — so this loop's cost tracks how many lanes the map actually
    // declares, not a fixed three. Bucketing by id inside the walk below,
    // rather than filtering `objects` once per lane afterwards, is what keeps
    // the object-list read singular whatever `LANES` turns out to hold.
    const laneMinions = new Map<string, LaneUnit<Minion>[]>();
    const laneTurrets = new Map<string, LaneUnit<Turret>[]>();
    for (const lane of LANES) {
      laneMinions.set(lane, []);
      laneTurrets.set(lane, []);
    }

    for (const object of game.objectManager?.objects ?? []) {
      if (!(object instanceof AttackableUnit)) continue;
      if (object.toRemove || object.isDead) continue;

      if (object instanceof Minion) {
        const bucket = laneMinions.get(object.lane);
        if (bucket) {
          bucket.push({
            unit: object,
            progress: laneProgressAt(object.lane, object.position.x, object.position.y),
          });
        }
        continue;
      }

      if (object instanceof Turret) {
        // Threat first, lane second: the buckets below drop a building that
        // stands off every waypoint path, and one of those still shoots.
        turrets.push(object);
        // A turret never moves, so its lane and its place along that lane are
        // measured once for the match rather than four times a second.
        const placed = turretPlacement(object);
        if (placed) laneTurrets.get(placed.lane)?.push({ unit: object, progress: placed.progress });
        continue;
      }

      if (!(object instanceof Champion)) continue;
      // `instanceof Champion` is not "is a champion": `Pet extends Champion`
      // (a summoned bear, a decoy clone and its box, a homing pet, a
      // stationary voidling)
      // and so does a self-copying clone, and every one of them carries its
      // summoner's `teamId`. Counting them made `enemies.length - allies.length
      // >= 2` fire on summons and send healthy bots home, dragged `rally` toward a
      // stationary box, and let `pickFocus` hand the whole team a decoy clone to
      // converge on. `killCredit` is the discriminator the codebase already
      // treats as authoritative for exactly this question — `Pet` sets it to
      // `'none'` *because* `instanceof` cannot tell them apart (see CLAUDE.md).
      if (object.killCredit !== 'champion') continue;
      living.push(object);
    }

    const teams = new Set<unknown>();
    for (const champion of living) teams.add(champion.teamId);

    // Where each champion stands, measured once for the whole rebuild rather
    // than once per team: the answer does not change with who is asking.
    const laneOfChampion = new Map<Champion, string>();
    for (const champion of living) {
      const nearest = nearestLane(champion.position.x, champion.position.y);
      // `nearest.lane` is `null` only when `LANES` is empty, in which case
      // `distance` stays `Infinity` and this branch never runs — the extra
      // check is what makes that provable here rather than merely true today.
      if (nearest.distance <= LANE_MEMBERSHIP_PX && nearest.lane !== null) {
        laneOfChampion.set(champion, nearest.lane);
      }
    }

    this.views.clear();
    for (const teamId of teams) {
      const allies: Champion[] = [];
      const enemies: Champion[] = [];
      for (const champion of living) {
        if (champion.teamId === teamId) allies.push(champion);
        else enemies.push(champion);
      }
      const enemyTurrets: Turret[] = [];
      for (const turret of turrets) {
        if (turret.teamId !== teamId) enemyTurrets.push(turret);
      }
      const lanes = this.buildLanes(teamId, enemies, laneOfChampion, laneMinions, laneTurrets);
      this.views.set(teamId, {
        allies,
        enemies,
        enemyTurrets,
        focusTarget: pickFocus(allies, enemies),
        rally: centroid(allies),
        memory: this.refreshMemory(teamId, allies, enemies, nowMs, sees),
        lanes,
        laneAssignments: this.refreshLaneAssignments(teamId, allies, lanes),
      });
    }
  }

  /**
   * The three lanes as this team reads them.
   *
   * Everything here is a walk of buckets the one object pass already filled, so
   * the cost is the wave and the turret rows, twice — not the object list.
   */
  private buildLanes(
    teamId: unknown,
    enemies: readonly Champion[],
    laneOfChampion: ReadonlyMap<Champion, string>,
    laneMinions: ReadonlyMap<string, LaneUnit<Minion>[]>,
    laneTurrets: ReadonlyMap<string, LaneUnit<Turret>[]>
  ): Map<string, LaneState> {
    const side = String(teamId);
    const lanes = new Map<string, LaneState>();

    for (const lane of LANES) {
      let alliedMinions = 0;
      let enemyMinions = 0;
      let frontier: Vec2 | null = null;
      let frontierAdvance = Number.NEGATIVE_INFINITY;

      for (const entry of laneMinions.get(lane) ?? []) {
        if (entry.unit.teamId !== teamId) {
          enemyMinions++;
          continue;
        }
        alliedMinions++;
        const advance = laneAdvance(side, entry.progress);
        if (advance > frontierAdvance) {
          frontierAdvance = advance;
          frontier = { x: entry.unit.position.x, y: entry.unit.position.y };
        }
      }

      let nextEnemyTurret: Turret | null = null;
      let nextEnemyAdvance = Number.POSITIVE_INFINITY;
      let ownTurret: Turret | null = null;
      let ownAdvance = Number.NEGATIVE_INFINITY;

      for (const entry of laneTurrets.get(lane) ?? []) {
        const advance = laneAdvance(side, entry.progress);
        if (entry.unit.teamId === teamId) {
          // Ours: the one furthest from our base is the one their push meets.
          if (advance > ownAdvance) {
            ownAdvance = advance;
            ownTurret = entry.unit;
          }
        } else if (advance < nextEnemyAdvance) {
          // Theirs: the one nearest our base is the one we have to break first.
          nextEnemyAdvance = advance;
          nextEnemyTurret = entry.unit;
        }
      }

      let enemyChampions = 0;
      for (const enemy of enemies) {
        if (laneOfChampion.get(enemy) === lane) enemyChampions++;
      }

      const state: LaneState = {
        lane,
        alliedMinions,
        enemyMinions,
        frontier,
        nextEnemyTurret,
        ownTurret,
        ownTurretHealthPct: healthFraction(ownTurret),
        enemyTurretHealthPct: healthFraction(nextEnemyTurret),
        enemyChampions,
        need: 0,
      };
      state.need = laneNeed(state);
      lanes.set(lane, state);
    }
    return lanes;
  }

  /**
   * Which lane each of this team's bots takes, remembered between rebuilds.
   *
   * The memory is what makes `LANE_SWITCH_MARGIN` mean anything: without a
   * record of where a bot already is there is no incumbent, and the assignment
   * is recomputed from scratch four times a second off numbers that move with
   * every wave.
   */
  private refreshLaneAssignments(
    teamId: unknown,
    allies: readonly Champion[],
    lanes: ReadonlyMap<string, LaneState>
  ): ReadonlyMap<Champion, string> {
    // Roster order, which is spawn order — not a uuid, so the answer is the
    // same on every machine and a test can assert it. `filter` cannot narrow
    // here (see the note on the object pass above), so this is a plain loop.
    const bots: Champion[] = [];
    for (const ally of allies) {
      if (ally.isBot) bots.push(ally);
    }

    const needs = new Map<string, number>();
    for (const [lane, state] of lanes) needs.set(lane, state.need);

    let remembered = this.laneMemories.get(teamId);
    if (!remembered) {
      remembered = new Map<Champion, string>();
      this.laneMemories.set(teamId, remembered);
    }

    const assigned = assignLanes(bots, needs, remembered);
    remembered.clear();
    for (const [bot, lane] of assigned) remembered.set(bot, lane);
    return assigned;
  }

  private refreshMemory(
    teamId: unknown,
    allies: readonly Champion[],
    enemies: readonly Champion[],
    nowMs: number,
    sees: SeesFn
  ): ReadonlyMap<Champion, SeenEnemy> {
    let memory = this.memories.get(teamId);
    if (!memory) {
      memory = new Map<Champion, SeenEnemy>();
      this.memories.set(teamId, memory);
    }

    for (const enemy of enemies) {
      let spotted = false;
      for (const ally of allies) {
        // Break on the first ally who can see it: one pair of eyes is the whole
        // question, and the rest of the team costs nothing to skip.
        if (sees(ally, enemy)) {
          spotted = true;
          break;
        }
      }
      if (!spotted) continue;
      memory.set(enemy, {
        unit: enemy,
        atMs: nowMs,
        pos: { x: enemy.position.x, y: enemy.position.y },
        vel: targetVelocity(enemy),
      });
    }

    for (const [unit, entry] of memory) {
      if (unit.isDead || unit.toRemove || nowMs - entry.atMs > MEMORY_MAX_MS) memory.delete(unit);
    }

    return memory;
  }
}

const boards = new WeakMap<object, TeamBlackboard>();

/**
 * The board for this game, rebuilt if the window has elapsed.
 *
 * `sees` is injectable only so tests can be deterministic. In the game it is
 * always the honest `canSee` — the board holds what a team legitimately knows,
 * and must not carry one difficulty tier's privileges, because every tier reads
 * this same object.
 */
export function blackboardFor(
  game: BlackboardHost,
  nowMs: number,
  sees: SeesFn = defaultSees
): TeamBlackboard {
  let board = boards.get(game as object);
  if (!board) {
    board = new TeamBlackboard();
    boards.set(game as object, board);
  }
  board.refreshIfStale(game, nowMs, sees);
  return board;
}

/** The enemy the most allies are already committed to; ties go to the weakest. */
function pickFocus(allies: readonly Champion[], enemies: readonly Champion[]): Champion | null {
  if (enemies.length === 0) return null;

  const votes = new Map<Champion, number>();
  for (const ally of allies) {
    const target = ally.basicAttack?.target;
    if (target instanceof Champion && target.teamId !== ally.teamId) {
      votes.set(target, (votes.get(target) ?? 0) + 1);
    }
  }

  let best: Champion | null = null;
  let bestVotes = -1;
  let bestHealth = Number.POSITIVE_INFINITY;
  for (const enemy of enemies) {
    const count = votes.get(enemy) ?? 0;
    const health = effectiveHealth(enemy);
    if (count > bestVotes || (count === bestVotes && health < bestHealth)) {
      best = enemy;
      bestVotes = count;
      bestHealth = health;
    }
  }
  return best;
}

/**
 * Where a turret stands, worked out once and kept.
 *
 * A turret is `isImmovable` and re-anchors every frame, so its lane and its
 * place along that lane are properties of the map rather than of the tick. A
 * destroyed one rebuilds where it stood, so this survives that too.
 */
const turretPlaces = new WeakMap<Turret, { lane: string; progress: number } | null>();

function turretPlacement(turret: Turret): { lane: string; progress: number } | null {
  const known = turretPlaces.get(turret);
  if (known !== undefined) return known;

  const nearest = nearestLane(turret.position.x, turret.position.y);
  // Same `!== null` reasoning as `laneOfChampion` above: unreachable on a
  // laneless map today (distance is `Infinity` there), stated so rather than
  // trusted.
  const placed =
    nearest.distance <= LANE_MEMBERSHIP_PX && nearest.lane !== null
      ? { lane: nearest.lane, progress: nearest.progress }
      : null;
  turretPlaces.set(turret, placed);
  return placed;
}

/**
 * How much of a structure is left, as a fraction.
 *
 * **No turret reads as 0, not as 1.** An undefended lane is the urgent case,
 * and `laneNeed` prices `1 - pct`; handing it 1 would make a lane whose turrets
 * are all rubble look exactly as calm as one behind three full-health ones.
 */
const healthFraction = (unit: AttackableUnit | null): number => {
  if (!unit) return 0;
  const max = unit.stats.maxHealth.value;
  return max > 0 ? Math.max(0, Math.min(1, unit.stats.health.value / max)) : 0;
};

function centroid(units: readonly Champion[]): Vec2 | null {
  if (units.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const unit of units) {
    x += unit.position.x;
    y += unit.position.y;
  }
  return { x: x / units.length, y: y / units.length };
}

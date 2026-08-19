import Champion from '@/game/gameObject/attackableUnits/Champion';
import { effectiveHealth } from '@/game/combat/ExecuteTargeting';
import { canSee, type Seeable } from '@/game/combat/Vision';
import { targetVelocity } from '@/game/ai/AimPredictor';
import type GameObject from '@/game/gameObject/GameObject';
import type { Vec2 } from '@/game/spell/runtime/types';

/**
 * One shared snapshot of the match, rebuilt at most once per tick and read by
 * every bot on both teams — rosters, who the team is focusing, where it is
 * clustered, and a memory of where each enemy was last seen. This is what
 * turns bots from five independent agents into two teams.
 *
 * The memory records *terrain-honest* shared team sight, always — it is never
 * widened by a bot's `seesThroughTerrain`. A later difficulty tier gets to see
 * through walls at its own acquisition step (Task 6), but that privilege must
 * not leak into this object: three tiers read the same board, so it cannot
 * carry one tier's advantage. `sees` is injectable only so tests can be
 * deterministic; in the game it is always the honest `canSee`.
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
});

const defaultSees: SeesFn = (observer, target) =>
  canSee(observer as unknown as Seeable, target as unknown as Seeable);

export class TeamBlackboard {
  private views = new Map<unknown, TeamView>();
  private memories = new Map<unknown, Map<Champion, SeenEnemy>>();
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
    const living: Champion[] = [];
    for (const object of game.objectManager?.objects ?? []) {
      if (!(object instanceof Champion)) continue;
      // `instanceof Champion` is not "is a champion": `Pet extends Champion`
      // (Tibbers, Shaco's box and clone, Jinx's chomper, Malzahar's voidling)
      // and so does `Zed_W_Clone`, and every one of them carries its summoner's
      // `teamId`. Counting them made `enemies.length - allies.length >= 2` fire
      // on summons and send healthy bots home, dragged `rally` toward a
      // stationary box, and let `pickFocus` hand the whole team a Zed shadow to
      // converge on. `killCredit` is the discriminator the codebase already
      // treats as authoritative for exactly this question — `Pet` sets it to
      // `'none'` *because* `instanceof` cannot tell them apart (see CLAUDE.md).
      if (object.killCredit !== 'champion') continue;
      if (object.isDead || object.toRemove) continue;
      living.push(object);
    }

    const teams = new Set<unknown>();
    for (const champion of living) teams.add(champion.teamId);

    this.views.clear();
    for (const teamId of teams) {
      const allies: Champion[] = [];
      const enemies: Champion[] = [];
      for (const champion of living) {
        if (champion.teamId === teamId) allies.push(champion);
        else enemies.push(champion);
      }
      this.views.set(teamId, {
        allies,
        enemies,
        focusTarget: pickFocus(allies, enemies),
        rally: centroid(allies),
        memory: this.refreshMemory(teamId, allies, enemies, nowMs, sees),
      });
    }
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

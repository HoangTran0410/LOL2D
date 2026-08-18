import { CURSOR_ACQUISITION_RADIUS } from '@/game/combat/AttackTargeting';
import { effectiveRange } from '@/game/combat/Reach';
import { canSee, type Seeable } from '@/game/combat/Vision';
import { vecDist } from '@/utils/math.utils';
import type { CancelReason, CastContext, TargetingMode, Vec2 } from '@/game/spell/runtime/types';

export type TargetTeam = 'ALLY' | 'ENEMY' | 'ANY';

export interface TargetInfo {
  readonly position: Vec2;
  readonly teamId?: unknown;
  readonly selectionRadius?: number;
}

export const defaultIsTargetable = (candidate: unknown): boolean =>
  typeof candidate === 'object' &&
  candidate !== null &&
  (candidate as { targetable?: boolean }).targetable === true &&
  (candidate as { toRemove?: boolean }).toRemove !== true;

export const defaultTargetInfo = (candidate: unknown): TargetInfo | null => {
  if (typeof candidate !== 'object' || candidate === null) return null;
  const target = candidate as {
    position?: Vec2;
    teamId?: unknown;
    selectionRadius?: number;
    collisionRadius?: number;
    animatedValues?: { displaySize?: number };
  };
  if (!target.position) return null;
  return {
    position: target.position,
    teamId: target.teamId,
    selectionRadius:
      target.selectionRadius ??
      target.collisionRadius ??
      (target.animatedValues?.displaySize ?? 0) / 2,
  };
};

export interface TargetRequest {
  readonly spellId: string;
  readonly activationId: string;
  readonly startedAtMs: number;
  readonly caster: unknown;
  readonly casterTeamId?: unknown;
  readonly origin: Vec2;
  readonly cursorWorld: Vec2;
  readonly range?: number;
  readonly targetTeam?: TargetTeam;
  /**
   * How far from the cursor UNIT mode reaches for a body, in world units.
   *
   * Defaults to `CURSOR_ACQUISITION_RADIUS` — deliberately the *same* number an
   * attack order acquires with, so "point roughly at him and press" means one
   * thing in this game rather than one thing per spell. A spell that genuinely
   * needs the cursor on the body can ask for a smaller one; none currently do.
   *
   * The unit's own `selectionRadius` still counts, so a body larger than the
   * acquisition circle is never harder to click than a small one.
   */
  readonly acquisitionRadius?: number;

  /**
   * Which of the in-range candidates to take when the cursor is not on anybody.
   * Handed everything the spell could legally hit, plus the one this resolver
   * would have chosen by itself (the nearest to the cursor) so an opinionated
   * spell only has to state the part it cares about.
   *
   * Never consulted while the player *is* aiming at someone: aim is not
   * overruled, only answered when there was none — the rule
   * `BasicAttack.acquire` already follows.
   */
  readonly pickWithoutAim?: (
    candidates: readonly unknown[],
    nearestToCursor: unknown
  ) => unknown | undefined;

  readonly queryCandidates?: () => readonly unknown[];
  readonly isTargetable?: (candidate: unknown) => boolean;
  readonly getTargetInfo?: (candidate: unknown) => TargetInfo | null;
}

export type TargetingRequest = Partial<
  Pick<
    TargetRequest,
    | 'range'
    | 'targetTeam'
    | 'acquisitionRadius'
    | 'pickWithoutAim'
    | 'queryCandidates'
    | 'isTargetable'
    | 'getTargetInfo'
  >
>;

export type TargetResolution =
  | { readonly ok: true; readonly context: CastContext }
  | {
      readonly ok: false;
      readonly reason: Extract<CancelReason, 'TARGET_INVALID' | 'OUT_OF_RANGE'>;
    };

const distance = (a: Vec2, b: Vec2): number => vecDist(a, b);

const matchesTeam = (request: TargetRequest, teamId: unknown): boolean => {
  const relation = request.targetTeam ?? 'ANY';
  if (relation === 'ANY') return true;
  if (request.casterTeamId === undefined || teamId === undefined) return false;
  return relation === 'ALLY' ? teamId === request.casterTeamId : teamId !== request.casterTeamId;
};

const createContext = (request: TargetRequest, target?: unknown): CastContext => {
  const origin = Object.freeze({ x: request.origin.x, y: request.origin.y });
  const cursorWorld = Object.freeze({
    x: request.cursorWorld.x,
    y: request.cursorWorld.y,
  });
  const dx = cursorWorld.x - origin.x;
  const dy = cursorWorld.y - origin.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  return Object.freeze({
    spellId: request.spellId,
    activationId: request.activationId,
    startedAtMs: request.startedAtMs,
    caster: request.caster,
    origin,
    cursorWorld,
    direction: Object.freeze({
      x: length === 0 ? 0 : dx / length,
      y: length === 0 ? 0 : dy / length,
    }),
    ...(target === undefined ? {} : { target }),
  });
};

export class TargetResolver {
  static resolve(mode: TargetingMode, request: TargetRequest): TargetResolution {
    if (mode === 'SELF') return { ok: true, context: createContext(request, request.caster) };

    // POINT deliberately keeps the authored range. Its far end is a spot on the
    // ground, which has no body to push the caster away from it, so a bigger
    // caster does not get to nominate a further one.
    if (
      mode === 'POINT' &&
      request.range !== undefined &&
      distance(request.origin, request.cursorWorld) > request.range
    ) {
      return { ok: false, reason: 'OUT_OF_RANGE' };
    }

    if (mode !== 'UNIT') return { ok: true, context: createContext(request) };

    const candidates = request.queryCandidates?.() ?? [];
    const isTargetable = request.isTargetable ?? defaultIsTargetable;
    const getTargetInfo = request.getTargetInfo ?? defaultTargetInfo;
    const acquisitionRadius = Math.max(0, request.acquisitionRadius ?? CURSOR_ACQUISITION_RADIUS);
    let hadIneligibleByRange = false;

    // Two tiers, and the split is the whole of this method.
    //
    // The acquisition circle used to be a *filter*: a unit further from the
    // cursor than `acquisitionRadius` was dropped outright, so a minion well
    // inside the spell's range but on the far side of the caster from the
    // cursor made the key do nothing at all. Range is the only thing that
    // decides what a spell may hit; the cursor decides which of those it takes.
    const inRange: unknown[] = [];
    let aimedAt: unknown;
    let aimedDistance = Number.POSITIVE_INFINITY;
    let nearestToCursor: unknown;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
      if (!candidate || !isTargetable(candidate)) continue;
      const info = getTargetInfo(candidate);
      if (!info) continue;
      if (!matchesTeam(request, info.teamId)) {
        continue;
      }
      // UNIT range is measured centre to centre against a body that separation
      // holds at arm's length, so both ends pay for their excess size here.
      // Reading it off the candidate rather than off TargetInfo means the
      // spells that supply their own getTargetInfo stay size-aware for free.
      //
      // Checked before the cursor now rather than after: it is what sets
      // `hadIneligibleByRange`, and behind the old cursor filter an out-of-range
      // enemy the player was pointing away from reported TARGET_INVALID.
      if (
        request.range !== undefined &&
        distance(request.origin, info.position) >
          effectiveRange(request.range, request.caster, candidate)
      ) {
        hadIneligibleByRange = true;
        continue;
      }

      // You cannot nominate what you cannot see. One gate covering every
      // UNIT-mode spell at once: each of them feeds its own `queryCandidates`
      // and not one of those queries had ever asked about the fog.
      //
      // Below the range check on purpose. An enemy who is both out of range and
      // out of sight is out of *range* as far as the player is concerned — put
      // above, this would swallow `hadIneligibleByRange` and turn every such
      // press into TARGET_INVALID.
      if (!canSee(request.caster as Seeable, candidate as Seeable)) continue;

      inRange.push(candidate);
      const cursorDistance = distance(request.cursorWorld, info.position);
      if (cursorDistance < nearestDistance) {
        nearestToCursor = candidate;
        nearestDistance = cursorDistance;
      }

      // "The player is pointing at this one" — the same reach an attack order
      // acquires with, so aiming means one thing in this game rather than one
      // thing per spell. A body bigger than the circle is never harder to click.
      if (cursorDistance > Math.max(info.selectionRadius ?? 0, acquisitionRadius)) continue;
      if (cursorDistance < aimedDistance) {
        aimedAt = candidate;
        aimedDistance = cursorDistance;
      }
    }

    if (aimedAt !== undefined) {
      return { ok: true, context: createContext(request, aimedAt) };
    }
    if (inRange.length > 0) {
      const chosen = request.pickWithoutAim?.(inRange, nearestToCursor) ?? nearestToCursor;
      return { ok: true, context: createContext(request, chosen) };
    }
    return {
      ok: false,
      reason: hadIneligibleByRange ? 'OUT_OF_RANGE' : 'TARGET_INVALID',
    };
  }

  resolve(mode: TargetingMode, request: TargetRequest): TargetResolution {
    return TargetResolver.resolve(mode, request);
  }
}

export default TargetResolver;

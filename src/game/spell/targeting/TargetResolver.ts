import { CURSOR_ACQUISITION_RADIUS } from '../../combat/AttackTargeting';
import { effectiveRange } from '../../combat/Reach';
import type { CancelReason, CastContext, TargetingMode, Vec2 } from '../runtime/types';

export type TargetTeam = 'ALLY' | 'ENEMY' | 'ANY';

export interface TargetInfo {
  readonly position: Vec2;
  readonly teamId?: unknown;
  readonly selectionRadius?: number;
}

export const defaultIsTargetable = (candidate: unknown): boolean =>
  typeof candidate === 'object' && candidate !== null &&
  (candidate as { targetable?: boolean }).targetable !== false;

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
    selectionRadius: target.selectionRadius ?? target.collisionRadius ??
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
  readonly queryCandidates?: () => readonly unknown[];
  readonly isTargetable?: (candidate: unknown) => boolean;
  readonly getTargetInfo?: (candidate: unknown) => TargetInfo | null;
}

export type TargetingRequest = Partial<Pick<TargetRequest,
  'range' | 'targetTeam' | 'acquisitionRadius' | 'queryCandidates' | 'isTargetable' | 'getTargetInfo'
>>;

export type TargetResolution =
  | { readonly ok: true; readonly context: CastContext }
  | { readonly ok: false; readonly reason: Extract<CancelReason, 'TARGET_INVALID' | 'OUT_OF_RANGE'> };

const distance = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);

const matchesTeam = (request: TargetRequest, teamId: unknown): boolean => {
  const relation = request.targetTeam ?? 'ANY';
  if (relation === 'ANY') return true;
  if (request.casterTeamId === undefined || teamId === undefined) return false;
  return relation === 'ALLY'
    ? teamId === request.casterTeamId
    : teamId !== request.casterTeamId;
};

const createContext = (request: TargetRequest, target?: unknown): CastContext => {
  const origin = Object.freeze({ x: request.origin.x, y: request.origin.y });
  const cursorWorld = Object.freeze({
    x: request.cursorWorld.x,
    y: request.cursorWorld.y,
  });
  const dx = cursorWorld.x - origin.x;
  const dy = cursorWorld.y - origin.y;
  const length = Math.hypot(dx, dy);
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
    if (mode === 'POINT' && request.range !== undefined &&
        distance(request.origin, request.cursorWorld) > request.range) {
      return { ok: false, reason: 'OUT_OF_RANGE' };
    }

    if (mode !== 'UNIT') return { ok: true, context: createContext(request) };

    const candidates = request.queryCandidates?.() ?? [];
    const acquisitionRadius = Math.max(0, request.acquisitionRadius ?? CURSOR_ACQUISITION_RADIUS);
    let hadIneligibleByRange = false;
    let bestTarget: unknown;
    let bestCursorDistance = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
      const info = request.getTargetInfo?.(candidate);
      if (!info) continue;
      const cursorDistance = distance(request.cursorWorld, info.position);
      // The cursor acquires a body the way an attack order does, rather than
      // demanding a hit on the ~27px selection circle. Before this, Janna E and
      // W refused to fire unless you were exactly on a body, while Lee Sin W
      // looked like it had smarter targeting — it does not; it declares
      // `targeting: 'SELF'`, a mode that never consults the cursor at all.
      if (cursorDistance > Math.max(info.selectionRadius ?? 0, acquisitionRadius)) continue;
      if (request.isTargetable?.(candidate) === false || !matchesTeam(request, info.teamId)) {
        continue;
      }
      // UNIT range is measured centre to centre against a body that separation
      // holds at arm's length, so both ends pay for their excess size here.
      // Reading it off the candidate rather than off TargetInfo means the
      // spells that supply their own getTargetInfo stay size-aware for free.
      if (
        request.range !== undefined &&
        distance(request.origin, info.position) >
          effectiveRange(request.range, request.caster, candidate)
      ) {
        hadIneligibleByRange = true;
        continue;
      }

      if (cursorDistance < bestCursorDistance) {
        bestTarget = candidate;
        bestCursorDistance = cursorDistance;
      }
    }

    if (bestTarget !== undefined) {
      return { ok: true, context: createContext(request, bestTarget) };
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

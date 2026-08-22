import { Rectangle } from '@/libs/quadtree';
import { withinRadiusCoords } from '@/utils/math.utils';
import type { Vec2 } from '@/game/spell/runtime/types';
import SpellObject from '@/game/gameObject/SpellObject';
import AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import { PredefinedFilters } from '@/game/managers/ObjectManager';

export interface BeamGeometry {
  readonly start: Vec2;
  readonly end: Vec2;
  readonly width: number;
}

export type BeamTarget = AttackableUnit;

interface BeamOptions {
  candidates?: () => Iterable<AttackableUnit>;
  candidateFilter?: (target: AttackableUnit) => boolean;
  hitTest?: (target: AttackableUnit, geometry: BeamGeometry) => boolean;
  onHit?: (target: AttackableUnit) => void;
  instant?: boolean;
  durationMs?: number;
}

/**
 * The rectangle a beam occupies, padded by its half-width. Shared so anything
 * that has to be culled by the beam rather than by its caster — the damage
 * volume here, one beam ultimate's visual — measures the same box.
 */
export const beamBoundingBox = (geometry: BeamGeometry, data: unknown): Rectangle => {
  const padding = geometry.width / 2;
  return new Rectangle({
    x: Math.min(geometry.start.x, geometry.end.x) - padding,
    y: Math.min(geometry.start.y, geometry.end.y) - padding,
    w: Math.abs(geometry.end.x - geometry.start.x) + padding * 2,
    h: Math.abs(geometry.end.y - geometry.start.y) + padding * 2,
    data,
  });
};

export const intersectsBeam = (target: BeamTarget, geometry: BeamGeometry): boolean => {
  const dx = geometry.end.x - geometry.start.x;
  const dy = geometry.end.y - geometry.start.y;
  const lengthSquared = dx * dx + dy * dy;
  const projection =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((target.position.x - geometry.start.x) * dx +
              (target.position.y - geometry.start.y) * dy) /
              lengthSquared
          )
        );
  const nearestX = geometry.start.x + dx * projection;
  const nearestY = geometry.start.y + dy * projection;
  const maxDist = geometry.width / 2 + target.collisionRadius;
  return withinRadiusCoords(target.position.x, target.position.y, nearestX, nearestY, maxDist);
};

export default class BeamSpellObject extends SpellObject {
  readonly hitTargets = new Set<AttackableUnit>();
  readonly geometry: BeamGeometry;
  elapsedMs = 0;
  private readonly candidates?: () => Iterable<AttackableUnit>;
  private readonly candidateFilter: (target: AttackableUnit) => boolean;
  private readonly hitTest: (target: AttackableUnit, geometry: BeamGeometry) => boolean;
  private readonly onTargetHit: (target: AttackableUnit) => void;
  private readonly instant: boolean;
  private readonly durationMs?: number;

  constructor(owner: AttackableUnit, geometry: BeamGeometry, options: BeamOptions = {}) {
    super(owner);
    this.geometry = geometry;
    this.candidates = options.candidates;
    this.candidateFilter = options.candidateFilter ?? (() => true);
    this.hitTest = options.hitTest ?? intersectsBeam;
    this.onTargetHit = options.onHit ?? (() => undefined);
    this.instant = options.instant ?? true;
    if (!this.instant && (!Number.isFinite(options.durationMs) || options.durationMs! <= 0)) {
      throw new Error('durationMs must be finite and greater than 0');
    }
    this.durationMs = options.durationMs;
  }

  update(deltaMs = deltaTime): void {
    if (this.toRemove) return;
    for (const target of this.queryCandidates()) {
      if (this.hitTargets.has(target) || !this.candidateFilter(target)) continue;
      if (!this.hitTest(target, this.geometry)) continue;
      this.hitTargets.add(target);
      this.onTargetHit(target);
    }
    if (this.instant) {
      this.toRemove = true;
    } else {
      this.elapsedMs = Math.min(this.durationMs!, this.elapsedMs + Math.max(0, deltaMs));
      if (this.elapsedMs >= this.durationMs!) this.toRemove = true;
    }
  }

  getDisplayBoundingBox(): Rectangle {
    return beamBoundingBox(this.geometry, this);
  }

  private queryCandidates(): Iterable<AttackableUnit> {
    if (this.candidates) return this.candidates();
    return this.game.objectManager.queryObjects({
      area: this.getDisplayBoundingBox(),
      filters: [PredefinedFilters.type(AttackableUnit)],
    });
  }
}

import { Rectangle } from '../../../libs/quadtree';
import type { Vec2 } from '../../spell/runtime/types';
import SpellObject from '../SpellObject';
import AttackableUnit from '../attackableUnits/AttackableUnit';
import { PredefinedFilters } from '../../managers/ObjectManager';

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

export const intersectsBeam = (target: BeamTarget, geometry: BeamGeometry): boolean => {
  const dx = geometry.end.x - geometry.start.x;
  const dy = geometry.end.y - geometry.start.y;
  const lengthSquared = dx * dx + dy * dy;
  const projection = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1,
      ((target.position.x - geometry.start.x) * dx +
        (target.position.y - geometry.start.y) * dy) / lengthSquared));
  const nearestX = geometry.start.x + dx * projection;
  const nearestY = geometry.start.y + dy * projection;
  return Math.hypot(target.position.x - nearestX, target.position.y - nearestY) <=
    geometry.width / 2 + target.collisionRadius;
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

  constructor(
    owner: AttackableUnit,
    geometry: BeamGeometry,
    options: BeamOptions = {}
  ) {
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
    const padding = this.geometry.width / 2;
    const minX = Math.min(this.geometry.start.x, this.geometry.end.x) - padding;
    const minY = Math.min(this.geometry.start.y, this.geometry.end.y) - padding;
    return new Rectangle({
      x: minX,
      y: minY,
      w: Math.abs(this.geometry.end.x - this.geometry.start.x) + padding * 2,
      h: Math.abs(this.geometry.end.y - this.geometry.start.y) + padding * 2,
      data: this,
    });
  }

  private queryCandidates(): Iterable<AttackableUnit> {
    if (this.candidates) return this.candidates();
    return this.game.objectManager.queryObjects({
      area: this.getDisplayBoundingBox(),
      filters: [PredefinedFilters.type(AttackableUnit)],
    });
  }
}

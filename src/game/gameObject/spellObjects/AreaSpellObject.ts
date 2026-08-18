import { Circle, Rectangle } from '@/libs/quadtree';
import { withinRadius } from '@/utils/math.utils';
import type { Vec2 } from '@/game/spell/runtime/types';
import SpellObject from '@/game/gameObject/SpellObject';
import AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import { PredefinedFilters } from '@/game/managers/ObjectManager';

export type AreaTarget = AttackableUnit;

interface AreaOptions {
  candidates?: () => Iterable<AttackableUnit>;
  candidateFilter?: (target: AttackableUnit) => boolean;
  tickEveryMs?: number;
  durationMs?: number;
  radiusAt?: (elapsedMs: number) => number;
  onEnter?: (target: AttackableUnit) => void;
  onTick?: (target: AttackableUnit) => void;
  onExit?: (target: AttackableUnit) => void;
}

export default class AreaSpellObject extends SpellObject {
  readonly center: Vec2;
  readonly members = new Set<AttackableUnit>();
  radius: number;
  elapsedMs = 0;
  private tickAccumulatorMs = 0;
  private readonly candidates?: () => Iterable<AttackableUnit>;
  private readonly candidateFilter: (target: AttackableUnit) => boolean;
  private readonly tickEveryMs?: number;
  private readonly durationMs?: number;
  private readonly radiusAt?: (elapsedMs: number) => number;
  private readonly enter: (target: AttackableUnit) => void;
  private readonly tick: (target: AttackableUnit) => void;
  private readonly exit: (target: AttackableUnit) => void;

  constructor(owner: AttackableUnit, center: Vec2, radius: number, options: AreaOptions = {}) {
    super(owner);
    this.validateInterval('tickEveryMs', options.tickEveryMs);
    this.validateInterval('durationMs', options.durationMs);
    this.center = center;
    this.radius = radius;
    this.candidates = options.candidates;
    this.candidateFilter = options.candidateFilter ?? (() => true);
    this.tickEveryMs = options.tickEveryMs;
    this.durationMs = options.durationMs;
    this.radiusAt = options.radiusAt;
    this.enter = options.onEnter ?? (() => undefined);
    this.tick = options.onTick ?? (() => undefined);
    this.exit = options.onExit ?? (() => undefined);
  }

  update(deltaMs = deltaTime): void {
    if (this.toRemove) return;
    const remainingMs =
      this.durationMs === undefined
        ? Number.POSITIVE_INFINITY
        : Math.max(0, this.durationMs - this.elapsedMs);
    const elapsed = Math.min(Math.max(0, deltaMs), remainingMs);
    this.elapsedMs += elapsed;
    if (this.radiusAt) this.radius = Math.max(0, this.radiusAt(this.elapsedMs));

    const current = new Set<AttackableUnit>();
    for (const target of this.queryCandidates()) {
      if (current.has(target) || !this.candidateFilter(target) || !this.contains(target)) continue;
      current.add(target);
      if (!this.members.has(target)) this.enter(target);
    }
    for (const target of this.members) {
      if (!current.has(target)) this.exit(target);
    }
    this.members.clear();
    for (const target of current) this.members.add(target);

    if (this.tickEveryMs !== undefined) {
      this.tickAccumulatorMs += elapsed;
      while (this.tickAccumulatorMs >= this.tickEveryMs) {
        this.tickAccumulatorMs -= this.tickEveryMs;
        for (const target of this.members) this.tick(target);
      }
    }
    if (this.durationMs !== undefined && this.elapsedMs >= this.durationMs) {
      this.toRemove = true;
    }
  }

  onRemoved(): void {
    for (const target of this.members) this.exit(target);
    this.members.clear();
  }

  getDisplayBoundingBox(): Rectangle {
    return new Rectangle({
      x: this.center.x - this.radius,
      y: this.center.y - this.radius,
      w: this.radius * 2,
      h: this.radius * 2,
      data: this,
    });
  }

  private contains(target: AttackableUnit): boolean {
    return withinRadius(target.position, this.center, this.radius + target.collisionRadius);
  }

  private queryCandidates(): Iterable<AttackableUnit> {
    if (this.candidates) return this.candidates();
    return this.game.objectManager.queryObjects({
      area: new Circle({ x: this.center.x, y: this.center.y, r: this.radius }),
      filters: [PredefinedFilters.type(AttackableUnit)],
    });
  }

  private validateInterval(field: string, value: number | undefined): void {
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
      throw new Error(`${field} must be finite and greater than 0`);
    }
  }
}

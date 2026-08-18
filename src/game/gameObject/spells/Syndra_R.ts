import { Circle } from '@/libs/quadtree';
import AssetManager from '@/managers/AssetManager';
import { effectiveRange, withinRange } from '@/game/combat/Reach';
import { PredefinedFilters } from '@/game/managers/ObjectManager';
import type { CastContext, CastSpec } from '@/game/spell/runtime/types';
import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import Spell from '@/game/gameObject/Spell';
import SpellObject from '@/game/gameObject/SpellObject';
import {
  groundedSpheres,
  SPHERE_CORE_RADIUS,
  SPHERE_DARK,
  SPHERE_EDGE,
  SPHERE_VIOLET,
  Syndra_Burst,
} from './Syndra_Q';

/**
 * Syndra R — every sphere she owns collapses onto one champion and is spent.
 *
 * The number the player has been banking all match is the payout, so the effect
 * has to *be* that number: each sphere is drawn travelling from the exact patch
 * of ground it was lying on to the victim. One generic burst on the target would
 * throw away the only information the ability carries.
 */

export const SYNDRA_R_RANGE = 450;
export const SYNDRA_R_CONVERGE_MS = 450;
export const SYNDRA_R_BASE = 20;
export const SYNDRA_R_PER_SPHERE = 12;
export const SYNDRA_R_MAX = 56;
export const SYNDRA_R_IMPACT_RADIUS = 70;

function convergedDamage(spheres: number): number {
  return Math.min(SYNDRA_R_MAX, SYNDRA_R_BASE + spheres * SYNDRA_R_PER_SPHERE);
}

export default class Syndra_R extends Spell {
  image = AssetManager.get('spell_syndra_r');
  name = 'Bùng Nổ Sức Mạnh (Syndra_R)';
  description = `Dồn toàn bộ quả cầu đang nằm trên đất vào một tướng địch:
    <span class="damage">${SYNDRA_R_BASE} sát thương</span> cộng thêm
    <span class="damage">${SYNDRA_R_PER_SPHERE}</span> mỗi quả cầu, tối đa
    <span class="damage">${SYNDRA_R_MAX}</span>. Các quả cầu bị tiêu hao.`;
  coolDown = 10_000;
  manaCost = 100;
  range = SYNDRA_R_RANGE;

  /** The badge is the payout she is holding, which is why it lives on this icon too. */
  get stackCount(): number {
    return groundedSpheres(this.owner).length;
  }

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'UNIT',
      castTimeMs: 180,
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'release', durationMs: this.coolDown },
    };
  }

  onSpellCast(context?: CastContext): void {
    const target = this.pickTarget(context);
    if (!target) return;

    const origins: { x: number; y: number }[] = [];
    for (const sphere of groundedSpheres(this.owner)) {
      origins.push({ x: sphere.position.x, y: sphere.position.y });
      sphere.toRemove = true;
    }

    this.game.objectManager.addObject(new Syndra_R_Strike(this.owner, target, origins));
  }

  /**
   * The cursor's champion when the runtime handed us one, otherwise the closest
   * enemy she can actually see — picking a victim is exactly the query that has
   * to respect the fog.
   */
  private pickTarget(context?: CastContext): AttackableUnit | null {
    const supplied = context?.target as AttackableUnit | undefined;
    if (
      supplied &&
      !supplied.toRemove &&
      !supplied.isDead &&
      withinRange(this.range, this.owner, supplied)
    ) {
      return supplied;
    }

    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: effectiveRange(this.range, this.owner),
      }),
      filters: [
        PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
        PredefinedFilters.visibleTo(this.owner),
      ],
    }) as AttackableUnit[];

    let chosen: AttackableUnit | null = null;
    let bestGap = Infinity;
    for (const candidate of candidates) {
      const gap = Math.hypot(
        candidate.position.x - this.owner.position.x,
        candidate.position.y - this.owner.position.y
      );
      if (gap >= bestGap) continue;
      bestGap = gap;
      chosen = candidate;
    }
    return chosen;
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}

/**
 * The convergence. It owns the whole ability's timing and its one damage event,
 * and it draws as many spheres as it is going to be paid for.
 */
export class Syndra_R_Strike extends SpellObject {
  target: AttackableUnit;
  origins: { x: number; y: number }[];
  radius = SYNDRA_R_IMPACT_RADIUS;
  lifeTime = SYNDRA_R_CONVERGE_MS;
  age = 0;
  landed = false;
  shards: { angle: number; drift: number }[] = [];

  constructor(owner: AttackableUnit, target: AttackableUnit, origins: { x: number; y: number }[]) {
    super(owner);
    this.target = target;
    this.origins = origins;
    this.position = createVector(target.position.x, target.position.y);
  }

  onAdded(): void {
    super.onAdded();
    const count = 6;
    for (let i = 0; i < count; i++) {
      this.shards.push({
        angle: (TWO_PI * i) / count + random(-0.3, 0.3),
        drift: random(0.7, 1.7),
      });
    }
  }

  update(): void {
    this.age += deltaTime;
    this.position.x = this.target.position.x;
    this.position.y = this.target.position.y;

    if (this.age < this.lifeTime) return;
    if (!this.landed) this.land();
    this.toRemove = true;
  }

  private land(): void {
    this.landed = true;
    if (this.target.toRemove || this.target.isDead) return;

    this.target.takeDamage(convergedDamage(this.origins.length), this.owner);
    this.game.objectManager.addObject(
      new Syndra_Burst(
        this.owner,
        this.target.position.x,
        this.target.position.y,
        SYNDRA_R_IMPACT_RADIUS,
        380
      )
    );
  }

  draw(): void {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const closing = t * t;
    const cx = this.position.x;
    const cy = this.position.y;
    const core = SPHERE_CORE_RADIUS * (1 - 0.35 * closing);

    push();

    noFill();
    stroke(SPHERE_VIOLET[0], SPHERE_VIOLET[1], SPHERE_VIOLET[2], 90 + 120 * t);
    strokeWeight(2);
    circle(cx, cy, SYNDRA_R_IMPACT_RADIUS * 2 * (1 - 0.55 * closing));

    for (const origin of this.origins) {
      const px = origin.x + (cx - origin.x) * closing;
      const py = origin.y + (cy - origin.y) * closing;

      stroke(SPHERE_VIOLET[0], SPHERE_VIOLET[1], SPHERE_VIOLET[2], 150 * (1 - closing) + 60);
      strokeWeight(core * 0.7);
      line(origin.x, origin.y, px, py);

      noStroke();
      fill(SPHERE_DARK[0], SPHERE_DARK[1], SPHERE_DARK[2], 240);
      circle(px, py, core * 2);
      fill(SPHERE_VIOLET[0], SPHERE_VIOLET[1], SPHERE_VIOLET[2], 225);
      circle(px, py, core * 1.3);
      noFill();
      stroke(SPHERE_EDGE[0], SPHERE_EDGE[1], SPHERE_EDGE[2], 235);
      strokeWeight(1.6);
      circle(px, py, core * 2);

      for (const shard of this.shards) {
        const angle = shard.angle + (this.age / 110) * shard.drift;
        const out = core + 4 + 9 * (1 - closing);
        stroke(SPHERE_DARK[0], SPHERE_DARK[1], SPHERE_DARK[2], 220);
        strokeWeight(2);
        line(
          px + cos(angle) * (core + 2),
          py + sin(angle) * (core + 2),
          px + cos(angle) * out,
          py + sin(angle) * out
        );
      }
    }

    pop();
  }

  getDisplayBoundingBox() {
    let span = SYNDRA_R_IMPACT_RADIUS + 40;
    for (const origin of this.origins) {
      span = Math.max(
        span,
        Math.hypot(origin.x - this.position.x, origin.y - this.position.y) + 60
      );
    }
    return this.squareDisplayBoundingBox(span * 2);
  }
}

import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec, TargetingRequest } from '@moba2d/core/content/types';
import { makeGroundedSpheres, makeSyndra_Burst } from './Syndra_Q';
import { SPHERE_CORE_RADIUS, SPHERE_DARK, SPHERE_EDGE, SPHERE_VIOLET } from './Syndra_Q';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TargetResolver = InstanceType<ContentApi['combat']['TargetResolver']>;
type Syndra_R = InstanceType<ReturnType<typeof makeSyndra_R>>;
type Syndra_R_Strike = InstanceType<ReturnType<typeof makeSyndra_R_Strike>>;
type Syndra_Burst = InstanceType<ReturnType<typeof makeSyndra_Burst>>;



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


function __buildSyndra_R(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const withinRange = api.combat.Reach.withinRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const TargetResolver = api.combat.TargetResolver;
  const AttackableUnit = api.units.AttackableUnit;
  const Spell = api.Spell;
  const groundedSpheres = makeGroundedSpheres(api);
  const Syndra_R_Strike = makeSyndra_R_Strike(api);
  class Syndra_R extends Spell {
    image = api.asset('spell_syndra_r');
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
        resource: { commitAt: 'release', refundOn: ['TARGET_INVALID', 'OUT_OF_RANGE'] },
        cooldown: { startAt: 'release', durationMs: this.coolDown },
      };
    }

    get targetingRequest(): Readonly<TargetingRequest> {
      return {
        range: effectiveRange(this.range, this.owner),
        targetTeam: 'ENEMY',
        queryCandidates: () => this.game.objectManager.objects,
        isTargetable: candidate => this.isValidTarget(candidate),
        getTargetInfo: candidate =>
          this.isValidTarget(candidate)
            ? {
                position: candidate.position,
                teamId: candidate.teamId,
                selectionRadius: candidate.animatedValues?.displaySize
                  ? candidate.animatedValues.displaySize / 2
                  : candidate.collisionRadius,
              }
            : null,
      };
    }

    private isValidTarget(target?: unknown): target is AttackableUnit {
      return (
        target instanceof AttackableUnit &&
        !target.isDead &&
        !target.toRemove &&
        target !== this.owner &&
        target.teamId !== this.owner.teamId &&
        withinRange(this.range, this.owner, target)
      );
    }

    checkCastCondition(): boolean {
      return !!this.pickTarget(this.castContext);
    }

    press(context: CastContext): boolean {
      if (context.target !== undefined) {
        if (!this.isValidTarget(context.target as AttackableUnit)) return false;
        return super.press(context);
      }

      const result = TargetResolver.resolve('UNIT', {
        ...context,
        casterTeamId: this.owner.teamId,
        ...this.targetingRequest,
      });
      return result.ok ? super.press(result.context) : false;
    }

    onSpellCast(context?: CastContext): void {
      const target = this.pickTarget(context);
      if (!target) return;

      const origins: { x: number; y: number }[] = [];
      const grounded = groundedSpheres(this.owner);
      const groundedCount = grounded.length;

      for (const sphere of grounded) {
        origins.push({ x: sphere.position.x, y: sphere.position.y });
        sphere.toRemove = true;
      }

      // Baseline 3 dark spheres for visual barrage if no grounded spheres exist
      if (origins.length === 0) {
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2;
          origins.push({
            x: this.owner.position.x + Math.cos(a) * 50,
            y: this.owner.position.y + Math.sin(a) * 50,
          });
        }
      }

      this.game.objectManager.addObject(new Syndra_R_Strike(this.owner, target, origins, groundedCount));
    }

    /**
     * The cursor's champion when the runtime handed us one, otherwise the closest
     * enemy she can actually see — picking a victim is exactly the query that has
     * to respect the fog.
     */
    private pickTarget(context?: CastContext): AttackableUnit | null {
      const supplied = context?.target as AttackableUnit | undefined;
      if (this.isValidTarget(supplied)) {
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
  return Syndra_R;
}
const __cacheSyndra_R = new WeakMap<ContentApi, ReturnType<typeof __buildSyndra_R>>();
export default function makeSyndra_R(api: ContentApi) {
  const cached = __cacheSyndra_R.get(api);
  if (cached) return cached;
  const built = __buildSyndra_R(api);
  __cacheSyndra_R.set(api, built);
  return built;
}


const STAGGER_MS = 60;

const FLIGHT_MS = 250;


/**
 * The convergence. It fires spheres in sequential waves flying into the target,
 * dealing sequential damage impacts and culminating in an explosion.
 */
function __buildSyndra_R_Strike(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  const Syndra_Burst = makeSyndra_Burst(api);
  class Syndra_R_Strike extends SpellObject {
    target: AttackableUnit;
    origins: { x: number; y: number }[];
    groundedCount: number;
    radius = SYNDRA_R_IMPACT_RADIUS;
    lifeTime: number;
    age = 0;
    private hitFlags: boolean[];
    shards: { angle: number; drift: number }[] = [];

    constructor(
      owner: AttackableUnit,
      target: AttackableUnit,
      origins: { x: number; y: number }[],
      groundedCount?: number
    ) {
      super(owner);
      this.target = target;
      this.origins = origins;
      this.groundedCount = groundedCount ?? origins.length;
      this.hitFlags = new Array(origins.length).fill(false);
      this.lifeTime = (origins.length - 1) * STAGGER_MS + FLIGHT_MS + 200;
      this.position = createVector(target.position.x, target.position.y);
    }

    onAdded(): void {
      super.onAdded();
      const count = 8;
      for (let i = 0; i < count; i++) {
        this.shards.push({
          angle: (TWO_PI * i) / count + random(-0.3, 0.3),
          drift: random(0.8, 1.8),
        });
      }
    }

    update(): void {
      this.age += deltaTime;
      this.position.x = this.target.position.x;
      this.position.y = this.target.position.y;

      const totalDamage = convergedDamage(this.groundedCount);
      const n = Math.max(1, this.origins.length);
      const baseChunk = Math.floor(totalDamage / n);
      const lastChunk = totalDamage - baseChunk * (n - 1);

      for (let i = 0; i < this.origins.length; i++) {
        const arriveTime = i * STAGGER_MS + FLIGHT_MS;
        if (this.age >= arriveTime && !this.hitFlags[i]) {
          this.hitFlags[i] = true;
          if (!this.target.toRemove && !this.target.isDead) {
            const dmg = i === this.origins.length - 1 ? lastChunk : baseChunk;
            this.target.takeDamage(dmg, this.owner);
            this.game.objectManager.addObject(
              new Syndra_Burst(
                this.owner,
                this.target.position.x,
                this.target.position.y,
                45,
                260
              )
            );
            if (i === this.origins.length - 1) {
              this.game.objectManager.addObject(
                new Syndra_Burst(
                  this.owner,
                  this.target.position.x,
                  this.target.position.y,
                  SYNDRA_R_IMPACT_RADIUS,
                  420
                )
              );
            }
          }
        }
      }

      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const cx = this.position.x;
      const cy = this.position.y;

      push();
      noFill();

      // 1. Dark aura under the victim
      stroke(SPHERE_VIOLET[0], SPHERE_VIOLET[1], SPHERE_VIOLET[2], 140);
      strokeWeight(2.5);
      circle(cx, cy, SYNDRA_R_IMPACT_RADIUS * 2 * (1 - 0.2 * sin(this.age / 120)));
      fill(SPHERE_DARK[0], SPHERE_DARK[1], SPHERE_DARK[2], 45);
      circle(cx, cy, SYNDRA_R_IMPACT_RADIUS * 2);

      // 2. Sequential sphere flight
      for (let i = 0; i < this.origins.length; i++) {
        if (this.hitFlags[i]) continue;
        const origin = this.origins[i];
        const startTime = i * STAGGER_MS;
        const arriveTime = startTime + FLIGHT_MS;

        let px = origin.x;
        let py = origin.y;
        let flightRatio = 0;

        if (this.age < startTime) {
          // Charging at origin before launch
          const chargePulse = 1 + 0.18 * sin(this.age / 70 + i);
          noStroke();
          fill(SPHERE_VIOLET[0], SPHERE_VIOLET[1], SPHERE_VIOLET[2], 90);
          circle(px, py, SPHERE_CORE_RADIUS * 2.5 * chargePulse);
          fill(SPHERE_DARK[0], SPHERE_DARK[1], SPHERE_DARK[2], 240);
          circle(px, py, SPHERE_CORE_RADIUS * 2 * chargePulse);
          stroke(SPHERE_EDGE[0], SPHERE_EDGE[1], SPHERE_EDGE[2], 220);
          strokeWeight(1.8);
          noFill();
          circle(px, py, SPHERE_CORE_RADIUS * 2 * chargePulse);
          continue;
        }

        flightRatio = constrain((this.age - startTime) / FLIGHT_MS, 0, 1);
        const closing = flightRatio * flightRatio;
        const arcHeight = Math.sin(flightRatio * Math.PI) * -35;

        px = origin.x + (cx - origin.x) * closing;
        py = origin.y + (cy - origin.y) * closing + arcHeight;

        // Energy trail behind flying sphere
        stroke(SPHERE_VIOLET[0], SPHERE_VIOLET[1], SPHERE_VIOLET[2], 180 * (1 - flightRatio) + 70);
        strokeWeight(SPHERE_CORE_RADIUS * 0.9);
        line(origin.x, origin.y, px, py);

        // Dark sphere body
        noStroke();
        fill(SPHERE_DARK[0], SPHERE_DARK[1], SPHERE_DARK[2], 250);
        circle(px, py, SPHERE_CORE_RADIUS * 2.2);

        // Violet inner fire
        fill(SPHERE_VIOLET[0], SPHERE_VIOLET[1], SPHERE_VIOLET[2], 235);
        circle(px, py, SPHERE_CORE_RADIUS * 1.4);

        // Electric white rim
        noFill();
        stroke(SPHERE_EDGE[0], SPHERE_EDGE[1], SPHERE_EDGE[2], 245);
        strokeWeight(2);
        circle(px, py, SPHERE_CORE_RADIUS * 2.2);

        // Dark lightning shards
        for (const shard of this.shards) {
          const angle = shard.angle + (this.age / 90) * shard.drift;
          const out = SPHERE_CORE_RADIUS + 8 + 12 * (1 - closing);
          stroke(SPHERE_VIOLET[0], SPHERE_VIOLET[1], SPHERE_VIOLET[2], 230);
          strokeWeight(2);
          line(
            px + cos(angle) * (SPHERE_CORE_RADIUS + 2),
            py + sin(angle) * (SPHERE_CORE_RADIUS + 2),
            px + cos(angle) * out,
            py + sin(angle) * out
          );
        }
      }

      pop();
    }

    getDisplayBoundingBox() {
      let span = SYNDRA_R_IMPACT_RADIUS + 80;
      for (const origin of this.origins) {
        span = Math.max(
          span,
          Math.hypot(origin.x - this.position.x, origin.y - this.position.y) + 80
        );
      }
      return this.squareDisplayBoundingBox(span * 2);
    }
  }
  return Syndra_R_Strike;
}
const __cacheSyndra_R_Strike = new WeakMap<ContentApi, ReturnType<typeof __buildSyndra_R_Strike>>();
export function makeSyndra_R_Strike(api: ContentApi) {
  const cached = __cacheSyndra_R_Strike.get(api);
  if (cached) return cached;
  const built = __buildSyndra_R_Strike(api);
  __cacheSyndra_R_Strike.set(api, built);
  return built;
}
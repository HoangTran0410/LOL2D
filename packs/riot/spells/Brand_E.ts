import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec, TargetingRequest } from '@moba2d/core/content/types';
import { makeApplyAblaze } from './Brand_Q';
import { isAblaze } from './Brand_Q';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TargetResolver = InstanceType<ContentApi['combat']['TargetResolver']>;
type Brand_E = InstanceType<ReturnType<typeof makeBrand_E>>;
type Brand_E_Object = InstanceType<ReturnType<typeof makeBrand_E_Object>>;



/**
 * Conflagration. A blast on one enemy that jumps to everyone standing near
 * them; the Blaze bonus doubles how far it jumps, which is what turns a
 * single-target poke into a wave clear once the first target is burning.
 *
 * The spread is an area effect, not an acquisition — it takes everyone it
 * overlaps, bush or no bush. Only the *primary* target is chosen, and that
 * choice runs through `TargetResolver`, which applies the vision gate.
 */
export const COOLDOWN_MS = 9_000;

export const MANA_COST = 40;

export const RANGE = 420;

export const DAMAGE = 22;

export const SPREAD_RADIUS = 130;

/** Blaze bonus: the flame jumps twice as far off an already-burning target. */
export const ABLAZE_SPREAD_RADIUS = 260;


function __buildBrand_E(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const withinRange = api.combat.Reach.withinRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const AttackableUnit = api.units.AttackableUnit;
  const TargetResolver = api.combat.TargetResolver;
  const canSee = api.combat.Vision.canSee;
  const applyAblaze = makeApplyAblaze(api);
  const isBurnTarget = makeIsBurnTarget(api);
  const Brand_E_Object = makeBrand_E_Object(api);
  class Brand_E extends Spell {
    image = api.asset('spell_brand_e');
    name = 'Bùng Cháy (Brand_E)';
    description = `Đốt cháy một kẻ địch, gây <span class="damage">${DAMAGE} sát thương</span> rồi lan sang mọi kẻ địch trong bán kính <span class="buff">${SPREAD_RADIUS}</span> với cùng sát thương, đồng thời <span class="buff">Thiêu Đốt</span> tất cả. Nếu mục tiêu chính <span class="buff">đã bị Thiêu Đốt</span>, tầm lan xa gấp đôi (<span class="buff">${ABLAZE_SPREAD_RADIUS}</span>).`;
    coolDown = COOLDOWN_MS;
    manaCost = MANA_COST;

    range = RANGE;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'UNIT',
        resource: { commitAt: 'release', refundOn: ['TARGET_INVALID', 'OUT_OF_RANGE'] },
        cooldown: { startAt: 'release', durationMs: this.coolDown },
      };
    }

    get targetingRequest(): Readonly<TargetingRequest> {
      return {
        range: this.range,
        targetTeam: 'ENEMY',
        queryCandidates: () => this.game.objectManager.objects,
        isTargetable: candidate => isBurnTarget(candidate),
        getTargetInfo: candidate =>
          isBurnTarget(candidate)
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

    press(context: CastContext): boolean {
      if (context.target !== undefined) return super.press(context);

      const result = TargetResolver.resolve('UNIT', {
        ...context,
        casterTeamId: this.owner.teamId,
        ...this.targetingRequest,
      });
      return result.ok ? super.press(result.context) : false;
    }

    checkCastCondition(): boolean {
      return this.isValidTarget(this.castContext?.target);
    }

    onUpdate(): void {
      if (this.state === 'CASTING' && !this.isValidTarget(this.castContext?.target)) {
        this.cancel('TARGET_INVALID');
      }
    }

    onSpellCast(context: CastContext): void {
      const primary = context.target;
      if (!isBurnTarget(primary)) return;

      // read before igniting, or the flame always spreads at the doubled radius
      const spreadRadius = isAblaze(primary) ? ABLAZE_SPREAD_RADIUS : SPREAD_RADIUS;

      const caught = this.game.objectManager.queryObjects({
        area: new Circle({ x: primary.position.x, y: primary.position.y, r: spreadRadius }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });

      // one damage pass per unit, primary included exactly once
      const victims: AttackableUnit[] = [primary];
      for (const unit of caught) if (unit !== primary) victims.push(unit);

      for (const victim of victims) {
        victim.takeDamage(DAMAGE, this.owner);
        applyAblaze(this.owner, victim, this.image);
      }

      const blast = new Brand_E_Object(this.owner, primary, spreadRadius);
      blast.spreadTo = victims.filter(victim => victim !== primary);
      this.game.objectManager.addObject(blast);
    }

    drawPreview(): void {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }

    private isValidTarget(target: unknown): target is AttackableUnit {
      return (
        isBurnTarget(target) &&
        canSee(this.owner, target) &&
        target.teamId !== this.owner.teamId &&
        withinRange(this.range, this.owner, target)
      );
    }
  }
  return Brand_E;
}
const __cacheBrand_E = new WeakMap<ContentApi, ReturnType<typeof __buildBrand_E>>();
export default function makeBrand_E(api: ContentApi) {
  const cached = __cacheBrand_E.get(api);
  if (cached) return cached;
  const built = __buildBrand_E(api);
  __cacheBrand_E.set(api, built);
  return built;
}


function __buildisBurnTarget(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const isBurnTarget = (target: unknown): target is AttackableUnit =>
    target instanceof AttackableUnit && target.targetable && !target.toRemove && !target.isDead;
  return isBurnTarget;
}
const __cacheisBurnTarget = new WeakMap<ContentApi, ReturnType<typeof __buildisBurnTarget>>();
export function makeIsBurnTarget(api: ContentApi) {
  const cached = __cacheisBurnTarget.get(api);
  if (cached) return cached;
  const built = __buildisBurnTarget(api);
  __cacheisBurnTarget.set(api, built);
  return built;
}


/** The blast, and the arcs of fire leaping off it. */
function __buildBrand_E_Object(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  class Brand_E_Object extends SpellObject {
    target: AttackableUnit;
    spreadTo: AttackableUnit[] = [];
    spreadRadius: number;

    age = 0;
    lifeTime = 560;

    /** Kinks in each arc, seeded once so the fire crawls instead of flickering. */
    _kinks: number[] = [];

    constructor(owner: AttackableUnit, target: AttackableUnit, spreadRadius: number) {
      super(owner);
      this.target = target;
      this.spreadRadius = spreadRadius;
      this.position = target.position.copy();
    }

    onAdded() {
      for (let i = 0; i < 24; i++) this._kinks.push(random(-0.35, 0.35));
    }

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
      if (!this.target.isDead && !this.target.toRemove) {
        this.position.set(this.target.position.x, this.target.position.y);
      }
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      // 1-(1-t)^2: the fire leaps out fast, then burns down
      const out = 1 - (1 - t) * (1 - t);
      const alpha = 255 * (1 - t * t);

      push();

      // the blast on the primary target
      push();
      translate(this.position.x, this.position.y);
      noStroke();
      fill(210, 55, 15, alpha * 0.5);
      circle(0, 0, 70 * (0.5 + out));
      fill(255, 150, 40, alpha * 0.6);
      circle(0, 0, 46 * (0.5 + out));
      fill(255, 245, 205, alpha * 0.8 * (1 - t));
      circle(0, 0, 24 * (0.6 + out * 0.5));
      pop();

      // arcs of fire crawling out to everyone the flame caught
      noFill();
      for (let i = 0; i < this.spreadTo.length; i++) {
        const victim = this.spreadTo[i];
        const bx = victim.position.x;
        const by = victim.position.y;
        // each arc reaches its victim in the first two thirds of the life
        const reach = constrain(out * 1.5, 0, 1);

        for (const [colour, weight] of [
          [[150, 25, 5, alpha * 0.7], 8],
          [[255, 165, 45, alpha * 0.9], 4],
          [[255, 250, 225, alpha * 0.8], 1.5],
        ] as [number[], number][]) {
          (stroke as any)(...colour);
          strokeWeight(weight);
          beginShape();
          for (let k = 0; k <= 6; k++) {
            const u = (k / 6) * reach;
            const kink = this._kinks[(i * 7 + k) % this._kinks.length];
            // perpendicular wobble => a licking flame, not a straight wire
            const px = this.position.x + (bx - this.position.x) * u;
            const py = this.position.y + (by - this.position.y) * u;
            const nx = -(by - this.position.y);
            const ny = bx - this.position.x;
            const bow = kink * 0.18 * 4 * u * (1 - u);
            vertex(px + nx * bow, py + ny * bow);
          }
          endShape();
        }

        // the catch: a small bloom on the victim once the arc arrives
        if (reach >= 1) {
          noStroke();
          fill(255, 170, 60, alpha * 0.55);
          circle(bx, by, 34 * (1 - t));
          noFill();
        }
      }

      pop();
    }

    getDisplayBoundingBox() {
      // the arcs reach out to the full spread radius, and bow past it
      const r = this.spreadRadius + 60;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Brand_E_Object;
}
const __cacheBrand_E_Object = new WeakMap<ContentApi, ReturnType<typeof __buildBrand_E_Object>>();
export function makeBrand_E_Object(api: ContentApi) {
  const cached = __cacheBrand_E_Object.get(api);
  if (cached) return cached;
  const built = __buildBrand_E_Object(api);
  __cacheBrand_E_Object.set(api, built);
  return built;
}
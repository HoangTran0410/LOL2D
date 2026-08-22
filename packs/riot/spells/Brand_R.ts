import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec, TargetingRequest } from '@moba2d/core/content/types';
import { makeApplyAblaze } from './Brand_Q';
import { isAblaze } from './Brand_Q';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Champion = InstanceType<ContentApi['units']['Champion']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TargetResolver = InstanceType<ContentApi['combat']['TargetResolver']>;
type Brand_R = InstanceType<ReturnType<typeof makeBrand_R>>;
type Brand_R_Fireball = InstanceType<ReturnType<typeof makeBrand_R_Fireball>>;



/**
 * Pyroclasm. A fireball thrown at one enemy that then keeps jumping to whoever
 * is nearest, five hits in all, pausing a beat between each so the bounces are
 * legible instead of resolving in one frame.
 *
 * Every bounce *picks* a unit, which is exactly the case
 * `PredefinedFilters.visibleTo` exists for. The PC ability deliberately bounces
 * to targets Brand cannot see; that is dropped here rather than opening a hole
 * in the vision seam for one ultimate.
 */
export const COOLDOWN_MS = 10_000;

export const MANA_COST = 60;

export const RANGE = 500;

/** How far the fireball will jump looking for its next victim. */
export const BOUNCE_RADIUS = 320;

/** Hits in total, the first one included: 60 damage if they all land on one body. */
export const BOUNCE_COUNT = 5;

export const DAMAGE_PER_BOUNCE = 12;

export const BOUNCE_DELAY_MS = 150;

export const MISSILE_SPEED = 13;

/** Blaze bonus: a burning victim is slowed by each bounce that hits them. */
export const SLOW_PERCENT = 0.4;

export const SLOW_DURATION_MS = 800;


function __buildBrand_R(api: ContentApi) {
  const effectiveRange = api.combat.Reach.effectiveRange;
  const withinRange = api.combat.Reach.withinRange;
  const Spell = api.Spell;
  const AttackableUnit = api.units.AttackableUnit;
  const TargetResolver = api.combat.TargetResolver;
  const canSee = api.combat.Vision.canSee;
  const isBounceTarget = makeIsBounceTarget(api);
  const Brand_R_Fireball = makeBrand_R_Fireball(api);
  class Brand_R extends Spell {
    image = api.asset('spell_brand_r');
    name = 'Bão Lửa (Brand_R)';
    description = `Ném một quả cầu lửa nảy qua lại giữa các kẻ địch <span class="buff">${BOUNCE_COUNT} lần</span>, mỗi lần gây <span class="damage">${DAMAGE_PER_BOUNCE} sát thương</span> và <span class="buff">Thiêu Đốt</span>. Mục tiêu <span class="buff">đã bị Thiêu Đốt</span> còn bị <span class="buff">Làm Chậm ${Math.round(SLOW_PERCENT * 100)}%</span> trong <span class="time">${SLOW_DURATION_MS / 1000} giây</span>. Ưu tiên nảy vào tướng đang cháy.`;
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
        isTargetable: candidate => isBounceTarget(candidate),
        getTargetInfo: candidate =>
          isBounceTarget(candidate)
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
      const target = context.target;
      if (!isBounceTarget(target)) return;

      const fireball = new Brand_R_Fireball(this.owner, target);
      this.game.objectManager.addObject(fireball);
    }

    drawPreview(): void {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }

    private isValidTarget(target: unknown): target is AttackableUnit {
      return (
        isBounceTarget(target) &&
        canSee(this.owner, target) &&
        target.teamId !== this.owner.teamId &&
        withinRange(this.range, this.owner, target)
      );
    }
  }
  return Brand_R;
}
const __cacheBrand_R = new WeakMap<ContentApi, ReturnType<typeof __buildBrand_R>>();
export default function makeBrand_R(api: ContentApi) {
  const cached = __cacheBrand_R.get(api);
  if (cached) return cached;
  const built = __buildBrand_R(api);
  __cacheBrand_R.set(api, built);
  return built;
}


function __buildisBounceTarget(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const isBounceTarget = (target: unknown): target is AttackableUnit =>
    target instanceof AttackableUnit && target.targetable && !target.toRemove && !target.isDead;
  return isBounceTarget;
}
const __cacheisBounceTarget = new WeakMap<ContentApi, ReturnType<typeof __buildisBounceTarget>>();
export function makeIsBounceTarget(api: ContentApi) {
  const cached = __cacheisBounceTarget.get(api);
  if (cached) return cached;
  const built = __buildisBounceTarget(api);
  __cacheisBounceTarget.set(api, built);
  return built;
}


function __buildBrand_R_Fireball(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const BuffAddType = api.enums.BuffAddType;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  const Champion = api.units.Champion;
  const Slow = api.buffs.Slow;
  const applyAblaze = makeApplyAblaze(api);
  class Brand_R_Fireball extends SpellObject {
    image = api.asset('spell_brand_r');

    target: AttackableUnit | null;
    /** Hits still owed, this one included. */
    bouncesLeft = BOUNCE_COUNT;
    speed = MISSILE_SPEED;
    size = 34;

    /** Set between bounces: the fireball hangs a beat so each jump is readable. */
    pauseLeft = 0;
    age = 0;
    /** Where the current flight started, so the tail can be drawn behind it. */
    origin: p5.Vector;

    _tongues: { phase: number; length: number }[] = [];

    constructor(owner: AttackableUnit, target: AttackableUnit) {
      super(owner);
      this.target = target;
      this.position = owner.position.copy();
      this.origin = owner.position.copy();
    }

    onAdded() {
      for (let i = 0; i < 9; i++) {
        this._tongues.push({ phase: random(TWO_PI), length: random(0.5, 1.35) });
      }
    }

    update() {
      this.age += deltaTime;

      if (this.pauseLeft > 0) {
        this.pauseLeft -= deltaTime;
        return;
      }

      const target = this.target;
      if (!target || target.isDead || target.toRemove) {
        this.toRemove = true;
        return;
      }

      const destination = target.position;
      const step = Math.hypot(destination.x - this.position.x, destination.y - this.position.y);
      const arrivalRadius = target.collisionRadius + this.size / 2;

      if (step <= Math.max(arrivalRadius, this.speed)) {
        this.position.set(destination.x, destination.y);
        this._strike(target);
        return;
      }

      this.position.set(
        this.position.x + ((destination.x - this.position.x) / step) * this.speed,
        this.position.y + ((destination.y - this.position.y) / step) * this.speed
      );
    }

    _strike(victim: AttackableUnit) {
      // read before igniting, or the first hit slows off its own burn
      const wasAblaze = isAblaze(victim);

      victim.takeDamage(DAMAGE_PER_BOUNCE, this.owner);
      applyAblaze(this.owner, victim, this.image);

      if (wasAblaze) {
        const slow = new Slow(SLOW_DURATION_MS, this.owner, victim);
        slow.buffAddType = BuffAddType.RENEW_EXISTING;
        slow.percent = SLOW_PERCENT;
        victim.addBuff(slow);
      }

      this.bouncesLeft -= 1;
      if (this.bouncesLeft <= 0) {
        this.toRemove = true;
        return;
      }

      const next = this._pickNextTarget(victim);
      if (!next) {
        this.toRemove = true;
        return;
      }

      this.target = next;
      this.origin = createVector(this.position.x, this.position.y);
      this.pauseLeft = BOUNCE_DELAY_MS;
    }

    /**
     * Who the fireball jumps to: a burning champion first, then any champion,
     * then anything else, and only then back to the body it just left.
     *
     * `visibleTo` because this *picks* a unit — the seam every self-targeting
     * scan in this codebase has to pass through.
     */
    _pickNextTarget(justHit: AttackableUnit): AttackableUnit | null {
      const candidates = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.position.x, y: this.position.y, r: BOUNCE_RADIUS }),
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
          PredefinedFilters.excludeStealthed,
          PredefinedFilters.visibleTo(this.owner),
        ],
      });

      let best: AttackableUnit | null = null;
      let bestScore = -1;
      let bestGap = Infinity;

      for (const candidate of candidates) {
        if (candidate === justHit) continue;
        const burning = isAblaze(candidate);
        const champion = candidate instanceof Champion;
        const score = (burning && champion ? 4 : 0) + (champion ? 2 : 0) + (burning ? 1 : 0);
        const gap = Math.hypot(
          candidate.position.x - this.position.x,
          candidate.position.y - this.position.y
        );
        if (score > bestScore || (score === bestScore && gap < bestGap)) {
          best = candidate;
          bestScore = score;
          bestGap = gap;
        }
      }

      // Alone with one enemy, the real ability bounces off Brand and back. Here it
      // simply returns to the same body, which is the same rhythm without needing
      // the caster to be a legal bounce target.
      if (!best && !justHit.isDead && !justHit.toRemove) return justHit;
      return best;
    }

    draw() {
      const flicker = 1 + 0.14 * sin(this.age / 60);
      const charging = this.pauseLeft > 0;
      // it swells while it hangs between bounces, so the pause reads as a wind-up
      const swell = charging ? 1.25 : 1;

      push();
      translate(this.position.x, this.position.y);
      noStroke();

      // tongues of flame licking off the ball in every direction
      for (let i = 0; i < this._tongues.length; i++) {
        const tongue = this._tongues[i];
        const angle = (TWO_PI * i) / this._tongues.length + this.age / 400;
        const length = this.size * tongue.length * (1 + 0.25 * sin(this.age / 80 + tongue.phase));
        fill(215, 60, 15, 120);
        ellipse(
          (cos(angle) * length) / 2,
          (sin(angle) * length) / 2,
          length * 0.6 * swell,
          length * 0.35 * swell
        );
      }

      fill(190, 40, 10, 200);
      circle(0, 0, this.size * 1.9 * flicker * swell);
      fill(255, 130, 30, 240);
      circle(0, 0, this.size * 1.25 * flicker * swell);
      fill(255, 245, 205, 250);
      circle(0, 0, this.size * 0.55 * flicker * swell);

      // how many jumps are left, ringed around the ball
      noFill();
      stroke(255, 220, 160, 190);
      strokeWeight(2);
      for (let i = 0; i < this.bouncesLeft; i++) {
        const a = -HALF_PI + (TWO_PI * i) / BOUNCE_COUNT;
        const r = this.size * 1.35;
        point(cos(a) * r, sin(a) * r);
        circle(cos(a) * r, sin(a) * r, 5);
      }

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.size * 2.4;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Brand_R_Fireball;
}
const __cacheBrand_R_Fireball = new WeakMap<ContentApi, ReturnType<typeof __buildBrand_R_Fireball>>();
export function makeBrand_R_Fireball(api: ContentApi) {
  const cached = __cacheBrand_R_Fireball.get(api);
  if (cached) return cached;
  const built = __buildBrand_R_Fireball(api);
  __cacheBrand_R_Fireball.set(api, built);
  return built;
}
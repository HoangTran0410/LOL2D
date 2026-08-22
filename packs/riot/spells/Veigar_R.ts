import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec, TargetingRequest } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type HomingMissileSpellObject = InstanceType<ContentApi['HomingMissileSpellObject']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TargetResolver = InstanceType<ContentApi['combat']['TargetResolver']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Veigar_R = InstanceType<ReturnType<typeof makeVeigar_R>>;
type Veigar_R_Burst = InstanceType<ReturnType<typeof makeVeigar_R_Burst>>;
type Veigar_R_Object = InstanceType<ReturnType<typeof makeVeigar_R_Object>>;



type VeigarRTarget = AttackableUnit;


function __buildisVeigarRTarget(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const isVeigarRTarget = (target: unknown): target is VeigarRTarget =>
    target instanceof AttackableUnit && target.targetable && !target.toRemove;
  return isVeigarRTarget;
}
const __cacheisVeigarRTarget = new WeakMap<ContentApi, ReturnType<typeof __buildisVeigarRTarget>>();
export function makeIsVeigarRTarget(api: ContentApi) {
  const cached = __cacheisVeigarRTarget.get(api);
  if (cached) return cached;
  const built = __buildisVeigarRTarget(api);
  __cacheisVeigarRTarget.set(api, built);
  return built;
}


// Exported so the suite asserts the wiring, not a copy of the numbers —
// retuning a value should not mean editing the test.
export const RANGE = 750;

// A LOL2D champion pool is ~100 health, so the raw wiki number (90, doubling to
// 180 on a low target) was a guaranteed one-shot on a full-health champion and
// then some. Scaled to half a health bar on a healthy target: this stays the
// hardest-hitting ultimate in the game without deleting anyone from full.
export const BASE_DAMAGE = 50;

// Damage is multiplied by (1 + MAX_MISSING_HEALTH_MULTIPLIER * missingHealthRatio),
// so a full-health target takes BASE_DAMAGE and a nearly-dead one takes 75. The
// wiki's "up to +100% based on missing health" is halved for the same reason as
// BASE_DAMAGE — a full doubling on a 100-health pool leaves nothing to execute.
export const MAX_MISSING_HEALTH_MULTIPLIER = 0.5;

export const MANA_COST = 100;

export const CAST_TIME_MS = 0;

export const MISSILE_SPEED = 1_500 / 60;

export const MISSILE_SIZE = 30;


function __buildVeigar_R(api: ContentApi) {
  const effectiveRange = api.combat.Reach.effectiveRange;
  const withinRange = api.combat.Reach.withinRange;
  const Spell = api.Spell;
  const TargetResolver = api.combat.TargetResolver;
  const canSee = api.combat.Vision.canSee;
  const isVeigarRTarget = makeIsVeigarRTarget(api);
  const Veigar_R_Object = makeVeigar_R_Object(api);
  class Veigar_R extends Spell {
    image = api.asset('spell_veigar_r');
    name = 'Vụ Nổ Vũ Trụ (Veigar_R)';
    description =
      `Gửi một luồng năng lượng nguyên thủy đến kẻ địch mục tiêu, gây <span class="damage">${BASE_DAMAGE} sát thương</span>,` +
      ` tăng lên tối đa <span class="damage">${BASE_DAMAGE * (1 + MAX_MISSING_HEALTH_MULTIPLIER)} sát thương</span> dựa trên lượng máu đã mất của mục tiêu.`;
    // kept as a literal (not an exported constant) so the repo-wide arcade
    // cooldown-cap scan in tests/game/spells/cooldowns.test.ts can see it
    coolDown = 10_000;
    manaCost = MANA_COST;

    range = RANGE;
    baseDamage = BASE_DAMAGE;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'UNIT',
        castTimeMs: CAST_TIME_MS,
        resource: { commitAt: 'release', refundOn: ['TARGET_INVALID', 'OUT_OF_RANGE'] },
        cooldown: { startAt: 'release', durationMs: this.coolDown },
      };
    }

    get targetingRequest(): Readonly<TargetingRequest> {
      return {
        range: this.range,
        targetTeam: 'ENEMY',
        queryCandidates: () => this.game.objectManager.objects,
        isTargetable: candidate => isVeigarRTarget(candidate),
        getTargetInfo: candidate =>
          isVeigarRTarget(candidate)
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

    checkCastCondition(): boolean {
      return this.isValidTarget(this.castContext?.target);
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

    onUpdate(): void {
      if (this.state === 'CASTING' && !this.isValidTarget(this.castContext?.target)) {
        this.cancel('TARGET_INVALID');
      }
    }

    onSpellCast(context: CastContext): void {
      if (!isVeigarRTarget(context.target)) return;

      const obj = new Veigar_R_Object(this.owner, context.target);
      obj.baseDamage = this.baseDamage;
      this.game.objectManager.addObject(obj);
    }

    drawPreview() {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }

    private isValidTarget(target: unknown): target is VeigarRTarget {
      return (
        isVeigarRTarget(target) &&
        canSee(this.owner, target) &&
        target.teamId !== this.owner.teamId &&
        withinRange(this.range, this.owner, target)
      );
    }
  }
  return Veigar_R;
}
const __cacheVeigar_R = new WeakMap<ContentApi, ReturnType<typeof __buildVeigar_R>>();
export default function makeVeigar_R(api: ContentApi) {
  const cached = __cacheVeigar_R.get(api);
  if (cached) return cached;
  const built = __buildVeigar_R(api);
  __cacheVeigar_R.set(api, built);
  return built;
}


function __buildVeigar_R_Object(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const HomingMissileSpellObject = api.HomingMissileSpellObject;
  const TrailSystem = api.helpers.TrailSystem;
  const Veigar_R_Burst = makeVeigar_R_Burst(api);
  class Veigar_R_Object extends HomingMissileSpellObject {
    speed = MISSILE_SPEED;
    size = MISSILE_SIZE;
    baseDamage = BASE_DAMAGE;
    maxMissingHealthMultiplier = MAX_MISSING_HEALTH_MULTIPLIER;

    trailSystem = new TrailSystem({
      trailColor: '#B23DFF66',
      trailSize: this.size * 0.7,
      trailLifeTime: 260,
    });

    _spin = random(TWO_PI);

    onAfterMove() {
      this._spin += 0.22;
    }

    onTargetArrive(target: AttackableUnit): void {
      const health = target.stats.health.value;
      const maxHealth = target.stats.maxHealth.value;
      const missingRatio = maxHealth > 0 ? constrain(1 - health / maxHealth, 0, 1) : 0;
      const damage = this.baseDamage * (1 + this.maxMissingHealthMultiplier * missingRatio);
      target.takeDamage(damage, this.owner);

      const burst = new Veigar_R_Burst(this.owner);
      burst.position = target.position.copy();
      burst.targetSize = target.animatedValues?.displaySize ?? 40;
      burst.executeRatio = missingRatio;
      this.game.objectManager.addObject(burst);
    }

    draw() {
      const s = this.size;

      push();
      translate(this.position.x, this.position.y);

      // corona: a heavier, more violent halo than the Q orb — this is the ultimate
      blendMode(ADD);
      noStroke();
      fill(140, 30, 200, 70);
      circle(0, 0, s * 2.8);
      fill(230, 60, 150, 45);
      circle(0, 0, s * 1.8);
      blendMode(BLEND);

      rotate(this._spin);

      // a jagged core of compressed chaos rather than a smooth sphere
      stroke(60, 10, 90, 240);
      strokeWeight(2.5);
      fill(150, 40, 210);
      beginShape();
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * TWO_PI;
        const r = s * (i % 2 === 0 ? 0.55 : 0.34);
        vertex(cos(a) * r, sin(a) * r);
      }
      endShape(CLOSE);

      noStroke();
      fill(10, 2, 20);
      circle(0, 0, s * 0.34);

      // tendrils of raw power lashing off the core
      stroke(235, 150, 255, 210);
      strokeWeight(1.6);
      for (let i = 0; i < 5; i++) {
        const a = this._spin * -1.6 + (i * TWO_PI) / 5;
        const r0 = s * 0.4;
        const r1 = s * 0.85 + 6 * Math.abs(sin(this._spin * 2 + i));
        line(cos(a) * r0, sin(a) * r0, cos(a) * r1, sin(a) * r1);
      }

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.size * 1.8;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Veigar_R_Object;
}
const __cacheVeigar_R_Object = new WeakMap<ContentApi, ReturnType<typeof __buildVeigar_R_Object>>();
export function makeVeigar_R_Object(api: ContentApi) {
  const cached = __cacheVeigar_R_Object.get(api);
  if (cached) return cached;
  const built = __buildVeigar_R_Object(api);
  __cacheVeigar_R_Object.set(api, built);
  return built;
}


/** The burst landing — a bigger, angrier cousin of Q's implode; flares redder the closer the kill was. */
function __buildVeigar_R_Burst(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Veigar_R_Burst extends SpellObject {
    targetSize = 40;
    age = 0;
    lifeTime = 480;
    maxRadius = 80;
    /** 0..1 — how much of the bonus execute damage this hit carried. */
    executeRatio = 0;

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;
      // an execute hit runs hotter and redder than a routine one
      const heat = this.executeRatio;

      push();
      translate(this.position.x, this.position.y);

      blendMode(ADD);
      noStroke();
      fill(120 + 100 * heat, 40, 200 - 120 * heat, 170 * fade);
      circle(0, 0, this.targetSize * (0.7 + t * 1.3));
      blendMode(BLEND);

      noFill();
      stroke(220, 150 - 80 * heat, 255 - 120 * heat, 230 * fade);
      strokeWeight(5 * fade + 1);
      circle(0, 0, this.targetSize * 0.5 + this.maxRadius * 2 * t);

      stroke(255, 220 - 100 * heat, 235 - 100 * heat, 220 * fade);
      strokeWeight(2);
      for (let i = 0; i < 8; i++) {
        const a = (i * TWO_PI) / 8 + t * 1.5;
        const r0 = this.targetSize * 0.3 + 18 * t;
        line(cos(a) * r0, sin(a) * r0, cos(a) * (r0 + 20 * fade), sin(a) * (r0 + 20 * fade));
      }
      pop();
    }

    getDisplayBoundingBox() {
      const r = this.targetSize + this.maxRadius * 2;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Veigar_R_Burst;
}
const __cacheVeigar_R_Burst = new WeakMap<ContentApi, ReturnType<typeof __buildVeigar_R_Burst>>();
export function makeVeigar_R_Burst(api: ContentApi) {
  const cached = __cacheVeigar_R_Burst.get(api);
  if (cached) return cached;
  const built = __buildVeigar_R_Burst(api);
  __cacheVeigar_R_Burst.set(api, built);
  return built;
}
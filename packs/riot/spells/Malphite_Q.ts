import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec, TargetingRequest } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type HomingMissileSpellObject = InstanceType<ContentApi['HomingMissileSpellObject']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Speedup = InstanceType<ContentApi['buffs']['Speedup']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TargetResolver = InstanceType<ContentApi['combat']['TargetResolver']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Malphite_Q = InstanceType<ReturnType<typeof makeMalphite_Q>>;
type Malphite_Q_Object = InstanceType<ReturnType<typeof makeMalphite_Q_Object>>;
type Malphite_Q_Rush = InstanceType<ReturnType<typeof makeMalphite_Q_Rush>>;
type Malphite_Q_Shatter = InstanceType<ReturnType<typeof makeMalphite_Q_Shatter>>;
type Malphite_Q_Speedup = InstanceType<ReturnType<typeof makeMalphite_Q_Speedup>>;



type MalphiteTarget = AttackableUnit;


function __buildisMalphiteTarget(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const isMalphiteTarget = (target: unknown): target is MalphiteTarget =>
    target instanceof AttackableUnit && target.targetable && !target.toRemove;
  return isMalphiteTarget;
}
const __cacheisMalphiteTarget = new WeakMap<ContentApi, ReturnType<typeof __buildisMalphiteTarget>>();
export function makeIsMalphiteTarget(api: ContentApi) {
  const cached = __cacheisMalphiteTarget.get(api);
  if (cached) return cached;
  const built = __buildisMalphiteTarget(api);
  __cacheisMalphiteTarget.set(api, built);
  return built;
}


// Exported so the suite asserts the shard's wiring, not a copy of the
// numbers — retuning a value should not mean editing the test.
export const RANGE = 500;

export const DAMAGE = 20;

export const SLOW_PERCENT = 0.2;

export const SLOW_DURATION_MS = 3000;

export const SPEEDUP_DURATION_MS = 3000;

export const CAST_TIME_MS = 0;

export const SPAWN_OFFSET_DISTANCE = 0;

export const MISSILE_SPEED = 5;


function __buildMalphite_Q(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const withinRange = api.combat.Reach.withinRange;
  const Spell = api.Spell;
  const TargetResolver = api.combat.TargetResolver;
  const canSee = api.combat.Vision.canSee;
  const isMalphiteTarget = makeIsMalphiteTarget(api);
  const Malphite_Q_Object = makeMalphite_Q_Object(api);
  class Malphite_Q extends Spell {
    image = api.asset('spell_malphite_q');
    name = 'Mảnh Vỡ Địa Chấn (Malphite_Q)';
    description =
      'Ném một mảnh đá tự bám theo mục tiêu, gây <span class="damage">20 sát thương</span> và <span class="buff">Làm Chậm 20%</span> trong <span class="time">3 giây</span>. Malphite nhận lượng <span class="buff">Tốc Độ Di Chuyển</span> mà mục tiêu thực sự mất trong cùng thời gian';
    coolDown = 8_000;
    manaCost = 70;

    range = RANGE;
    damage = DAMAGE;
    slowPercent = SLOW_PERCENT;
    slowDuration = SLOW_DURATION_MS;
    speedupDuration = SPEEDUP_DURATION_MS;

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
        isTargetable: candidate => isMalphiteTarget(candidate),
        getTargetInfo: candidate =>
          isMalphiteTarget(candidate)
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
      if (!isMalphiteTarget(context.target)) return;

      const obj = new Malphite_Q_Object(this.owner, context.target);
      obj.position = VectorUtils.getVectorWithRange(
        this.owner.position,
        context.target.position,
        SPAWN_OFFSET_DISTANCE,
        false
      ).to;
      obj.damage = this.damage;
      obj.slowPercent = this.slowPercent;
      obj.slowDuration = this.slowDuration;
      obj.speedupDuration = this.speedupDuration;

      this.game.objectManager.addObject(obj);
    }

    drawPreview() {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }

    private isValidTarget(target: unknown): target is MalphiteTarget {
      return (
        isMalphiteTarget(target) &&
        canSee(this.owner, target) &&
        target.teamId !== this.owner.teamId &&
        withinRange(this.range, this.owner, target)
      );
    }
  }
  return Malphite_Q;
}
const __cacheMalphite_Q = new WeakMap<ContentApi, ReturnType<typeof __buildMalphite_Q>>();
export default function makeMalphite_Q(api: ContentApi) {
  const cached = __cacheMalphite_Q.get(api);
  if (cached) return cached;
  const built = __buildMalphite_Q(api);
  __cacheMalphite_Q.set(api, built);
  return built;
}


function __buildMalphite_Q_Object(api: ContentApi) {
  const Slow = api.buffs.Slow;
  const TrailSystem = api.helpers.TrailSystem;
  const HomingMissileSpellObject = api.HomingMissileSpellObject;
  const Malphite_Q_Speedup = makeMalphite_Q_Speedup(api);
  const Malphite_Q_Shatter = makeMalphite_Q_Shatter(api);
  const Malphite_Q_Rush = makeMalphite_Q_Rush(api);
  class Malphite_Q_Object extends HomingMissileSpellObject {
    image = api.asset('spell_malphite_q');
    speed = MISSILE_SPEED;
    size = 24;
    damage = DAMAGE;
    slowPercent = SLOW_PERCENT;
    slowDuration = SLOW_DURATION_MS;
    speedupDuration = SPEEDUP_DURATION_MS;

    trailSystem = new TrailSystem({
      trailColor: '#D7CDF566',
      trailSize: this.size * 0.55,
    });

    _spin = random(TWO_PI);
    /** Cosmetic: chips of rock shaken loose behind the shard. */
    _chips: { x: number; y: number; vx: number; vy: number; age: number; size: number }[] = [];
    _chipTimer = 0;

    onAfterMove() {
      this._spin += 0.15;

      this._chipTimer += deltaTime;
      if (this._chipTimer >= 45 && this._chips.length < 14) {
        this._chipTimer = 0;
        this._chips.push({
          x: this.position.x,
          y: this.position.y,
          vx: random(-0.6, 0.6),
          vy: random(-0.6, 0.6),
          age: 0,
          size: random(3, 7),
        });
      }

      let i = 0;
      while (i < this._chips.length) {
        const c = this._chips[i];
        c.age += deltaTime;
        c.x += c.vx;
        c.y += c.vy;
        if (c.age >= 380) this._chips.splice(i, 1);
        else i++;
      }
    }

    onTargetArrive(target: MalphiteTarget): void {
      const speedBeforeSlow = target.stats.speed.value;
      const slowBuff = new Slow(this.slowDuration, this.owner, target);
      slowBuff.image = this.image;
      slowBuff.percent = this.slowPercent;
      target.addBuff(slowBuff);

      target.takeDamage(this.damage, this.owner);

      const speedupBuff = new Malphite_Q_Speedup(this.speedupDuration, this.owner, this.owner);
      speedupBuff.image = this.image;
      speedupBuff.amount = Math.max(0, speedBeforeSlow - target.stats.speed.value);
      this.owner.addBuff(speedupBuff);

      // show the caster he got the speed-up, tied to that buff's own lifetime
      const rush = new Malphite_Q_Rush(this.owner);
      rush.buff = speedupBuff;
      this.game.objectManager.addObject(rush);

      const shatter = new Malphite_Q_Shatter(this.owner);
      shatter.position = target.position.copy();
      shatter.targetSize = target.animatedValues?.displaySize ?? 40;
      this.game.objectManager.addObject(shatter);
    }

    draw() {
      push();

      // grit trailing the shard
      noStroke();
      for (const c of this._chips) {
        const t = c.age / 380;
        fill(180, 172, 200, 150 * (1 - t));
        circle(c.x, c.y, c.size * (1 - t * 0.6));
      }

      translate(this.position.x, this.position.y);

      // cold halo so the shard pops off the dark ground
      blendMode(ADD);
      noStroke();
      fill(120, 110, 190, 60);
      circle(0, 0, this.size * 2.4);
      blendMode(BLEND);

      rotate(this._spin);

      const s = this.size;

      // a chipped crystal, not a triangle: outline first so it reads on every ground
      stroke(40, 34, 54, 235);
      strokeWeight(2.5);
      fill(150, 140, 182);
      beginShape();
      vertex(0, -s * 0.95);
      vertex(s * 0.42, -s * 0.15);
      vertex(s * 0.3, s * 0.62);
      vertex(-s * 0.34, s * 0.6);
      vertex(-s * 0.46, -s * 0.2);
      endShape(CLOSE);

      // lit facet
      noStroke();
      fill(230, 224, 250);
      beginShape();
      vertex(0, -s * 0.9);
      vertex(s * 0.34, -s * 0.1);
      vertex(0, s * 0.3);
      endShape(CLOSE);

      // shadowed facet
      fill(74, 66, 96);
      beginShape();
      vertex(0, -s * 0.9);
      vertex(-s * 0.4, -s * 0.15);
      vertex(0, s * 0.3);
      endShape(CLOSE);

      // glint
      fill(255, 255, 255, 190);
      triangle(s * 0.06, -s * 0.62, s * 0.2, -s * 0.2, s * 0.02, -s * 0.24);

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.size * 2;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Malphite_Q_Object;
}
const __cacheMalphite_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildMalphite_Q_Object>>();
export function makeMalphite_Q_Object(api: ContentApi) {
  const cached = __cacheMalphite_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildMalphite_Q_Object(api);
  __cacheMalphite_Q_Object.set(api, built);
  return built;
}


function __buildMalphite_Q_Speedup(api: ContentApi) {
  const Speedup = api.buffs.Speedup;
  class Malphite_Q_Speedup extends Speedup {
    amount = 0;

    onCreate(): void {
      super.onCreate();
      this.statsModifier.speed.percentBaseBonus = 0;
      this.statsModifier.speed.flatBonus = this.amount;
    }
  }
  return Malphite_Q_Speedup;
}
const __cacheMalphite_Q_Speedup = new WeakMap<ContentApi, ReturnType<typeof __buildMalphite_Q_Speedup>>();
export function makeMalphite_Q_Speedup(api: ContentApi) {
  const cached = __cacheMalphite_Q_Speedup.get(api);
  if (cached) return cached;
  const built = __buildMalphite_Q_Speedup(api);
  __cacheMalphite_Q_Speedup.set(api, built);
  return built;
}


/** Rock bursting off whoever the shard cut through. */
function __buildMalphite_Q_Shatter(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Malphite_Q_Shatter extends SpellObject {
    targetSize = 40;
    age = 0;
    lifeTime = 400;

    _rocks: { a: number; speed: number; size: number; spin: number }[] = [];

    onAdded() {
      for (let i = 0; i < 8; i++) {
        this._rocks.push({
          a: random(TWO_PI),
          speed: random(0.6, 1.5),
          size: random(5, 11),
          spin: random(-0.4, 0.4),
        });
      }
    }

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;

      push();
      translate(this.position.x, this.position.y);

      // flash on contact
      if (t < 0.3) {
        blendMode(ADD);
        noStroke();
        fill(200, 190, 255, 150 * (1 - t / 0.3));
        circle(0, 0, this.targetSize * 1.2);
        blendMode(BLEND);
      }

      // dust ring showing the impact point
      noFill();
      stroke(220, 214, 245, 235 * fade);
      strokeWeight(5 * fade + 1);
      circle(0, 0, this.targetSize * 0.6 + 70 * t);

      // tumbling rock chunks
      stroke(45, 40, 58, 220 * fade);
      strokeWeight(2);
      fill(140, 130, 168, 235 * fade);
      for (const r of this._rocks) {
        const d = 8 + 55 * t * r.speed;
        push();
        translate(cos(r.a) * d, sin(r.a) * d);
        rotate(r.a + t * r.spin * 10);
        const s = r.size * (1 - t * 0.4);
        triangle(0, -s, s * 0.8, s * 0.6, -s * 0.8, s * 0.6);
        pop();
      }
      pop();
    }

    getDisplayBoundingBox() {
      const r = this.targetSize + 70;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Malphite_Q_Shatter;
}
const __cacheMalphite_Q_Shatter = new WeakMap<ContentApi, ReturnType<typeof __buildMalphite_Q_Shatter>>();
export function makeMalphite_Q_Shatter(api: ContentApi) {
  const cached = __cacheMalphite_Q_Shatter.get(api);
  if (cached) return cached;
  const built = __buildMalphite_Q_Shatter(api);
  __cacheMalphite_Q_Shatter.set(api, built);
  return built;
}


/**
 * Dust kicked up under Malphite while the shard's speed-up lasts. It watches the
 * buff instead of counting its own clock, so it can never outlive it.
 */
function __buildMalphite_Q_Rush(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Malphite_Q_Rush extends SpellObject {
    buff: { toRemove: boolean } | null = null;
    _puffs: { x: number; y: number; age: number; size: number }[] = [];
    _timer = 0;

    update() {
      if (!this.buff || this.buff.toRemove || this.owner.isDead) {
        // let the last puffs fade out before disappearing
        if (this._puffs.length === 0) this.toRemove = true;
      } else {
        this._timer += deltaTime;
        if (this._timer >= 60 && this._puffs.length < 14) {
          this._timer = 0;
          const r = this.owner.animatedValues.displaySize / 2;
          this._puffs.push({
            x: this.owner.position.x + random(-r, r),
            y: this.owner.position.y + random(0, r * 0.7),
            age: 0,
            size: random(8, 16),
          });
        }
      }

      let i = 0;
      while (i < this._puffs.length) {
        const p = this._puffs[i];
        p.age += deltaTime;
        if (p.age >= 500) this._puffs.splice(i, 1);
        else i++;
      }

      this.position.set(this.owner.position.x, this.owner.position.y);
    }

    draw() {
      push();
      noStroke();
      for (const p of this._puffs) {
        const t = p.age / 500;
        fill(190, 182, 210, 120 * (1 - t));
        circle(p.x, p.y - t * 6, p.size * (1 + t));
      }
      pop();
    }

    getDisplayBoundingBox() {
      const r = 90;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Malphite_Q_Rush;
}
const __cacheMalphite_Q_Rush = new WeakMap<ContentApi, ReturnType<typeof __buildMalphite_Q_Rush>>();
export function makeMalphite_Q_Rush(api: ContentApi) {
  const cached = __cacheMalphite_Q_Rush.get(api);
  if (cached) return cached;
  const built = __buildMalphite_Q_Rush(api);
  __cacheMalphite_Q_Rush.set(api, built);
  return built;
}
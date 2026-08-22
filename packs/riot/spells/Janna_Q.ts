import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CancelReason, CastContext, CastSpec } from '@moba2d/core/content/types';
import { makeNotifyJannaControlLanded } from './Janna_E';

type Airborne = InstanceType<ContentApi['buffs']['Airborne']>;
type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Janna_Q = InstanceType<ReturnType<typeof makeJanna_Q>>;
type Janna_Q_Gust = InstanceType<ReturnType<typeof makeJanna_Q_Gust>>;
type Janna_Q_Object = InstanceType<ReturnType<typeof makeJanna_Q_Object>>;



/** Pale sea-green, the colour of Janna's wind. */
const WIND: [number, number, number] = [185, 243, 228];

/** What the funnel turns as it reaches full charge. */
const WIND_CHARGED: [number, number, number] = [255, 240, 170];


// Charge-scaled tuning, shared between the spell (which copies them onto the
// storm on activation) and the storm's own defaults. Exported so the suite
// asserts the wiring and the lerp shape, not a copy of the numbers.
export const MIN_RANGE = 550;

export const MAX_RANGE = 900;

export const MAX_CHARGE_MS = 3_000;

export const MIN_SIZE = 48;

export const MAX_SIZE = 72;

export const MIN_SPEED = 880 / 60;

export const MAX_SPEED = 1_408 / 60;

export const MIN_DAMAGE = 15;

export const MAX_DAMAGE = 30;

export const MIN_AIRBORNE_MS = 500;

export const MAX_AIRBORNE_MS = 1_250;


type JannaTarget = AttackableUnit;


/**
 * Howling Gale is a charged spell, not a plain skillshot: the whirlwind is summoned
 * where Janna stands and grows in place for up to 3 seconds, gaining range, speed,
 * damage and knock-up duration. Recasting fires it early; holding it to full charge
 * releases it automatically.
 */
function __buildJanna_Q(api: ContentApi) {
  const Spell = api.Spell;
  const SpellForm = api.enums.SpellForm;
  const Janna_Q_Object = makeJanna_Q_Object(api);
  class Janna_Q extends Spell {
    image = api.asset('spell_janna_q');
    name = 'Gió Lốc (Janna_Q)';
    description =
      'Triệu hồi một cơn lốc tại chỗ và <span class="buff">tích luỹ sức mạnh</span> trong tối đa <span class="time">3 giây</span>. Tái kích hoạt để phóng cơn lốc về hướng con trỏ, hoặc nó tự phóng khi tích đầy. Tích càng lâu thì tầm bay, tốc độ, sát thương và thời gian hất tung càng lớn: gây <span class="damage">15 - 30 sát thương</span> và <span class="buff">Hất Tung</span> trong <span class="time">0.5 - 1.25 giây</span>, xuyên qua mọi kẻ địch trên đường đi';
    coolDown = 5_000;
    manaCost = 50;

    minRange = MIN_RANGE;
    maxRange = MAX_RANGE;
    maxChargeTime = MAX_CHARGE_MS;

    spellObject: Janna_Q_Object | null = null;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'RECAST',
        targeting: 'DIRECTION',
        active: { maxDurationMs: this.maxChargeTime },
        resource: { commitAt: 'start', refundOn: [] },
        cooldown: { startAt: 'end', durationMs: this.coolDown },
        // Howling Gale spends its ACTIVE window with the funnel already standing
        // in the world, growing on its own clock and firing itself at full charge
        // with no further input. Stunning or silencing Janna cannot delete a storm
        // that no longer depends on her — only her dying takes it with her. That
        // is the whole difference between this and a genuinely held cast like
        // Varus Q or Pantheon Q, where the champion is physically drawing the shot
        // and an interrupt rightly takes it away.
        interrupts: SpellForm.INDEPENDENT,
      };
    }

    onActivate(context: CastContext): void {
      const obj = new Janna_Q_Object(this.owner);
      obj.maxChargeTime = this.maxChargeTime;
      obj.minRange = this.minRange;
      obj.maxRange = this.maxRange;
      obj.position = createVector(context.origin.x, context.origin.y);
      obj.releaseDirection = createVector(context.direction.x, context.direction.y);
      this.spellObject = obj;
      this.game.objectManager.addObject(obj);
    }

    onRecast(_context: CastContext): void {
      this.releaseStorm();
    }

    onComplete(_context: CastContext): void {
      this.releaseStorm(true);
    }

    onCancel(_context: CastContext, _reason: CancelReason): void {
      this.removeStorm();
    }

    private releaseStorm(atMaxCharge = false): void {
      const storm = this.spellObject;
      if (!storm) return;
      storm.release(atMaxCharge);
      this.spellObject = null;
    }

    private removeStorm(): void {
      if (!this.spellObject) return;
      this.spellObject.toRemove = true;
      this.spellObject = null;
    }

    drawPreview() {
      super.drawPreview(this.state === 'ACTIVE' ? this.currentRange : this.maxRange);
    }

    get currentRange(): number {
      const ratio = this.spellObject ? this.spellObject.chargeRatio : 0;
      return lerp(this.minRange, this.maxRange, ratio);
    }
  }
  return Janna_Q;
}
const __cacheJanna_Q = new WeakMap<ContentApi, ReturnType<typeof __buildJanna_Q>>();
export default function makeJanna_Q(api: ContentApi) {
  const cached = __cacheJanna_Q.get(api);
  if (cached) return cached;
  const built = __buildJanna_Q(api);
  __cacheJanna_Q.set(api, built);
  return built;
}


function __buildJanna_Q_Object(api: ContentApi) {
  const MissileSpellObject = api.MissileSpellObject;
  const Airborne = api.buffs.Airborne;
  const TrailSystem = api.helpers.TrailSystem;
  const notifyJannaControlLanded = makeNotifyJannaControlLanded(api);
  const Janna_Q_Gust = makeJanna_Q_Gust(api);
  class Janna_Q_Object extends MissileSpellObject {
    maxChargeTime = MAX_CHARGE_MS;
    chargeTime = 0;
    charging = true;

    minSize = MIN_SIZE;
    maxSize = MAX_SIZE;
    size = this.minSize;

    minSpeed = MIN_SPEED;
    maxSpeed = MAX_SPEED;
    speed = this.minSpeed;

    minRange = MIN_RANGE;
    maxRange = MAX_RANGE;

    minDamage = MIN_DAMAGE;
    maxDamage = MAX_DAMAGE;
    minAirborneTime = MIN_AIRBORNE_MS;
    maxAirborneTime = MAX_AIRBORNE_MS;

    angle = 0;
    releaseDirection = createVector();
    // the storm blows through everyone it touches
    maxHitCount = Infinity;

    trailSystem = new TrailSystem({
      trailSize: this.maxSize / 2,
      trailColor: '#B9F3E433',
    });

    /** Cosmetic: debris caught in the funnel, orbiting at a fixed radius ratio. */
    _motes: { angle: number; ratio: number; spin: number; lift: number; size: number }[] = [];

    onAdded() {
      super.onAdded();
      for (let i = 0; i < 16; i++) {
        this._motes.push({
          angle: random(TWO_PI),
          ratio: random(0.25, 1),
          spin: random(2.5, 6) * (random() < 0.5 ? -1 : 1),
          lift: random(0.1, 1),
          size: random(3, 7),
        });
      }
    }

    get chargeRatio(): number {
      return constrain(this.chargeTime / this.maxChargeTime, 0, 1);
    }

    update() {
      if (this.charging) {
        if (this.owner.isDead) {
          this.toRemove = true;
          return;
        }

        this.chargeTime += deltaTime;
        // it visibly winds itself up while it charges, then keeps that size in flight
        this.size = lerp(this.minSize, this.maxSize, this.chargeRatio);
        this.angle += 0.15 + 0.35 * this.chargeRatio;

        if (this.chargeTime >= this.maxChargeTime) this.release();
        return;
      }

      super.update();
      this.angle += 0.25;
    }

    /** Launches the storm with whatever charge it has accumulated. */
    release(atMaxCharge = false) {
      if (!this.charging) return;

      if (atMaxCharge) this.chargeTime = this.maxChargeTime;
      const ratio = this.chargeRatio;
      this.charging = false;
      this.size = lerp(this.minSize, this.maxSize, ratio);
      this.speed = lerp(this.minSpeed, this.maxSpeed, ratio);
      const range = lerp(this.minRange, this.maxRange, ratio);
      this.destination = this.position.copy().add(this.releaseDirection.copy().mult(range));
    }

    getCurrentDamage(): number {
      return Math.round(lerp(this.minDamage, this.maxDamage, this.chargeRatio));
    }

    getCurrentAirborneTime(): number {
      return Math.round(lerp(this.minAirborneTime, this.maxAirborneTime, this.chargeRatio));
    }

    onHit(enemy: JannaTarget) {
      enemy.takeDamage(this.getCurrentDamage(), this.owner);

      const airborneBuff = new Airborne(this.getCurrentAirborneTime(), this.owner, enemy);
      airborneBuff.height = 25;
      enemy.addBuff(airborneBuff);

      notifyJannaControlLanded(this.owner, enemy);

      // the gust that lifted them, so the knock-up is not a silent hop
      const gust = new Janna_Q_Gust(this.owner);
      gust.position = enemy.position.copy();
      gust.radius = this.size * 0.8 + 40;
      this.game.objectManager.addObject(gust);
    }

    /** Green while it winds up, gold once it is fully charged. */
    _funnelColor(): [number, number, number] {
      const k = this.charging ? this.chargeRatio : 1;
      return [
        lerp(WIND[0], WIND_CHARGED[0], k),
        lerp(WIND[1], WIND_CHARGED[1], k),
        lerp(WIND[2], WIND_CHARGED[2], k),
      ];
    }

    draw() {
      const [cr, cg, cb] = this._funnelColor();
      const r = this.size / 2;
      const full = this.charging && this.chargeRatio >= 0.999;

      push();
      translate(this.position.x, this.position.y);

      // the footprint on the ground: the storm's actual width
      noStroke();
      fill(cr, cg, cb, 55);
      ellipse(0, 0, this.size * 1.05, this.size * 0.42);
      noFill();
      stroke(cr, cg, cb, 200);
      strokeWeight(3);
      ellipse(0, 0, this.size * 1.05, this.size * 0.42);

      // the funnel: rings stacked upwards, widening — a tornado, not a ball.
      // Every ring gets a dark under-stroke, or the pale wind vanishes on
      // the light half of the map.
      noFill();
      for (let i = 0; i < 5; i++) {
        const k = i / 4;
        const ringR = r * (0.25 + k * 0.95);
        const lift = -k * this.size * 0.62;
        const wobble = sin(this.angle * 1.4 + i) * this.size * 0.05;
        const a0 = this.angle + i * 1.1;

        stroke(18, 55, 48, 210);
        strokeWeight(11 - i);
        arc(wobble, lift, ringR * 2, ringR * 0.72, a0, a0 + PI * 1.35);
        stroke(cr, cg, cb, 250);
        strokeWeight(7 - i);
        arc(wobble, lift, ringR * 2, ringR * 0.72, a0, a0 + PI * 1.35);
        stroke(255, 255, 255, 210);
        strokeWeight(2.5);
        arc(wobble, lift, ringR * 2, ringR * 0.72, a0 + 0.25, a0 + PI * 1.1);
      }

      // a soft core of light inside the funnel
      push();
      blendMode(ADD);
      noStroke();
      fill(cr, cg, cb, 70);
      ellipse(0, -this.size * 0.3, this.size * 0.55, this.size * 0.75);
      blendMode(BLEND);
      pop();

      // debris caught in the vortex, climbing as it turns
      noStroke();
      for (const m of this._motes) {
        const a = m.angle + this.angle * m.spin * 0.25;
        const climb = ((frameCount / 60) * m.lift) % 1;
        const ringR = r * (0.25 + climb * 0.95) * m.ratio;
        fill(255, 255, 255, 200 * (1 - climb * 0.7));
        ellipse(
          cos(a) * ringR,
          sin(a) * ringR * 0.36 - climb * this.size * 0.62,
          m.size,
          m.size * 0.6
        );
      }

      pop();

      // charge meter, so the player can see how much power is stored
      if (this.charging) {
        push();
        translate(this.position.x, this.position.y);
        noFill();
        const meter = this.maxSize + 26;
        stroke(20, 45, 40, 180);
        strokeWeight(8);
        circle(0, 0, meter);
        stroke(cr, cg, cb, 245);
        strokeWeight(6);
        arc(0, 0, meter, meter, -HALF_PI, -HALF_PI + TWO_PI * this.chargeRatio);

        // at full charge the ring flares — it is about to fire on its own
        if (full) {
          stroke(255, 255, 235, 120 + 100 * sin(frameCount / 4));
          strokeWeight(3);
          circle(0, 0, meter + 12);
        }
        pop();
      }
    }

    // the funnel climbs well above `position`, and the meter sits outside it
    getDisplayBoundingBox() {
      const r = this.maxSize;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Janna_Q_Object;
}
const __cacheJanna_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildJanna_Q_Object>>();
export function makeJanna_Q_Object(api: ContentApi) {
  const cached = __cacheJanna_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildJanna_Q_Object(api);
  __cacheJanna_Q_Object.set(api, built);
  return built;
}


/** The burst of wind that throws a unit into the air. */
function __buildJanna_Q_Gust(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Janna_Q_Gust extends SpellObject {
    position = this.owner.position.copy();
    radius = 80;
    age = 0;
    lifeTime = 420;

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;

      push();
      translate(this.position.x, this.position.y);

      // a flat ring of air blown out from under them
      noFill();
      stroke(WIND[0], WIND[1], WIND[2], 235 * fade);
      strokeWeight(8 * fade + 1.5);
      ellipse(0, 0, this.radius * 2 * (0.25 + t * 0.95), this.radius * 0.85 * (0.25 + t * 0.95));

      // gust streaks curling upwards around them
      stroke(255, 255, 255, 210 * fade);
      strokeWeight(3);
      for (let i = 0; i < 6; i++) {
        const a = (TWO_PI * i) / 6 + t * 2.2;
        const rr = this.radius * (0.35 + t * 0.6);
        beginShape();
        vertex(cos(a) * rr * 0.5, sin(a) * rr * 0.2);
        vertex(cos(a + 0.5) * rr * 0.8, sin(a + 0.5) * rr * 0.3 - 16 * t);
        vertex(cos(a + 1.0) * rr, sin(a + 1.0) * rr * 0.35 - 34 * t);
        endShape();
      }

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.radius + 40;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Janna_Q_Gust;
}
const __cacheJanna_Q_Gust = new WeakMap<ContentApi, ReturnType<typeof __buildJanna_Q_Gust>>();
export function makeJanna_Q_Gust(api: ContentApi) {
  const cached = __cacheJanna_Q_Gust.get(api);
  if (cached) return cached;
  const built = __buildJanna_Q_Gust(api);
  __cacheJanna_Q_Gust.set(api, built);
  return built;
}
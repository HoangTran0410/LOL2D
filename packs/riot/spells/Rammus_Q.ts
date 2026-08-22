import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastSpec } from '@moba2d/core/content/types';

type Airborne = InstanceType<ContentApi['buffs']['Airborne']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Phasing = InstanceType<ContentApi['buffs']['Phasing']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Speedup = InstanceType<ContentApi['buffs']['Speedup']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Rammus_Q = InstanceType<ReturnType<typeof makeRammus_Q>>;
type Rammus_Q_Crash = InstanceType<ReturnType<typeof makeRammus_Q_Crash>>;
type Rammus_Q_Object = InstanceType<ReturnType<typeof makeRammus_Q_Object>>;
type Rammus_Q_Powerball = InstanceType<ReturnType<typeof makeRammus_Q_Powerball>>;



/**
 * Powerball. The real spell accelerates: Rammus gains bonus movement speed every
 * second he keeps rolling, up to a large cap, and stops the moment he hits
 * something — knocking the enemies he crashes into up, then slowing them.
 */
function __buildRammus_Q(api: ContentApi) {
  const SpellForm = api.enums.SpellForm;
  const Spell = api.Spell;
  const Phasing = api.buffs.Phasing;
  const Rammus_Q_Powerball = makeRammus_Q_Powerball(api);
  const Rammus_Q_Object = makeRammus_Q_Object(api);
  class Rammus_Q extends Spell {
    image = api.asset('spell_rammus_q');
    name = 'Quả Cầu Tốc Độ (Rammus_Q)';
    description =
      'Cuộn tròn lăn đi trong <span class="time">4 giây</span>, <span class="buff">Tăng Tốc</span> tăng dần từ <span class="buff">20%</span> lên tới <span class="buff">120%</span> theo thời gian lăn. Trong lúc lăn <span class="buff">không thể đánh thường</span> nhưng vẫn dùng được chiêu khác. Kẻ địch va phải nhận <span class="damage">30 sát thương</span>, bị <span class="buff">Hất Tung</span> trong <span class="time">0.5 giây</span> rồi <span class="buff">Làm Chậm 60%</span> trong <span class="time">1.5 giây</span>, đồng thời kết thúc cú lăn.';
    coolDown = 8000;
    manaCost = 20;

    duration = 4000;
    startPercent = 0.2;
    maxPercent = 1.2;
    damage = 30;
    airborneTime = 500;
    slowPercent = 0.6;
    slowTime = 1500;

    rollBuff: Rammus_Q_Powerball | null = null;
    rollObject: Rammus_Q_Object | null = null;

    /**
     * The roll is the spell's ACTIVE window, not something the spell fires and
     * forgets: for four seconds Rammus *is* a ball, and the runtime should say so.
     *
     * `INDEPENDENT` is the point. Powerball ends on its own terms — the clock
     * running out or the ball connecting with somebody — and crowd control is not
     * one of them: a rolling Rammus who gets stunned is a stunned Rammus who is
     * still rolling when it wears off. Only his death takes the roll with him,
     * which is what the ball already did on its own.
     *
     * Cooldown still starts at the press, so pressing Q begins the eight seconds
     * immediately rather than four seconds later when the roll ends.
     */
    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'DIRECTION',
        active: { maxDurationMs: this.duration },
        resource: { commitAt: 'start', refundOn: [] },
        cooldown: { startAt: 'start', durationMs: this.coolDown },
        interrupts: SpellForm.INDEPENDENT,
      };
    }

    onSpellCast() {
      const speedupBuff = new Rammus_Q_Powerball(this.duration, this.owner, this.owner);
      speedupBuff.startPercent = this.startPercent;
      speedupBuff.maxPercent = this.maxPercent;
      speedupBuff.rampDuration = this.duration;
      speedupBuff.percent = this.startPercent;
      speedupBuff.image = this.image;
      this.owner.addBuff(speedupBuff);

      // Powerball ploughs. Being body-blocked by a single minion is the one thing
      // a rolling armordillo must not do, and it is why the roll so often ended
      // against the wave it was meant to go through.
      const phase = new Phasing(this.duration, this.owner, this.owner);
      phase.image = this.image;
      this.owner.addBuff(phase);

      const obj = new Rammus_Q_Object(this.owner);
      obj.lifeTime = this.duration;
      obj.damage = this.damage;
      obj.airborneTime = this.airborneTime;
      obj.slowPercent = this.slowPercent;
      obj.slowTime = this.slowTime;
      obj.speedupBuff = speedupBuff;
      obj.spell = this;
      this.rollBuff = speedupBuff;
      this.rollObject = obj;
      this.game.objectManager.addObject(obj);
    }

    /**
     * The ball's own ends — the lifetime running out, the owner dying, or hitting
     * somebody — close the ACTIVE window too, so the spell is never still rolling
     * after the roll stopped. Idempotent: the window closing calls back into the
     * cleanup below, which finds nothing left to do.
     */
    endRoll(): void {
      if (this.state === 'ACTIVE') this.cancel('EFFECT_ENDED');
      else this.clearRoll();
    }

    onCancel(): void {
      this.clearRoll();
    }

    onComplete(): void {
      this.clearRoll();
    }

    private clearRoll(): void {
      this.rollBuff?.deactivateBuff();
      this.rollBuff = null;
      if (this.rollObject) this.rollObject.toRemove = true;
      this.rollObject = null;
    }
  }
  return Rammus_Q;
}
const __cacheRammus_Q = new WeakMap<ContentApi, ReturnType<typeof __buildRammus_Q>>();
export default function makeRammus_Q(api: ContentApi) {
  const cached = __cacheRammus_Q.get(api);
  if (cached) return cached;
  const built = __buildRammus_Q(api);
  __cacheRammus_Q.set(api, built);
  return built;
}


/**
 * The accelerating half of Powerball. `Stats` applies a modifier by adding its
 * numbers in, not by holding a reference, so ramping means re-seating the
 * modifier each time the bonus changes.
 */
function __buildRammus_Q_Powerball(api: ContentApi) {
  const StatusFlags = api.enums.StatusFlags;
  const Speedup = api.buffs.Speedup;
  class Rammus_Q_Powerball extends Speedup {
    name = 'Nhím Lăn';

    /**
     * Curled into a ball, he cannot swing — but he can still cast, and still
     * Flash. That is how the real game draws the line, and it needs no notion of
     * a channel: rolling is a *restriction on attacking*, nothing more. The
     * `Disarmed` flag added with basic attacks says exactly that, and
     * `BasicAttackController` already drops a standing order the moment
     * `canAttack` goes false.
     */
    statusFlagsToEnable = StatusFlags.Disarmed;

    startPercent = 0.2;
    maxPercent = 1.2;
    rampDuration = 4000;
    percent = 0.2;

    onUpdate(): void {
      super.onUpdate();

      const progress = constrain(this.timeElapsed / this.rampDuration, 0, 1);
      const newPercent = lerp(this.startPercent, this.maxPercent, progress);
      if (Math.abs(newPercent - this.percent) < 0.0001) return;

      this.targetUnit.stats.removeModifier(this.statsModifier);
      this.statsModifier.speed.percentBaseBonus = newPercent;
      this.targetUnit.stats.addModifier(this.statsModifier);
      this.percent = newPercent;
    }

    /** 0 at the start of the roll, 1 once it is at full tilt — drives the visuals. */
    get rampProgress(): number {
      return constrain(this.timeElapsed / this.rampDuration, 0, 1);
    }
  }
  return Rammus_Q_Powerball;
}
const __cacheRammus_Q_Powerball = new WeakMap<ContentApi, ReturnType<typeof __buildRammus_Q_Powerball>>();
export function makeRammus_Q_Powerball(api: ContentApi) {
  const cached = __cacheRammus_Q_Powerball.get(api);
  if (cached) return cached;
  const built = __buildRammus_Q_Powerball(api);
  __cacheRammus_Q_Powerball.set(api, built);
  return built;
}


/**
 * The ball is not a projectile: it is glued to the caster and rolls wherever
 * they run, so it reads `owner.position` every frame instead of travelling.
 */
/**
 * The ball is Rammus curled up, so it is sized off his own body rather than a
 * constant. A fixed 46 left it rattling around *inside* a grown Cho'Gath-sized
 * champion, and — now that bodies are solid — unable to reach anyone at all:
 * separation holds two units at least `bodyRadius + bodyRadius` apart, which a
 * 23-unit hit circle can never span.
 */
export const BALL_SIZE_RATIO = 1.1;

/** Fallback body width for a unit with no animated size yet (first frame). */
export const FALLBACK_BODY_SIZE = 55;


function __buildRammus_Q_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const MAX_UNIT_SIZE = api.units.MAX_UNIT_SIZE;
  const Airborne = api.buffs.Airborne;
  const Slow = api.buffs.Slow;
  const TrailSystem = api.helpers.TrailSystem;
  const Rammus_Q_Crash = makeRammus_Q_Crash(api);
  class Rammus_Q_Object extends SpellObject {
    position = this.owner.position.copy();
    lifeTime = 4000;
    age = 0;
    angle = 0;
    rollSpeed = 0.15;
    damage = 30;
    airborneTime = 500;
    slowPercent = 0.6;
    slowTime = 1500;
    speedupBuff: Rammus_Q_Powerball | null = null;
    /** Told when the roll is over, so the spell's ACTIVE window ends with it. */
    spell: Rammus_Q | null = null;

    /** Cosmetic: dust thrown up by the roll, denser the faster he goes. */
    _dust: { x: number; y: number; age: number; size: number; vx: number; vy: number }[] = [];
    _dustTimer = 0;

    trailSystem = new TrailSystem({
      trailSize: this.size / 2,
      trailColor: '#d2a04c55',
      maxLength: 20,
    });

    /** Tracks the caster's live body, so Cho'Gath R grows the ball with him. */
    get size(): number {
      const body = this.owner.animatedValues?.displaySize || FALLBACK_BODY_SIZE;
      return body * BALL_SIZE_RATIO;
    }

    /** Surface to surface, the same reach rule minions use. */
    reachTo(victim: { bodyRadius?: number; collisionRadius: number }): number {
      return this.size / 2 + (victim.bodyRadius ?? victim.collisionRadius);
    }

    onAdded() {
      this.game.objectManager.addObject(this.trailSystem);
    }

    update() {
      this.age += deltaTime;

      this.position.set(this.owner.position.x, this.owner.position.y);
      // spins faster the further the roll has ramped up
      const ramp = this.speedupBuff?.rampProgress ?? 0;
      this.angle += this.rollSpeed * (1 + ramp * 3);
      this.trailSystem.trailSize = this.size / 2;
      this.trailSystem.addTrail(this.position);
      this._updateDust(ramp);

      if (this.age >= this.lifeTime || this.owner.isDead) {
        this.toRemove = true;
        this.spell?.endRoll();
        return;
      }

      // queried wide, then filtered surface to surface: the query circle has to
      // clear the largest body it could touch, not just the ball itself
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.position.x,
          y: this.position.y,
          r: this.size / 2 + MAX_UNIT_SIZE / 2,
        }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });

      if (enemies.length === 0) return;

      // impact: everyone Rammus crashes into is hit, knocked up, then slowed
      for (const victim of enemies) {
        const gap = Math.hypot(
          victim.position.x - this.position.x,
          victim.position.y - this.position.y
        );
        if (gap > this.reachTo(victim)) continue;

        victim.takeDamage(this.damage, this.owner);

        const airborneBuff = new Airborne(this.airborneTime, this.owner, victim);
        victim.addBuff(airborneBuff);

        const slowBuff = new Slow(this.slowTime, this.owner, victim);
        slowBuff.percent = this.slowPercent;
        victim.addBuff(slowBuff);
      }

      // the crash needs its own object: this one is gone before the next draw pass
      const crash = new Rammus_Q_Crash(this.owner);
      crash.position = this.position.copy();
      crash.power = this.speedupBuff?.rampProgress ?? 0;
      this.game.objectManager.addObject(crash);

      // connecting ends the roll early, speed boost included
      this.speedupBuff?.deactivateBuff();
      this.toRemove = true;
      this.spell?.endRoll();
    }

    _updateDust(ramp: number) {
      // faster roll, more grit: the ramp has to be visible on the ground too
      const interval = 90 - 60 * ramp;
      this._dustTimer += deltaTime;
      if (this._dustTimer >= interval && this._dust.length < 26) {
        this._dustTimer = 0;
        const back = random(TWO_PI);
        this._dust.push({
          x: this.position.x + cos(back) * this.size * 0.4,
          y: this.position.y + sin(back) * this.size * 0.4,
          age: 0,
          size: random(9, 18) * (0.7 + ramp),
          vx: random(-0.7, 0.7),
          vy: random(-0.7, 0.7),
        });
      }

      let i = 0;
      while (i < this._dust.length) {
        const d = this._dust[i];
        d.age += deltaTime;
        d.x += d.vx;
        d.y += d.vy;
        if (d.age >= 500) this._dust.splice(i, 1);
        else i++;
      }
    }

    draw() {
      const r = this.size / 2;
      const ramp = this.speedupBuff?.rampProgress ?? 0;

      // dust kicked off the ground, drawn under the ball
      push();
      noStroke();
      for (const d of this._dust) {
        const t = d.age / 500;
        fill(196, 165, 120, 130 * (1 - t));
        circle(d.x, d.y, d.size * (1 + t * 0.8));
      }
      pop();

      push();
      translate(this.position.x, this.position.y);

      // heat haze that grows with the ramp, so top speed is unmistakable
      if (ramp > 0.05) {
        blendMode(ADD);
        noStroke();
        fill(255, 170, 60, 30 + 60 * ramp);
        circle(0, 0, this.size * (1.4 + 0.7 * ramp));
        blendMode(BLEND);
      }

      rotate(this.angle);

      stroke(90, 60, 30);
      strokeWeight(3);
      fill(205, 155, 75);
      circle(0, 0, this.size);

      // shell spikes, pointing outwards
      noStroke();
      fill(240, 228, 200);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TWO_PI;
        triangle(
          cos(a) * (r + 6),
          sin(a) * (r + 6),
          cos(a + 0.3) * (r - 3),
          sin(a + 0.3) * (r - 3),
          cos(a - 0.3) * (r - 3),
          sin(a - 0.3) * (r - 3)
        );
      }

      // a couple of plates so the spin is readable
      stroke(120, 80, 40, 200);
      strokeWeight(2);
      noFill();
      arc(0, 0, this.size * 0.6, this.size * 0.6, 0, PI);
      arc(0, 0, this.size * 0.85, this.size * 0.85, PI + 0.4, TWO_PI - 0.4);
      pop();

      push();
      translate(this.position.x, this.position.y);

      // speed streaks, more and longer the faster he is going
      if (ramp > 0.1) {
        const lines = 2 + Math.round(ramp * 5);
        stroke(255, 235, 190, 60 + 120 * ramp);
        strokeWeight(2);
        for (let i = 0; i < lines; i++) {
          const a = this.angle * 0.15 + (i * TWO_PI) / lines;
          const r0 = r + 10;
          const len = 10 + 28 * ramp;
          line(cos(a) * r0, sin(a) * r0, cos(a) * (r0 + len), sin(a) * (r0 + len));
        }
      }

      // a ring that closes as the roll reaches top speed
      if (ramp > 0) {
        noFill();
        stroke(255, 220, 150, 60);
        strokeWeight(3);
        circle(0, 0, this.size + 14);
        // hotter and thicker the closer he is to full tilt
        stroke(255, 210 - 60 * ramp, 120 - 60 * ramp, 140 + 115 * ramp);
        strokeWeight(3 + 3 * ramp);
        arc(0, 0, this.size + 14, this.size + 14, -HALF_PI, -HALF_PI + TWO_PI * ramp);
      }
      pop();
    }

    getDisplayBoundingBox() {
      const r = this.size / 2 + 60;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Rammus_Q_Object;
}
const __cacheRammus_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildRammus_Q_Object>>();
export function makeRammus_Q_Object(api: ContentApi) {
  const cached = __cacheRammus_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildRammus_Q_Object(api);
  __cacheRammus_Q_Object.set(api, built);
  return built;
}


/** The pile-up when Powerball connects. */
function __buildRammus_Q_Crash(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Rammus_Q_Crash extends SpellObject {
    /** How far the roll had ramped up — a faster crash throws more debris. */
    power = 0;
    age = 0;
    lifeTime = 480;

    _debris: { a: number; speed: number; size: number; spin: number }[] = [];

    onAdded() {
      const count = 7 + Math.round(this.power * 6);
      for (let i = 0; i < count; i++) {
        this._debris.push({
          a: random(TWO_PI),
          speed: random(0.6, 1.6) * (0.7 + this.power),
          size: random(5, 12),
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
      const reach = 60 + 90 * this.power;

      push();
      translate(this.position.x, this.position.y);

      blendMode(ADD);
      noStroke();
      fill(255, 200, 120, 120 * fade * fade);
      circle(0, 0, 70 + reach * t);
      blendMode(BLEND);

      // two shockwave rings, the outer one racing ahead
      noFill();
      stroke(255, 235, 190, 230 * fade);
      strokeWeight(5 * fade + 1);
      circle(0, 0, 30 + reach * 2 * t);
      stroke(210, 165, 90, 180 * fade);
      strokeWeight(3 * fade + 1);
      circle(0, 0, 20 + reach * 1.3 * t);

      // dirt and shell chips
      noStroke();
      for (const d of this._debris) {
        const dist = 10 + reach * t * d.speed;
        push();
        translate(cos(d.a) * dist, sin(d.a) * dist);
        rotate(d.a + t * d.spin * 12);
        fill(205, 168, 105, 235 * fade);
        const s = d.size * (1 - t * 0.4);
        triangle(0, -s, s * 0.75, s * 0.6, -s * 0.75, s * 0.6);
        pop();
      }
      pop();
    }

    getDisplayBoundingBox() {
      const r = 170 + this.power * 120;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Rammus_Q_Crash;
}
const __cacheRammus_Q_Crash = new WeakMap<ContentApi, ReturnType<typeof __buildRammus_Q_Crash>>();
export function makeRammus_Q_Crash(api: ContentApi) {
  const cached = __cacheRammus_Q_Crash.get(api);
  if (cached) return cached;
  const built = __buildRammus_Q_Crash(api);
  __cacheRammus_Q_Crash.set(api, built);
  return built;
}
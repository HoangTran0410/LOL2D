import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Shield = InstanceType<ContentApi['buffs']['Shield']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Stun = InstanceType<ContentApi['buffs']['Stun']>;
type Ekko_W = InstanceType<ReturnType<typeof makeEkko_W>>;
type Ekko_W_DeviceMissile = InstanceType<ReturnType<typeof makeEkko_W_DeviceMissile>>;
type Ekko_W_Object = InstanceType<ReturnType<typeof makeEkko_W_Object>>;
type Ekko_W_ShatterObject = InstanceType<ReturnType<typeof makeEkko_W_ShatterObject>>;



export const EKKO_W_RADIUS = 150;

export const EKKO_W_ARM_DELAY_MS = 2000;

export const EKKO_W_ACTIVE_MS = 1500;

export const EKKO_W_SHIELD = 120;

export const EKKO_W_STUN_MS = 2250;

export const EKKO_W_SLOW_PERCENT = 0.4;


function __buildEkko_W(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Ekko_W_DeviceMissile = makeEkko_W_DeviceMissile(api);
  class Ekko_W extends Spell {
    targetingMode = 'POINT' as const;
    image = api.asset('spell_ekko_w');
    name = 'Lưỡng Giới Đồng Quy (Ekko_W)';
    description =
      'Bắn thiết bị tạo một vùng cầu thời gian tại điểm chỉ định sau <span class="time">2 giây</span>. Kẻ địch bên trong bị <span class="buff">Làm Chậm 40%</span>. Nếu Ekko đi vào vùng này, quả cầu phát nổ: cho Ekko <span class="buff">Lớp Giáp 120</span> và <span class="buff">Làm Choáng</span> kẻ địch <span class="time">2.25 giây</span>.';
    coolDown = 10000;
    manaCost = 50;
    range = 600;

    onSpellCast() {
      const { from, to } = VectorUtils.getVectorWithMaxRange(
        this.owner.position,
        this.aimPoint,
        this.range
      );

      // Fire device projectile towards target location
      const device = new Ekko_W_DeviceMissile(this.owner);
      device.position = from;
      device.destination = to;
      this.game.objectManager.addObject(device);
    }
  }
  return Ekko_W;
}
const __cacheEkko_W = new WeakMap<ContentApi, ReturnType<typeof __buildEkko_W>>();
export default function makeEkko_W(api: ContentApi) {
  const cached = __cacheEkko_W.get(api);
  if (cached) return cached;
  const built = __buildEkko_W(api);
  __cacheEkko_W.set(api, built);
  return built;
}


/** Thrown device that travels to target location before deploying chronosphere. */
function __buildEkko_W_DeviceMissile(api: ContentApi) {
  const MissileSpellObject = api.MissileSpellObject;
  const Ekko_W_Object = makeEkko_W_Object(api);
  class Ekko_W_DeviceMissile extends MissileSpellObject {
    speed = 16;
    size = 20;
    /** It is a thrown device, not a skillshot — it passes over bodies harmlessly. */
    maxHitCount = 0;

    onArrive() {
      this.toRemove = true;

      // Deploy deployed chronosphere at arrival location
      const sphere = new Ekko_W_Object(this.owner);
      sphere.position = this.destination.copy();
      this.game.objectManager.addObject(sphere);
    }

    draw() {
      push();
      translate(this.position.x, this.position.y);
      // tumbling end over end, with a status light blinking on the casing — it
      // has to read as a device thrown out, not a bolt fired
      rotate(frameCount * 0.35);
      stroke(20, 90, 90, 230);
      strokeWeight(2);
      fill(0, 200, 190, 235);
      rectMode(CENTER);
      rect(0, 0, 18, 12, 3);
      noStroke();
      fill(220, 255, 250, 240);
      rect(0, 0, 4, 14, 2);
      // blinking indicator
      if (frameCount % 20 < 10) {
        fill(255, 255, 255, 245);
        circle(6, 0, 5);
      }
      pop();
    }

    getDisplayBoundingBox() {
      const r = 20;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Ekko_W_DeviceMissile;
}
const __cacheEkko_W_DeviceMissile = new WeakMap<ContentApi, ReturnType<typeof __buildEkko_W_DeviceMissile>>();
export function makeEkko_W_DeviceMissile(api: ContentApi) {
  const cached = __cacheEkko_W_DeviceMissile.get(api);
  if (cached) return cached;
  const built = __buildEkko_W_DeviceMissile(api);
  __cacheEkko_W_DeviceMissile.set(api, built);
  return built;
}


interface Shard {
  angle: number;
  speed: number;
  length: number;
}


/**
 * The Chronosphere.
 *
 * Two seconds of arming is a long time to ask a player to wait, and the old
 * version spent it drawing a disc quietly filling up — no sense of a machine
 * winding, and no clear moment of "it is live now". It now assembles: segments
 * of the shell snap into place one at a time around the perimeter, so the fill
 * is a countdown you can read at a glance, and arming lands with a hard flash.
 *
 * Detonation shatters rather than fading, because it is Ekko breaking the sphere
 * on purpose by walking into it.
 */
function __buildEkko_W_Object(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const Slow = api.buffs.Slow;
  const Stun = api.buffs.Stun;
  const Shield = api.buffs.Shield;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  const Ekko_W_ShatterObject = makeEkko_W_ShatterObject(api);
  class Ekko_W_Object extends SpellObject {
    radius = EKKO_W_RADIUS;
    delay = EKKO_W_ARM_DELAY_MS;
    activeDuration = EKKO_W_ACTIVE_MS;

    timer = 0;
    isArmed = false;
    /** Counts down from 1 on the frame the shell finishes assembling. */
    armFlash = 0;

    particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize('#00f0e0');

    onAdded() {
      super.onAdded();
      this.useParticles(this.particleSystem);
    }

    update() {
      this.timer += deltaTime;
      if (this.armFlash > 0) this.armFlash = Math.max(0, this.armFlash - deltaTime / 300);

      if (!this.isArmed) {
        if (this.timer >= this.delay) {
          this.isArmed = true;
          this.armFlash = 1;
          this.timer = 0;
          for (let i = 0; i < 14; i++) {
            const a = (TWO_PI / 14) * i;
            this.particleSystem.addParticle({
              x: this.position.x + cos(a) * this.radius,
              y: this.position.y + sin(a) * this.radius,
              r: random(5, 10),
            });
          }
        }
        return;
      }

      if (this.timer >= this.activeDuration) {
        this.toRemove = true;
        return;
      }

      // Check if Ekko enters the sphere
      const ekkoDist = this.owner.position.dist(this.position);
      if (ekkoDist <= this.radius + this.owner.stats.size.value / 2) {
        this.detonate();
        return;
      }

      // Apply slow to enemies in sphere
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.position.x, y: this.position.y, r: this.radius }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });

      for (const enemy of enemies) {
        const slow = new Slow(300, this.owner, enemy);
        slow.percent = EKKO_W_SLOW_PERCENT;
        enemy.addBuff(slow);
      }
    }

    detonate() {
      // Electrical explosion particles
      for (let i = 0; i < 20; i++) {
        this.particleSystem.addParticle({
          x: this.position.x + random(-this.radius, this.radius),
          y: this.position.y + random(-this.radius, this.radius),
          r: random(8, 16),
        });
      }

      // Grant Shield to Ekko
      const shield = new Shield(2000, this.owner, this.owner);
      shield.amount = EKKO_W_SHIELD;
      this.owner.addBuff(shield);

      // Stun all enemies in area
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.position.x, y: this.position.y, r: this.radius }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });

      for (const enemy of enemies) {
        const stun = new Stun(EKKO_W_STUN_MS, this.owner, enemy);
        enemy.addBuff(stun);
      }

      // the shell breaking: shards thrown outward from where it stood
      const shatter = new Ekko_W_ShatterObject(this.owner);
      shatter.position = this.position.copy();
      shatter.radius = this.radius;
      this.game.objectManager.addObject(shatter);

      this.toRemove = true;
    }

    draw() {
      push();
      translate(this.position.x, this.position.y);
      const d = this.radius * 2;

      if (!this.isArmed) {
        const progress = constrain(this.timer / this.delay, 0, 1);
        // the footprint it will occupy, faint — bystanders can leave
        noFill();
        stroke(0, 200, 190, 90);
        strokeWeight(2);
        circle(0, 0, d);

        // the shell assembling: 24 segments snapping in, one at a time
        const segments = 24;
        const built = progress * segments;
        stroke(0, 245, 225, 225);
        strokeWeight(5);
        for (let i = 0; i < segments; i++) {
          if (i > built) break;
          // the segment currently landing pops in slightly oversized
          const settle = constrain(built - i, 0, 1);
          const rr = this.radius * (1 + (1 - settle) * 0.22);
          const a1 = (TWO_PI / segments) * i + 0.04;
          const a2 = (TWO_PI / segments) * (i + 1) - 0.04;
          arc(0, 0, rr * 2, rr * 2, a1, a2);
        }

        // interior charging up under the shell
        noStroke();
        fill(0, 220, 200, 45 * progress);
        circle(0, 0, d * progress);

        // countdown hand, so the wait has a clock on it
        push();
        rotate(-HALF_PI + TWO_PI * progress);
        stroke(190, 255, 250, 200);
        strokeWeight(3);
        line(0, 0, this.radius * 0.55, 0);
        pop();
        pop();
        return;
      }

      // ARMED — live, humming, and visibly on a short fuse
      const left = constrain(1 - this.timer / this.activeDuration, 0, 1);
      const hum = 1 + sin(frameCount * 0.25) * 0.02;

      noStroke();
      fill(0, 240, 220, 80);
      circle(0, 0, d * hum);
      noFill();
      stroke(0, 255, 230, 225);
      strokeWeight(4);
      circle(0, 0, d * hum);

      // Rotating clock hour tick marks around Chronosphere perimeter
      push();
      rotate(frameCount * 0.02);
      stroke(255, 255, 255, 200);
      strokeWeight(2);
      for (let i = 0; i < 12; i++) {
        const ang = (TWO_PI / 12) * i;
        const x1 = cos(ang) * (this.radius - 12);
        const y1 = sin(ang) * (this.radius - 12);
        const x2 = cos(ang) * this.radius;
        const y2 = sin(ang) * this.radius;
        line(x1, y1, x2, y2);
      }
      pop();

      // how long is left, drawn as the ring emptying
      noFill();
      stroke(220, 255, 250, 235);
      strokeWeight(5);
      arc(0, 0, (this.radius - 20) * 2, (this.radius - 20) * 2, -HALF_PI, -HALF_PI + TWO_PI * left);

      // the arming flash
      if (this.armFlash > 0) {
        noStroke();
        fill(255, 255, 255, 190 * this.armFlash);
        circle(0, 0, d * (1.15 - 0.15 * this.armFlash));
        noFill();
        stroke(255, 255, 255, 245 * this.armFlash);
        strokeWeight(6 * this.armFlash + 1);
        circle(0, 0, d * (1 + (1 - this.armFlash) * 0.35));
      }
      pop();
    }

    getDisplayBoundingBox() {
      const r = this.radius + 45;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Ekko_W_Object;
}
const __cacheEkko_W_Object = new WeakMap<ContentApi, ReturnType<typeof __buildEkko_W_Object>>();
export function makeEkko_W_Object(api: ContentApi) {
  const cached = __cacheEkko_W_Object.get(api);
  if (cached) return cached;
  const built = __buildEkko_W_Object(api);
  __cacheEkko_W_Object.set(api, built);
  return built;
}


/** The sphere breaking apart — shards flung outward plus a hard white flash. */
function __buildEkko_W_ShatterObject(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Ekko_W_ShatterObject extends SpellObject {
    radius = EKKO_W_RADIUS;
    lifeTime = 450;
    timer = 0;
    shards: Shard[] = [];

    onAdded() {
      for (let i = 0; i < 16; i++) {
        this.shards.push({
          angle: (TWO_PI / 16) * i + random(-0.1, 0.1),
          speed: random(0.75, 1.15),
          length: random(18, 40),
        });
      }
    }

    update() {
      this.timer += deltaTime;
      if (this.timer >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const t = constrain(this.timer / this.lifeTime, 0, 1);
      const fade = 1 - t;

      push();
      translate(this.position.x, this.position.y);

      // flash, gone in the first fifth
      const flash = 1 - constrain(t / 0.2, 0, 1);
      if (flash > 0) {
        noStroke();
        fill(255, 255, 255, 210 * flash);
        circle(0, 0, this.radius * 1.5 * (1 - flash) + 30);
      }

      // shockwave out to the sphere's edge and slightly past
      noFill();
      stroke(120, 255, 240, 230 * fade);
      strokeWeight(8 * fade + 2);
      circle(0, 0, this.radius * 2 * (0.35 + t * 0.9));

      // the shell's shards, tumbling outward
      stroke(200, 255, 250, 235 * fade);
      strokeWeight(3);
      for (const shard of this.shards) {
        const d = this.radius * t * shard.speed;
        const x = cos(shard.angle) * d;
        const y = sin(shard.angle) * d;
        const len = shard.length * fade;
        push();
        translate(x, y);
        rotate(shard.angle + t * 3);
        line(-len / 2, 0, len / 2, 0);
        pop();
      }
      pop();
    }

    getDisplayBoundingBox() {
      const r = this.radius * 2 + 40;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Ekko_W_ShatterObject;
}
const __cacheEkko_W_ShatterObject = new WeakMap<ContentApi, ReturnType<typeof __buildEkko_W_ShatterObject>>();
export function makeEkko_W_ShatterObject(api: ContentApi) {
  const cached = __cacheEkko_W_ShatterObject.get(api);
  if (cached) return cached;
  const built = __buildEkko_W_ShatterObject(api);
  __cacheEkko_W_ShatterObject.set(api, built);
  return built;
}
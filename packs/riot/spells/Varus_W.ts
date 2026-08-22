import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { BasicAttackHit } from '@moba2d/core/content/types';

type Buff = InstanceType<ContentApi['buffs']['Buff']>;
type DamageOverTime = InstanceType<ContentApi['buffs']['DamageOverTime']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type StatAmp = InstanceType<ContentApi['buffs']['StatAmp']>;
type Varus_W = InstanceType<ReturnType<typeof makeVarus_W>>;
type Varus_W_Object = InstanceType<ReturnType<typeof makeVarus_W_Object>>;



export const DURATION = 8000;

export const BLIGHT_PER_TICK = 4;

export const BLIGHT_DURATION = 2000;

export const STACK_ID = 'varus_w';


/**
 * The corruption gathers *inward* before anything happens. Every other cast in
 * the game pushes outward, so an implosion is instantly Varus and instantly
 * reads as something being taken into the quiver rather than let off.
 */
export const IMPLODE_MS = 380;

export const TENDRIL_COUNT = 5;

/** One full creep-and-retract of a ground tendril. */
export const TENDRIL_CYCLE_MS = 2400;

/** How far a tendril crawls, in body radii. */
export const TENDRIL_REACH = 2.1;

export const ARROW_COUNT = 3;

export const DRIP_INTERVAL_MS = 340;

export const DRIP_LIFETIME_MS = 700;

export const ROT_INTERVAL_MS = 200;

export const BOUNDING_MARGIN = 140;

/** Cosmetic-only ceiling; the buff ending or Varus dying is the real exit. */
export const HARD_STOP_MS = DURATION + 1200;


/** Blighted Quiver: every arrow leaves rot behind it. */
function __buildVarus_W(api: ContentApi) {
  const EventType = api.enums.EventType;
  const Spell = api.Spell;
  const DamageOverTime = api.buffs.DamageOverTime;
  const StatAmp = api.buffs.StatAmp;
  const Buff = api.buffs.Buff;
  const Varus_W_Object = makeVarus_W_Object(api);
  class Varus_W extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_varus_w');
    name = 'Tên Độc (Varus_W)';
    description =
      `Trong <span class="time">${DURATION / 1000} giây</span>, mỗi đòn đánh thường bám thêm` +
      ` <span class="damage">${BLIGHT_PER_TICK} sát thương mỗi nhịp</span> trong` +
      ` <span class="time">${BLIGHT_DURATION / 1000} giây</span>, kèm <span class="buff">+15% tốc độ đánh</span>`;
    coolDown = 10000;
    manaCost = 25;

    private stopWatching?: () => void;

    onUpdate(): void {
      if (this.stopWatching || !this.owner || !this.game?.eventManager) return;
      this.stopWatching = this.game.eventManager.on(
        EventType.ON_ATTACK_HIT,
        ({ attacker, victim }: BasicAttackHit) => {
          if (attacker !== this.owner || !victim || !this.isActive) return;
          const blight = new DamageOverTime(BLIGHT_DURATION, this.owner, victim);
          blight.stackId = 'varus_blight';
          blight.name = 'Bệnh Dịch';
          blight.damagePerTick = BLIGHT_PER_TICK;
          blight.tickInterval = 500;
          blight.flameColor = [200, 130, 255];
          blight.emberColor = [70, 20, 110];
          victim.addBuff(blight);
        }
      );
    }

    get isActive(): boolean {
      return (
        this.owner?.buffs?.some((buff: Buff) => buff.stackId === STACK_ID && !buff.toRemove) ?? false
      );
    }

    onRemoved(): void {
      this.stopWatching?.();
      this.stopWatching = undefined;
      super.onRemoved();
    }

    deactivate(): void {
      this.stopWatching?.();
      this.stopWatching = undefined;
      super.deactivate();
    }

    onSpellCast() {
      const amp = new StatAmp(DURATION, this.owner, this.owner);
      amp.stackId = STACK_ID;
      amp.image = this.image;
      amp.name = 'Ống Tên Bệnh Dịch';
      amp.bonuses = { attackSpeed: { percentBaseBonus: 0.15 } };
      this.owner.addBuff(amp);

      // The blight only lands while this buff is up, and the victim finds that out
      // eight seconds too late. The quiver is the warning: black arrowheads
      // dripping violet, and rot creeping out of the ground he is standing on.
      const quiver = new Varus_W_Object(this.owner);
      quiver.attachTo(this.owner, amp);
      this.game.objectManager.addObject(quiver);
    }
  }
  return Varus_W;
}
const __cacheVarus_W = new WeakMap<ContentApi, ReturnType<typeof __buildVarus_W>>();
export default function makeVarus_W(api: ContentApi) {
  const cached = __cacheVarus_W.get(api);
  if (cached) return cached;
  const built = __buildVarus_W(api);
  __cacheVarus_W.set(api, built);
  return built;
}


interface Tendril {
  angle: number;
  /** Staggered so the five never creep and retract in unison. */
  offset: number;
  /** How hard it snakes off its own axis. */
  curl: number;
  reach: number;
}


interface Drip {
  x: number;
  y: number;
  vy: number;
  age: number;
}


/**
 * The blighted quiver. Two motions, on purpose: the arrowheads hang almost
 * still while the ground crawls, so the eye is caught by the rot first and then
 * finds the source. Varus R's tendril is a single straight bolt fired at a
 * target — these are short, radial and never leave his feet, which is what
 * keeps the two apart at a glance.
 */
function __buildVarus_W_Object(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  class Varus_W_Object extends SpellObject {
    age = 0;

    _tendrils: Tendril[] = [];
    _drips: Drip[] = [];
    _dripTimer = 0;
    _rotTimer = 0;

    particleSystem = PredefinedParticleSystems.smoke([92, 34, 132], 0.6, 3);

    onAdded() {
      this.game.objectManager.addObject(this.particleSystem);
      // Rot is emitted on a clock; onRemoved() drains it, so an empty frame
      // between motes cannot delete the system mid-buff.
      this.particleSystem.autoRemoveIfEmpty = false;

      for (let i = 0; i < TENDRIL_COUNT; i++) {
        this._tendrils.push({
          angle: (TWO_PI * i) / TENDRIL_COUNT + random(-0.3, 0.3),
          offset: random(TENDRIL_CYCLE_MS),
          curl: random(8, 18) * (random(1) < 0.5 ? -1 : 1),
          reach: TENDRIL_REACH * random(0.72, 1),
        });
      }
      this._rot(5);
    }

    onRemoved() {
      this.particleSystem.autoRemoveIfEmpty = true;
    }

    _rot(count: number) {
      const pos = this.owner.position;
      const r = this.owner.animatedValues.displaySize / 2;
      for (let i = 0; i < count; i++) {
        const a = random(TWO_PI);
        this.particleSystem.addParticle({
          x: pos.x + cos(a) * random(r * 0.5, r * 1.5),
          y: pos.y + sin(a) * random(r * 0.5, r * 1.5) * 0.6 + r * 0.3,
          size: random(9, 20),
          opacity: random(50, 100),
        });
      }
    }

    update() {
      if (this.dropIfAttachmentLost()) return;

      this.age += deltaTime;
      this.position.set(this.owner.position.x, this.owner.position.y);

      if (this.age >= HARD_STOP_MS) {
        this.toRemove = true;
        return;
      }

      this._rotTimer += deltaTime;
      if (this._rotTimer >= ROT_INTERVAL_MS) {
        this._rotTimer = 0;
        this._rot(1);
      }

      // Corruption beads on the heads and falls. Nothing drips until the implosion
      // has finished feeding the quiver.
      if (this.age >= IMPLODE_MS) {
        this._dripTimer += deltaTime;
        if (this._dripTimer >= DRIP_INTERVAL_MS) {
          this._dripTimer = 0;
          const r = this.owner.animatedValues.displaySize / 2;
          const i = Math.floor(random(ARROW_COUNT));
          const a = -HALF_PI - 0.55 + (i * 1.1) / (ARROW_COUNT - 1);
          this._drips.push({
            x: cos(a) * r * 1.5,
            y: sin(a) * r * 1.5 + 12,
            vy: 0.3,
            age: 0,
          });
        }
      }

      let i = 0;
      while (i < this._drips.length) {
        const drip = this._drips[i];
        drip.age += deltaTime;
        drip.y += drip.vy;
        drip.vy += 0.055;
        if (drip.age >= DRIP_LIFETIME_MS) this._drips.splice(i, 1);
        else i++;
      }
    }

    draw() {
      const size = this.owner.animatedValues.displaySize;
      const r = size / 2;
      const buff = this._anchorBuff;
      const left = buff && buff.duration ? constrain(1 - buff.timeElapsed / buff.duration, 0, 1) : 0;
      const settled = constrain((this.age - IMPLODE_MS) / 300, 0, 1);

      push();
      translate(this.position.x, this.position.y);

      // Rot creeping out of the ground and pulling back in. Squashed on y so the
      // tendrils lie flat instead of standing up like a corona.
      noFill();
      for (const tendril of this._tendrils) {
        const phase = ((this.age + tendril.offset) % TENDRIL_CYCLE_MS) / TENDRIL_CYCLE_MS;
        // out and back inside one cycle, so each is always mid-crawl
        const grow = sin(phase * PI) * settled;
        if (grow <= 0.02) continue;
        const length = r * tendril.reach * grow;
        const ca = cos(tendril.angle);
        const sa = sin(tendril.angle);

        for (const [weight, red, green, blue, alpha] of [
          [7, 22, 6, 34, 235],
          [3, 168, 84, 236, 240],
        ] as number[][]) {
          stroke(red, green, blue, alpha);
          strokeWeight(weight);
          beginShape();
          for (let k = 0; k <= 10; k++) {
            const u = k / 10;
            const along = r * 0.42 + length * u;
            // it snakes harder the further out it gets, and hooks at the tip
            const off = sin(u * PI * 2.4 + this.age / 260 + tendril.offset) * tendril.curl * u;
            const x = ca * along - sa * off;
            const y = (sa * along + ca * off) * 0.55;
            vertex(x, y);
          }
          endShape();
        }

        // the growing tip, the only bright point on an otherwise black filament
        const tipAlong = r * 0.42 + length;
        const tipOff = sin(PI * 2.4 + this.age / 260 + tendril.offset) * tendril.curl;
        noStroke();
        fill(214, 150, 255, 220);
        circle(ca * tipAlong - sa * tipOff, (sa * tipAlong + ca * tipOff) * 0.55, 5);
      }

      // Corruption dripping off the heads and soaking into the ground.
      noStroke();
      for (const drip of this._drips) {
        const t = drip.age / DRIP_LIFETIME_MS;
        fill(150, 62, 220, 230 * (1 - t));
        // stretched by its own fall speed, which is what makes a dot read as a drop
        ellipse(drip.x, drip.y, 4 * (1 - t * 0.4), (4 + drip.vy * 3) * (1 - t * 0.4));
      }

      // The quiver: three blackened heads in a fan, bobbing on a slow breath.
      for (let i = 0; i < ARROW_COUNT; i++) {
        const a = -HALF_PI - 0.55 + (i * 1.1) / (ARROW_COUNT - 1);
        const bob = sin(this.age / 420 + i) * 2;
        push();
        translate(cos(a) * (r * 1.5 + bob), sin(a) * (r * 1.5 + bob));
        rotate(a + HALF_PI);
        scale(settled);
        // shaft
        stroke(18, 8, 26, 245);
        strokeWeight(4);
        line(0, 10, 0, -4);
        // head, dark with a corrupted edge
        noStroke();
        fill(20, 8, 30, 250);
        beginShape();
        vertex(0, -16);
        vertex(6, -2);
        vertex(0, 2);
        vertex(-6, -2);
        endShape(CLOSE);
        noFill();
        stroke(176, 96, 244, 235);
        strokeWeight(1.6);
        beginShape();
        vertex(0, -16);
        vertex(6, -2);
        vertex(0, 2);
        vertex(-6, -2);
        endShape(CLOSE);
        pop();
      }

      // How much of the quiver is left to spend.
      noFill();
      stroke(40, 18, 58, 120);
      strokeWeight(4);
      circle(0, 0, size * 1.95);
      stroke(184, 104, 248, 235);
      strokeWeight(4);
      arc(0, 0, size * 1.95, size * 1.95, -HALF_PI, -HALF_PI + TWO_PI * left);

      // The implosion. A wide dark ring closing onto him, then the violet flash of
      // it arriving — a windup, not a burst, and it is the whole cast animation.
      if (this.age < IMPLODE_MS) {
        const t = this.age / IMPLODE_MS;
        // eased in: slow to start, snapping shut at the end
        const close = t * t;
        noFill();
        stroke(28, 10, 42, 220);
        strokeWeight(9 * (1 - t) + 2);
        circle(0, 0, lerp(size + 220, size * 0.4, close));
        stroke(168, 84, 236, 230);
        strokeWeight(3.5 * (1 - t) + 1);
        circle(0, 0, lerp(size + 180, size * 0.3, close));
        // small feeder streaks riding the ring in, so the collapse has texture
        stroke(212, 150, 255, 200 * (1 - t));
        strokeWeight(2);
        for (let i = 0; i < 8; i++) {
          const ang = (TWO_PI * i) / 8 + t * 1.2;
          const outer = lerp(size * 0.5 + 130, size * 0.24, close);
          line(cos(ang) * outer, sin(ang) * outer, cos(ang) * (outer - 22), sin(ang) * (outer - 22));
        }
      } else if (this.age < IMPLODE_MS + 220) {
        const flash = 1 - (this.age - IMPLODE_MS) / 220;
        noStroke();
        fill(196, 122, 255, 210 * flash);
        circle(0, 0, size * flash + 12);
      }

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.owner.animatedValues.displaySize / 2 + BOUNDING_MARGIN;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Varus_W_Object;
}
const __cacheVarus_W_Object = new WeakMap<ContentApi, ReturnType<typeof __buildVarus_W_Object>>();
export function makeVarus_W_Object(api: ContentApi) {
  const cached = __cacheVarus_W_Object.get(api);
  if (cached) return cached;
  const built = __buildVarus_W_Object(api);
  __cacheVarus_W_Object.set(api, built);
  return built;
}
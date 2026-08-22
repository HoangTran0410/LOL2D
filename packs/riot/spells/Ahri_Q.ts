import type { ContentApi } from '@moba2d/core/content/ContentApi';

type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Ahri_Q = InstanceType<ReturnType<typeof makeAhri_Q>>;
type Ahri_Q_Impact = InstanceType<ReturnType<typeof makeAhri_Q_Impact>>;
type Ahri_Q_Object = InstanceType<ReturnType<typeof makeAhri_Q_Object>>;



/**
 * Nine tails. Every Ahri effect repeats the count, which is what makes her
 * spells recognisably *hers* at a glance rather than "a purple circle".
 */
export const AHRI_TAIL_COUNT = 9;

/** Windup: the orb inflates out of her hands instead of appearing whole. */
export const ORB_SPAWN_MS = 130;

/** How long the arcane burst left on a struck body stays up. */
export const Q_IMPACT_MS = 340;

/** How far past its hitbox the orb paints, as a multiple of `size`. */
export const ORB_PAINT_REACH = 1.7;


function __buildAhri_Q(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Ahri_Q_Object = makeAhri_Q_Object(api);
  class Ahri_Q extends Spell {
    targetingMode = 'DIRECTION' as const;
    image = api.asset('spell_ahri_q');
    name = 'Quả Cầu Ma Thuật (Ahri_Q)';
    description =
      'Phóng quả cầu theo hướng chỉ định, khi tới giới hạn 350px, quả cầu sẽ quay lại. Gây <span class="damage">15 sát thương</span> và <span class="buff">Làm Chậm 50%</span> trong <span class="time">0.5 giây</span> trên cả đường đi và đường về của quả cầu';
    coolDown = 5000;
    manaCost = 20;

    onSpellCast() {
      const { from, to } = VectorUtils.getVectorWithRange(this.owner.position, this.aimPoint, 350);

      const obj = new Ahri_Q_Object(this.owner);
      obj.position = from;
      obj.destination = to;
      this.game.objectManager.addObject(obj);
    }

    onUpdate() {}
  }
  return Ahri_Q;
}
const __cacheAhri_Q = new WeakMap<ContentApi, ReturnType<typeof __buildAhri_Q>>();
export default function makeAhri_Q(api: ContentApi) {
  const cached = __cacheAhri_Q.get(api);
  if (cached) return cached;
  const built = __buildAhri_Q(api);
  __cacheAhri_Q.set(api, built);
  return built;
}


function __buildAhri_Q_Object(api: ContentApi) {
  const MissileSpellObject = api.MissileSpellObject;
  const Slow = api.buffs.Slow;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  const TrailSystem = api.helpers.TrailSystem;
  const Ahri_Q_Impact = makeAhri_Q_Impact(api);
  class Ahri_Q_Object extends MissileSpellObject {
    speed = 7;
    size = 35;
    // the orb turns around at max range instead of dying there
    removeOnArrive = false;

    speedBackward = 15;
    increaseSpeedBackward = 0.2;

    static PHASES = {
      FORWARD: 'FORWARD',
      BACKWARD: 'BACKWARD',
    } as const;

    phase: (typeof Ahri_Q_Object.PHASES)[keyof typeof Ahri_Q_Object.PHASES] =
      Ahri_Q_Object.PHASES.FORWARD;

    trailSystem = new TrailSystem({
      trailColor: '#6AA5D655',
      trailSize: this.size,
    });
    particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize('#9AC5E8AA');

    /** Cosmetic: drives the spawn inflation and nothing else. */
    _age = 0;
    // Cosmetic: the tails wheel around the orb at a steady rate. Seeded at zero
    // rather than at a random phase — a field initializer runs at construction,
    // which is outside the sketch in the unit tests that build this missile.
    _spin = 0;

    onAdded() {
      super.onAdded();
      this.game.objectManager.addObject(this.particleSystem);
    }

    onBeforeMove() {
      // increase speed when move back to owner
      if (this.phase === Ahri_Q_Object.PHASES.BACKWARD) {
        this.speed = constrain(this.speed + this.increaseSpeedBackward, 0, this.speedBackward);
      }
    }

    onArrive() {
      if (this.phase === Ahri_Q_Object.PHASES.FORWARD) {
        this.destination = this.owner.position; // move back to owner (live ref: follows the owner)
        this.hitTargets = []; // the return trip may hit the same enemies again
        this.speed = 0;
        this.phase = Ahri_Q_Object.PHASES.BACKWARD;
        // the turn is the one moment the player has to re-read the orb's path, so
        // it gets its own flare rather than happening silently mid-flight
        this.trailSystem.trailColor = '#D2E5F599';
      } else {
        this.toRemove = true;
      }
    }

    onHit(enemy: any) {
      const slowBuff = new Slow(500, this.owner, enemy);
      slowBuff.percent = 0.5;
      enemy.addBuff(slowBuff);

      enemy.takeDamage(15, this.owner);

      // the orb flies straight on through, so the hit has to leave its own mark —
      // otherwise the only feedback a clipped target gets is the damage number
      const burst = new Ahri_Q_Impact(this.owner);
      burst.position = enemy.position.copy();
      burst.targetSize = enemy.animatedValues?.displaySize ?? 40;
      burst.returning = this.phase === Ahri_Q_Object.PHASES.BACKWARD;
      this.game.objectManager.addObject(burst);
    }

    update() {
      super.update();

      this._age += deltaTime;
      this._spin += deltaTime / 260;

      // motes shed off the shell going out, off the bare core coming back
      if (random() < 0.7) {
        const r = this.size / 2;
        this.particleSystem.addParticle({
          x: this.position.x + random(-r, r),
          y: this.position.y + random(-r, r),
          r: random(5, 10),
        });
      }
    }

    draw() {
      const angle = this.destination.copy().sub(this.position).heading();
      // ease-out: nearly full size almost at once, then settles — a thrown orb,
      // not a scale tween the eye can follow
      const grow = constrain(this._age / ORB_SPAWN_MS, 0, 1);
      const scaleUp = 1 - (1 - grow) * (1 - grow);
      const returning = this.phase === Ahri_Q_Object.PHASES.BACKWARD;
      const r = (this.size / 2) * scaleUp;

      push();
      translate(this.position.x, this.position.y);
      rotate(angle);
      // speed smears the orb along its own line; the return trip is the fast one
      scale(1 + this.speed * 0.018, 1);
      noStroke();

      // arcane halo. Additive so two orbs crossing read as brighter rather than
      // as two flat discs stacked on each other.
      blendMode(ADD);
      fill(60, 126, 180, returning ? 80 : 55);
      circle(0, 0, r * 3.4);
      blendMode(BLEND);

      // nine tails wheeling around the orb. On the way back the shell is gone and
      // they whip out much further — that difference is how the player tells the
      // outbound orb from the return one without watching where it came from.
      for (let i = 0; i < AHRI_TAIL_COUNT; i++) {
        const a = (TWO_PI * i) / AHRI_TAIL_COUNT + this._spin * (returning ? -1.6 : 1);
        const wobble = 1 + sin(this._spin * 3 + i) * 0.18;
        const len = r * (returning ? 2.3 : 1.6) * wobble;
        push();
        rotate(a);
        fill(130, 182, 225, returning ? 210 : 160);
        triangle(r * 0.5, -r * 0.32, r * 0.5, r * 0.32, len, 0);
        fill(215, 234, 250, returning ? 200 : 140);
        triangle(r * 0.6, -r * 0.13, r * 0.6, r * 0.13, len * 0.8, 0);
        pop();
      }

      // the outer shell, which only exists on the way out
      if (!returning) {
        fill(74, 142, 198, 165);
        circle(0, 0, r * 2);
        noFill();
        stroke(160, 201, 235, 220);
        strokeWeight(2.5);
        circle(0, 0, r * 2);
        noStroke();
      }

      // exposed core: white-hot coming back, banked behind the shell going out
      fill(236, 245, 252, returning ? 250 : 200);
      circle(0, 0, r * (returning ? 1.15 : 0.95));
      fill(255, 255, 255, returning ? 235 : 150);
      circle(0, 0, r * (returning ? 0.6 : 0.45));

      // a rune ring drops in for the return, spinning against the tails so the
      // orb visibly changes state instead of merely reversing direction
      if (returning) {
        noFill();
        stroke(190, 220, 245, 190);
        strokeWeight(2);
        const segments = 12;
        for (let i = 0; i < segments; i += 2) {
          const a1 = (TWO_PI * i) / segments + this._spin * 2;
          const a2 = (TWO_PI * (i + 1)) / segments + this._spin * 2;
          arc(0, 0, r * 2.7, r * 2.7, a1, a2);
        }
      }

      pop();
    }

    // tails and halo reach well past the 35px hitbox
    getDisplayBoundingBox() {
      const r = this.size * ORB_PAINT_REACH;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Ahri_Q_Object;
}
const __cacheAhri_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildAhri_Q_Object>>();
export function makeAhri_Q_Object(api: ContentApi) {
  const cached = __cacheAhri_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildAhri_Q_Object(api);
  __cacheAhri_Q_Object.set(api, built);
  return built;
}


/**
 * The mark left on a body the orb passed through: an arcane bloom that throws
 * nine wisps outward, so the hit reads as Ahri's and not as a generic spark.
 */
function __buildAhri_Q_Impact(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Ahri_Q_Impact extends SpellObject {
    targetSize = 40;
    /** The return trip hits harder in the fiction; it burns brighter here too. */
    returning = false;
    age = 0;
    lifeTime = Q_IMPACT_MS;
    maxRadius = 52;

    _wisps: { a: number; speed: number; len: number }[] = [];

    onAdded() {
      for (let i = 0; i < AHRI_TAIL_COUNT; i++) {
        this._wisps.push({
          a: (TWO_PI * i) / AHRI_TAIL_COUNT + random(-0.2, 0.2),
          speed: random(0.7, 1.25),
          len: random(10, 20),
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
      // the flash is the frame of contact; it has to be gone before the eye can
      // dwell on it, or every clipped minion turns the screen pink
      const flash = 1 - constrain(t / 0.3, 0, 1);
      const bright = this.returning ? 1 : 0.75;

      push();
      translate(this.position.x, this.position.y);

      if (flash > 0) {
        blendMode(ADD);
        noStroke();
        fill(170, 208, 240, 170 * flash * bright);
        circle(0, 0, this.targetSize * 0.9 + t * 50);
        blendMode(BLEND);
      }

      // ring on the body that took it: whoever is inside this got the slow
      noFill();
      stroke(120, 178, 225, 225 * fade * bright);
      strokeWeight(3.5 * fade + 1);
      circle(0, 0, this.targetSize * 0.7 + this.maxRadius * t);

      // nine wisps flung off the point of contact, tapering as they go
      stroke(210, 232, 250, 235 * fade);
      strokeWeight(2.5 * fade + 0.6);
      for (const w of this._wisps) {
        const d = 8 + this.maxRadius * t * w.speed;
        // the curl is what stops these reading as a plain star of straight lines
        const a = w.a + t * 0.6;
        const dx = cos(a);
        const dy = sin(a);
        line(dx * d, dy * d, dx * (d + w.len * fade), dy * (d + w.len * fade));
      }

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.targetSize + this.maxRadius + 20;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Ahri_Q_Impact;
}
const __cacheAhri_Q_Impact = new WeakMap<ContentApi, ReturnType<typeof __buildAhri_Q_Impact>>();
export function makeAhri_Q_Impact(api: ContentApi) {
  const cached = __cacheAhri_Q_Impact.get(api);
  if (cached) return cached;
  const built = __buildAhri_Q_Impact(api);
  __cacheAhri_Q_Impact.set(api, built);
  return built;
}
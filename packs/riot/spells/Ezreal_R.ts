import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec } from '@moba2d/core/content/types';
import { makeDetonateEssenceFlux } from './Ezreal_W';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Champion = InstanceType<ContentApi['units']['Champion']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Ezreal_R = InstanceType<ReturnType<typeof makeEzreal_R>>;
type Ezreal_R_Charge = InstanceType<ReturnType<typeof makeEzreal_R_Charge>>;
type Ezreal_R_Object = InstanceType<ReturnType<typeof makeEzreal_R_Object>>;



/** Not literally global, but far enough to cross most of a fight from outside it. */
export const EZREAL_R_RANGE = 2400;

export const EZREAL_R_SPEED = 26;

/** The beam's hit width, and what the art is drawn at — the rim is the hitbox. */
export const EZREAL_R_WIDTH = 120;

export const EZREAL_R_DAMAGE = 55;

/** Minions and camps take less, so a wave does not eat a 100-second cooldown. */
export const EZREAL_R_MINION_DAMAGE = 32;

export const EZREAL_R_CAST_TIME_MS = 700;


/**
 * Trueshot Barrage — the windup is the ability.
 *
 * Seven hundred milliseconds of visible charge is the whole counterplay: the
 * beam itself pierces everything and cannot be dodged once it is out, so the
 * telegraph has to be long, loud and anchored on Ezreal where the enemy team can
 * see who is doing it.
 */
function __buildEzreal_R(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Ezreal_R_Object = makeEzreal_R_Object(api);
  const Ezreal_R_Charge = makeEzreal_R_Charge(api);
  class Ezreal_R extends Spell {
    image = api.asset('spell_ezreal_r');
    name = 'Cung Ánh Sáng (Ezreal_R)';
    description =
      `Tích tụ trong <span class="time">${EZREAL_R_CAST_TIME_MS / 1000} giây</span> rồi bắn một luồng` +
      ' năng lượng khổng lồ xuyên qua toàn bộ kẻ địch trên đường đi, gây' +
      ` <span class="damage">${EZREAL_R_DAMAGE} sát thương</span> lên tướng và` +
      ` <span class="damage">${EZREAL_R_MINION_DAMAGE} sát thương</span> lên lính và quái.`;

    coolDown = 10000;
    manaCost = 100;

    range = EZREAL_R_RANGE;

    private charge: Ezreal_R_Charge | null = null;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'DIRECTION',
        castTimeMs: EZREAL_R_CAST_TIME_MS,
        // Paid up front so the mana is visibly gone while he is charging, and
        // handed straight back if anything takes the charge off him — an ult that
        // is interrupted should cost the interruption, not the ult.
        resource: {
          commitAt: 'start',
          refundOn: ['STUN', 'SILENCE', 'DISPLACEMENT', 'MOVE'],
        },
        cooldown: { startAt: 'release', durationMs: this.coolDown },
      };
    }

    onCastStart() {
      this.clearCharge();
      const charge = new Ezreal_R_Charge(this.owner);
      charge.lifeTime = EZREAL_R_CAST_TIME_MS;
      charge.attachTo(this.owner);
      this.charge = charge;
      this.game.objectManager.addObject(charge);
    }

    onSpellCast(context: CastContext) {
      this.clearCharge();

      const direction = this.firingDirection(context);
      const aim = createVector(
        this.owner.position.x + direction.x * EZREAL_R_RANGE,
        this.owner.position.y + direction.y * EZREAL_R_RANGE
      );
      const { from, to } = VectorUtils.getVectorWithRange(this.owner.position, aim, EZREAL_R_RANGE);

      const beam = new Ezreal_R_Object(this.owner);
      beam.position = from;
      beam.destination = to;
      this.game.objectManager.addObject(beam);
    }

    onCancel() {
      this.clearCharge();
    }

    onComplete() {
      this.clearCharge();
    }

    /** Idempotent: death, cancel and normal completion all converge here. */
    private clearCharge() {
      if (this.charge) this.charge.toRemove = true;
      this.charge = null;
    }
  }
  return Ezreal_R;
}
const __cacheEzreal_R = new WeakMap<ContentApi, ReturnType<typeof __buildEzreal_R>>();
export default function makeEzreal_R(api: ContentApi) {
  const cached = __cacheEzreal_R.get(api);
  if (cached) return cached;
  const built = __buildEzreal_R(api);
  __cacheEzreal_R.set(api, built);
  return built;
}


/**
 * The beam.
 *
 * It is drawn as a *column* — a wide core with counter-rotating rune bands
 * riding it — rather than a missile with a trail, because at this width the
 * thing the player has to judge is whether their body is inside the rim. The
 * rim is drawn at exactly `size`, which is the hitbox.
 */
function __buildEzreal_R_Object(api: ContentApi) {
  const MissileSpellObject = api.MissileSpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  const Champion = api.units.Champion;
  const TrailSystem = api.helpers.TrailSystem;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  const detonateEssenceFlux = makeDetonateEssenceFlux(api);
  class Ezreal_R_Object extends MissileSpellObject {
    speed = EZREAL_R_SPEED;
    size = EZREAL_R_WIDTH;
    /** Pierces everything on the way through — nothing stops the barrage. */
    maxHitCount = Infinity;
    visionRadius = 260;

    trailSystem = new TrailSystem({
      trailColor: 'rgba(255, 214, 120, 0.34)',
      trailSize: EZREAL_R_WIDTH * 0.7,
      trailLifeTime: 620,
      maxLength: 34,
    });

    particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize(
      'rgba(255, 226, 150, 0.5)',
      0.22
    );

    travelled = 0;

    onAdded() {
      super.onAdded();
      this.useParticles(this.particleSystem);
    }

    onAfterMove() {
      this.travelled += this.speed;
      if (frameCount % 2 === 0) {
        this.particleSystem.addParticle({
          x: this.position.x + random(-EZREAL_R_WIDTH / 2, EZREAL_R_WIDTH / 2),
          y: this.position.y + random(-EZREAL_R_WIDTH / 2, EZREAL_R_WIDTH / 2),
          r: random(6, 16),
        });
      }
    }

    onHit(enemy: AttackableUnit) {
      const damage = enemy instanceof Champion ? EZREAL_R_DAMAGE : EZREAL_R_MINION_DAMAGE;
      enemy.takeDamage(damage, this.owner);
      detonateEssenceFlux(this.owner, enemy);
    }

    draw() {
      const angle = Math.atan2(
        this.destination.y - this.position.y,
        this.destination.x - this.position.x
      );
      // it accelerates out of the gauntlet: short and stubby on frame one, full
      // length by 200px, so the beam is fired rather than simply present
      const grow = constrain(this.travelled / 200, 0.3, 1);
      const w = this.size;
      const len = w * 2.4 * grow;

      push();
      translate(this.position.x, this.position.y);
      rotate(angle);

      // outer bloom
      noStroke();
      fill(255, 176, 60, 55);
      ellipse(-len * 0.2, 0, len * 1.7, w * 1.5);
      fill(255, 210, 120, 80);
      ellipse(-len * 0.1, 0, len * 1.2, w * 1.05);

      // the body of the column, drawn at the real hit width
      fill(255, 232, 165, 205);
      ellipse(0, 0, len, w);

      // rune bands riding the column, counter-rotating so the beam looks like it
      // is spinning rather than sliding
      noFill();
      for (let i = 0; i < 4; i++) {
        const offset = ((this.travelled * 0.6 + i * 60) % 200) / 200;
        const x = len * (0.5 - offset);
        const squeeze = 0.55 + 0.45 * sin(offset * PI);
        stroke(255, 246, 210, 200);
        strokeWeight(3);
        ellipse(x, 0, w * 0.22, w * squeeze);
      }

      // the rim: the edge of the hitbox, hard so nobody has to guess
      stroke(255, 190, 80, 235);
      strokeWeight(3);
      line(-len * 0.5, -w / 2, len * 0.45, -w / 2);
      line(-len * 0.5, w / 2, len * 0.45, w / 2);

      // leading edge
      noStroke();
      fill(255, 253, 240, 240);
      ellipse(len * 0.4, 0, w * 0.35, w * 0.62);
      pop();
    }

    getDisplayBoundingBox() {
      // the column paints well behind its own centre, and the box decides whether
      // draw() is called at all
      const r = this.size * 2;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Ezreal_R_Object;
}
const __cacheEzreal_R_Object = new WeakMap<ContentApi, ReturnType<typeof __buildEzreal_R_Object>>();
export function makeEzreal_R_Object(api: ContentApi) {
  const cached = __cacheEzreal_R_Object.get(api);
  if (cached) return cached;
  const built = __buildEzreal_R_Object(api);
  __cacheEzreal_R_Object.set(api, built);
  return built;
}


/**
 * The charge, riding Ezreal's body for the whole windup.
 *
 * A `SpellObject` and not `castSpec.vfx`: this is the only warning the enemy
 * team gets, and caster VFX stops being drawn the moment the caster is culled or
 * fogged — which is exactly when an Ezreal is charging one of these.
 */
function __buildEzreal_R_Charge(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  class Ezreal_R_Charge extends SpellObject {
    age = 0;
    lifeTime = EZREAL_R_CAST_TIME_MS;
    radius = 60;

    particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize(
      'rgba(255, 220, 140, 0.6)',
      0.2
    );

    /** Seeded once: motes drawn in from a fixed ring of directions. */
    _intake: number[] = [];

    onAdded() {
      this.useParticles(this.particleSystem);
      for (let i = 0; i < 10; i++) this._intake.push((TWO_PI / 10) * i + random(-0.2, 0.2));
    }

    update() {
      if (this.dropIfAttachmentLost()) return;
      this.position.set(this.owner.position.x, this.owner.position.y);

      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;

      if (frameCount % 3 === 0) {
        this.particleSystem.addParticle({
          x: this.position.x + random(-this.radius, this.radius),
          y: this.position.y + random(-this.radius, this.radius),
          r: random(3, 8),
        });
      }
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      // wind-in easing: slow at first, then it snaps shut just before the shot
      const wind = t * t;

      push();
      translate(this.position.x, this.position.y);

      // energy being pulled inward along fixed spokes
      stroke(255, 222, 150, 200);
      for (let i = 0; i < this._intake.length; i++) {
        const a = this._intake[i] + t * 1.6;
        const outer = this.radius * (1 - wind) + 14;
        const inner = outer * 0.55;
        strokeWeight(2 + 2 * wind);
        line(cos(a) * outer, sin(a) * outer, cos(a) * inner, sin(a) * inner);
      }

      // the compressing core
      noStroke();
      fill(255, 200, 100, 120 + 100 * wind);
      circle(0, 0, 12 + 34 * wind);
      fill(255, 252, 235, 200 + 55 * wind);
      circle(0, 0, 4 + 16 * wind);

      // the charge ring closing: a readable countdown to the shot
      noFill();
      stroke(255, 235, 175, 235);
      strokeWeight(3);
      arc(
        0,
        0,
        this.radius * 2 * (1 - 0.45 * wind),
        this.radius * 2 * (1 - 0.45 * wind),
        -HALF_PI,
        -HALF_PI + TWO_PI * t
      );
      pop();
    }

    getDisplayBoundingBox() {
      const r = this.radius * 1.6;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Ezreal_R_Charge;
}
const __cacheEzreal_R_Charge = new WeakMap<ContentApi, ReturnType<typeof __buildEzreal_R_Charge>>();
export function makeEzreal_R_Charge(api: ContentApi) {
  const cached = __cacheEzreal_R_Charge.get(api);
  if (cached) return cached;
  const built = __buildEzreal_R_Charge(api);
  __cacheEzreal_R_Charge.set(api, built);
  return built;
}
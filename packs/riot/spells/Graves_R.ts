import type { ContentApi } from '@moba2d/core/content/ContentApi';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Graves_R = InstanceType<ReturnType<typeof makeGraves_R>>;
type Graves_R_Impact = InstanceType<ReturnType<typeof makeGraves_R_Impact>>;
type Graves_R_Muzzle = InstanceType<ReturnType<typeof makeGraves_R_Muzzle>>;
type Graves_R_Object = InstanceType<ReturnType<typeof makeGraves_R_Object>>;



export const RANGE = 700;

export const DAMAGE = 45;

export const FALLOFF = 10;


/** The flash at the barrel: brief, because a long one reads as a beam. */
export const MUZZLE_MS = 260;

/** How long the wreckage of a hit stays on the body it happened to. */
export const IMPACT_MS = 400;

/** Splinters thrown off a body the shell punched through. */
export const DEBRIS_COUNT = 9;

/** Brass casings kicked out of the break when the barrel is emptied. */
export const CASING_COUNT = 2;


/**
 * Collateral Damage: one barrel, everything in the line. Damage falls off per
 * body so the shot rewards catching the front of a group rather than the back.
 */
function __buildGraves_R(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Graves_R_Object = makeGraves_R_Object(api);
  const Graves_R_Muzzle = makeGraves_R_Muzzle(api);
  class Graves_R extends Spell {
    targetingMode = 'DIRECTION' as const;
    image = api.asset('spell_graves_r');
    name = 'Đạn Nổ Thần Công (Graves_R)';
    description =
      `Nã một phát đại bác xuyên thẳng <span>${RANGE}px</span>: <span class="damage">${DAMAGE} sát thương</span>` +
      ` cho mục tiêu đầu tiên, <span class="damage">giảm ${FALLOFF}</span> cho mỗi mục tiêu tiếp theo,` +
      ` kèm <span class="buff">Làm Chậm 40%</span>`;
    coolDown = 10000;
    manaCost = 60;

    range = RANGE;

    onSpellCast() {
      const { to } = VectorUtils.getVectorWithRange(this.owner.position, this.aimPoint, this.range);
      const shot = new Graves_R_Object(this.owner);
      shot.destination = to;
      this.game.objectManager.addObject(shot);

      // The bang has to be its own object: it paints a cone and a smoke ring far
      // wider than Graves' body, and anything drawn from the champion vanishes the
      // moment he is culled while the shell it launched flies on regardless.
      const muzzle = new Graves_R_Muzzle(this.owner);
      muzzle.position = this.owner.position.copy();
      muzzle.angle = Math.atan2(to.y - this.owner.position.y, to.x - this.owner.position.x);
      this.game.objectManager.addObject(muzzle);
    }

    drawPreview() {
      super.drawPreview(this.range);
    }
  }
  return Graves_R;
}
const __cacheGraves_R = new WeakMap<ContentApi, ReturnType<typeof __buildGraves_R>>();
export default function makeGraves_R(api: ContentApi) {
  const cached = __cacheGraves_R.get(api);
  if (cached) return cached;
  const built = __buildGraves_R(api);
  __cacheGraves_R.set(api, built);
  return built;
}


function __buildGraves_R_Object(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const MissileSpellObject = api.MissileSpellObject;
  const Slow = api.buffs.Slow;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  const AttackableUnit = api.units.AttackableUnit;
  const Graves_R_Impact = makeGraves_R_Impact(api);
  class Graves_R_Object extends MissileSpellObject {
    speed = 22;
    size = 34;
    /** Infinity: the shell does not stop at the first body, it goes through it. */
    maxHitCount = Infinity;

    /** Powder smoke laid down along the shell's line, left hanging after it passes. */
    particleSystem = PredefinedParticleSystems.smoke([132, 128, 122], 0.9, 4);

    /** Cosmetic: drives the tumble and the burning-powder flicker. */
    _age = 0;

    onAdded() {
      super.onAdded();
      this.game.objectManager.addObject(this.particleSystem);
    }

    onHit(enemy: AttackableUnit) {
      // `hitTargets` already contains this one, so the first victim pays full.
      const order = Math.max(0, this.hitTargets.length - 1);
      enemy.takeDamage(Math.max(10, DAMAGE - order * FALLOFF), this.owner);
      const slow = new Slow(1500, this.owner, enemy);
      slow.percent = 0.4;
      enemy.addBuff(slow);

      // the shell keeps going, so each body it punches through needs its own
      // wreckage — otherwise a five-man ultimate lands in total silence
      const impact = new Graves_R_Impact(this.owner);
      impact.position = enemy.position.copy();
      impact.angle = this._heading();
      impact.targetSize = enemy.animatedValues?.displaySize ?? 40;
      // the front of the line takes the loudest hit, matching the falloff
      impact.force = constrain(1 - order * 0.18, 0.4, 1);
      this.game.objectManager.addObject(impact);
    }

    _heading() {
      return Math.atan2(this.destination.y - this.position.y, this.destination.x - this.position.x);
    }

    update() {
      super.update();
      this._age += deltaTime;

      // powder smoke is dropped where the shell *was*, so the trail hangs in the
      // air behind it instead of riding along with the projectile
      this.particleSystem.addParticle({
        x: this.position.x + random(-8, 8),
        y: this.position.y + random(-8, 8),
        size: random(16, 30),
        opacity: random(90, 150),
      });
    }

    draw() {
      const angle = this._heading();
      const flicker = sin(this._age / 45);

      push();
      translate(this.position.x, this.position.y);
      rotate(angle);
      noStroke();

      // burning powder streaming off the back — a wide, ragged cone rather than a
      // clean triangle, because this is a shotgun slug and not a laser
      fill(255, 150, 50, 70);
      triangle(-58 - flicker * 6, -22, -58 - flicker * 6, 22, 14, 0);
      fill(255, 196, 96, 130);
      triangle(-34 + flicker * 4, -12, -34 + flicker * 4, 12, 12, 0);

      // the slug itself: cast iron, dark enough to stay a solid shape against its
      // own muzzle fire, with a leading edge already glowing from the ride
      fill(46, 42, 40, 250);
      circle(2, 0, this.size * 0.78);
      fill(84, 78, 74, 250);
      // the tumble — a slug this heavy should be visibly rolling, not sliding
      push();
      rotate(this._age / 60);
      arc(2, 0, this.size * 0.78, this.size * 0.78, 0, PI);
      pop();
      fill(255, 168, 62, 235);
      arc(2, 0, this.size * 0.8, this.size * 0.8, -0.9, 0.9);
      fill(255, 246, 208, 230);
      arc(2, 0, this.size * 0.6, this.size * 0.6, -0.5, 0.5);

      pop();
    }

    getDisplayBoundingBox() {
      // the powder cone reaches a long way behind the 34px slug
      return new Rectangle({
        x: this.position.x - this.size * 2.5,
        y: this.position.y - this.size * 2.5,
        w: this.size * 5,
        h: this.size * 5,
        data: this,
      });
    }
  }
  return Graves_R_Object;
}
const __cacheGraves_R_Object = new WeakMap<ContentApi, ReturnType<typeof __buildGraves_R_Object>>();
export function makeGraves_R_Object(api: ContentApi) {
  const cached = __cacheGraves_R_Object.get(api);
  if (cached) return cached;
  const built = __buildGraves_R_Object(api);
  __cacheGraves_R_Object.set(api, built);
  return built;
}


/**
 * The bang at the barrel: fire, smoke, and two brass casings kicked clear.
 * Fixed in world space rather than following Graves, because a muzzle flash
 * belongs to the moment of firing and not to the man walking away from it.
 */
function __buildGraves_R_Muzzle(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Graves_R_Muzzle extends SpellObject {
    angle = 0;
    age = 0;
    lifeTime = MUZZLE_MS;
    reach = 110;

    _casings: { a: number; speed: number; spin: number; hop: number }[] = [];

    onAdded() {
      for (let i = 0; i < CASING_COUNT; i++) {
        this._casings.push({
          // ejected out the side of the break, never forward down the barrel
          a: this.angle + (i % 2 ? 1 : -1) * random(1.9, 2.5),
          speed: random(0.7, 1.2),
          spin: random(8, 16),
          hop: random(10, 20),
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

      // smoke ring blown off the barrel, expanding and thinning
      noFill();
      stroke(150, 146, 140, 130 * fade);
      strokeWeight(9 * fade + 2);
      circle(0, 0, this.reach * (0.4 + t * 1.1));

      push();
      rotate(this.angle);
      noStroke();

      // the flash: a short, hot cone that dies inside the first third of the life
      const flash = 1 - constrain(t / 0.35, 0, 1);
      if (flash > 0) {
        blendMode(ADD);
        fill(255, 150, 40, 200 * flash);
        triangle(0, -34 * flash, 0, 34 * flash, this.reach * (0.5 + flash * 0.5), 0);
        fill(255, 226, 150, 235 * flash);
        triangle(0, -18 * flash, 0, 18 * flash, this.reach * 0.55 * flash + 20, 0);
        fill(255, 255, 245, 240 * flash);
        circle(6, 0, 30 * flash + 8);
        blendMode(BLEND);
      }
      pop();

      // brass tumbling out and falling — the small physical detail that makes the
      // shot read as a gun being fired rather than as an effect being played
      for (const c of this._casings) {
        const d = 12 + this.reach * 0.55 * t * c.speed;
        // arcs up, then drops back down: sin over the life, not a straight line
        const lift = sin(t * PI) * c.hop;
        push();
        translate(cos(c.a) * d, sin(c.a) * d - lift);
        rotate(c.a + t * c.spin);
        stroke(120, 88, 34, 235 * fade);
        strokeWeight(1);
        fill(206, 162, 68, 245 * fade);
        rect(-6, -2.5, 12, 5, 1);
        noStroke();
        fill(238, 210, 140, 240 * fade);
        rect(-6, -2.5, 3.5, 5, 1);
        pop();
      }

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.reach + 40;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Graves_R_Muzzle;
}
const __cacheGraves_R_Muzzle = new WeakMap<ContentApi, ReturnType<typeof __buildGraves_R_Muzzle>>();
export function makeGraves_R_Muzzle(api: ContentApi) {
  const cached = __cacheGraves_R_Muzzle.get(api);
  if (cached) return cached;
  const built = __buildGraves_R_Muzzle(api);
  __cacheGraves_R_Muzzle.set(api, built);
  return built;
}


/** Where the slug went through someone: a flash, a spall ring and splinters. */
function __buildGraves_R_Impact(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Graves_R_Impact extends SpellObject {
    angle = 0;
    targetSize = 40;
    /** 1 at the front of the line, less further back — matches the damage falloff. */
    force = 1;
    age = 0;
    lifeTime = IMPACT_MS;
    maxRadius = 62;

    _debris: { a: number; speed: number; len: number; spin: number }[] = [];

    onAdded() {
      for (let i = 0; i < DEBRIS_COUNT; i++) {
        this._debris.push({
          // biased forward along the shell's line: the shot carries them with it
          a: this.angle + random(-1.2, 1.2),
          speed: random(0.6, 1.4),
          len: random(5, 11),
          spin: random(-0.5, 0.5),
        });
      }
    }

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = (1 - t) * this.force;
      const flash = (1 - constrain(t / 0.22, 0, 1)) * this.force;

      push();
      translate(this.position.x, this.position.y);

      if (flash > 0) {
        blendMode(ADD);
        noStroke();
        fill(255, 190, 110, 210 * flash);
        circle(0, 0, this.targetSize + t * 60);
        blendMode(BLEND);
      }

      // spall ring: which body actually ate the shot, readable after the flash
      noFill();
      stroke(230, 150, 70, 220 * fade);
      strokeWeight(4 * fade + 1);
      circle(0, 0, this.targetSize * 0.7 + this.maxRadius * t);

      // grey powder smoke curling off the wound
      noStroke();
      for (let i = 0; i < 3; i++) {
        const a = this.angle + PI + (i - 1) * 0.5;
        const d = 10 + 30 * t;
        fill(140, 136, 130, 120 * fade);
        circle(cos(a) * d, sin(a) * d, 14 + 16 * t);
      }

      // splinters driven on through in the direction the shell was travelling
      for (const b of this._debris) {
        const d = 8 + this.maxRadius * t * b.speed;
        push();
        translate(cos(b.a) * d, sin(b.a) * d);
        rotate(b.a + t * b.spin * 10);
        fill(58, 50, 44, 235 * fade);
        rect(-b.len / 2, -1.6, b.len, 3.2);
        pop();
      }

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.targetSize + this.maxRadius + 30;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Graves_R_Impact;
}
const __cacheGraves_R_Impact = new WeakMap<ContentApi, ReturnType<typeof __buildGraves_R_Impact>>();
export function makeGraves_R_Impact(api: ContentApi) {
  const cached = __cacheGraves_R_Impact.get(api);
  if (cached) return cached;
  const built = __buildGraves_R_Impact(api);
  __cacheGraves_R_Impact.set(api, built);
  return built;
}
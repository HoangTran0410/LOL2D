import type { ContentApi } from '@moba2d/core/content/ContentApi';

type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type RootBuff = InstanceType<ContentApi['buffs']['Root']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Lux_Q = InstanceType<ReturnType<typeof makeLux_Q>>;
type Lux_Q_Bind = InstanceType<ReturnType<typeof makeLux_Q_Bind>>;
type Lux_Q_Object = InstanceType<ReturnType<typeof makeLux_Q_Object>>;



/** Faces on the prism, and spokes in the burst it leaves. */
export const PRISM_FACES = 6;

/** Windup: the prism is struck out of light rather than appearing whole. */
export const PRISM_SPAWN_MS = 110;

/** How long the binding light on a rooted body stays up. */
export const BIND_MS = 460;


function __buildLux_Q(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Lux_Q_Object = makeLux_Q_Object(api);
  class Lux_Q extends Spell {
    targetingMode = 'DIRECTION' as const;
    name = 'Khóa Ánh Sáng (Lux_Q)';
    image = api.asset('spell_lux_q');
    description =
      'Lux phóng ra một quả cầu ánh sáng theo đường thẳng, gây <span class="damage">20 sát thương</span> và <span class="buff">Trói Chân</span> 2 kẻ địch đầu tiên trúng phải trong <span class="time">2 giây</span>';
    coolDown = 5000;
    manaCost = 20;

    onSpellCast() {
      const range = 500;
      const stunTime = 2000;

      const { to: destination } = VectorUtils.getVectorWithRange(
        this.owner.position,
        this.aimPoint,
        range
      );

      const obj = new Lux_Q_Object(this.owner);
      obj.destination = destination;
      obj.stunTime = stunTime;
      obj.maxHitCount = 2;

      this.game.objectManager.addObject(obj);
    }
  }
  return Lux_Q;
}
const __cacheLux_Q = new WeakMap<ContentApi, ReturnType<typeof __buildLux_Q>>();
export default function makeLux_Q(api: ContentApi) {
  const cached = __cacheLux_Q.get(api);
  if (cached) return cached;
  const built = __buildLux_Q(api);
  __cacheLux_Q.set(api, built);
  return built;
}


function __buildLux_Q_Object(api: ContentApi) {
  const MissileSpellObject = api.MissileSpellObject;
  const RootBuff = api.buffs.Root;
  const TrailSystem = api.helpers.TrailSystem;
  const Lux_Q_Bind = makeLux_Q_Bind(api);
  class Lux_Q_Object extends MissileSpellObject {
    speed = 7;
    size = 15;
    stunTime = 2000;
    maxHitCount = 2;

    trailSystem = new TrailSystem({
      maxLength: 14,
      trailSize: this.size * 0.8,
      trailColor: '#FFF0B855',
    });

    /** Cosmetic: drives the spawn flare, the prism's spin and the refraction. */
    _age = 0;

    onAfterMove() {
      this._age += deltaTime;
    }

    onHit(enemy: any) {
      const stunBuff = new RootBuff(this.stunTime, this.owner, enemy);
      enemy.addBuff(stunBuff);
      enemy.takeDamage(20, this.owner);

      // a 500px root landing with no burst is the worst case in the game: the
      // victim stops moving and nothing on screen says why. The bind has to be
      // its own object because the prism carries on to its second target.
      const bind = new Lux_Q_Bind(this.owner);
      bind.position = enemy.position.copy();
      bind.targetSize = enemy.animatedValues?.displaySize ?? 40;
      this.game.objectManager.addObject(bind);
    }

    draw() {
      // ease-out: light does not inflate, so the flare is over almost at once
      const grow = constrain(this._age / PRISM_SPAWN_MS, 0, 1);
      const born = 1 - (1 - grow) * (1 - grow);
      const spin = this._age / 340;
      // a slow breath through the spokes, replacing the per-frame random flicker
      // that used to make this projectile look like static
      const breathe = 1 + sin(this._age / 130) * 0.18;
      const r = (this.size / 2) * born;
      const heading = Math.atan2(
        this.destination.y - this.position.y,
        this.destination.x - this.position.x
      );

      push();
      translate(this.position.x, this.position.y);

      // halo. Additive, because everything Lux casts is light falling on the map
      // rather than an object sitting on top of it.
      blendMode(ADD);
      noStroke();
      fill(255, 236, 170, 70);
      circle(0, 0, r * 6 * breathe);
      blendMode(BLEND);

      // chromatic split: gold one side, pale cyan the other, offset across the
      // flight line. This is the whole prismatic read, and it costs two circles.
      push();
      rotate(heading);
      noStroke();
      fill(255, 196, 60, 120);
      circle(0, -r * 0.5, r * 2.2);
      fill(150, 225, 255, 110);
      circle(0, r * 0.5, r * 2.2);
      pop();

      // spokes of refracted light, fixed to the prism so they turn with it
      push();
      rotate(spin);
      stroke(255, 244, 200, 200);
      strokeWeight(2);
      for (let i = 0; i < PRISM_FACES; i++) {
        const a = (TWO_PI * i) / PRISM_FACES;
        const len = r * (i % 2 ? 3.6 : 2.4) * breathe;
        line(cos(a) * r, sin(a) * r, cos(a) * len, sin(a) * len);
      }

      // the prism itself: a hard-edged hexagon, not a circle — the one shape in
      // Lux's kit that says "cut light" instead of "glowing ball"
      stroke(255, 214, 110, 235);
      strokeWeight(2);
      fill(255, 252, 232, 220);
      beginShape();
      for (let i = 0; i < PRISM_FACES; i++) {
        const a = (TWO_PI * i) / PRISM_FACES;
        vertex(cos(a) * r * 1.5, sin(a) * r * 1.5);
      }
      endShape(CLOSE);
      pop();

      // white heart, the part that stays readable across the whole 500px
      noStroke();
      fill(255, 255, 255, 250);
      circle(0, 0, r * 1.1 * breathe);

      pop();
    }

    // spokes and halo reach three times past the 15px hitbox
    getDisplayBoundingBox() {
      const r = this.size * 3;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Lux_Q_Object;
}
const __cacheLux_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildLux_Q_Object>>();
export function makeLux_Q_Object(api: ContentApi) {
  const cached = __cacheLux_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildLux_Q_Object(api);
  __cacheLux_Q_Object.set(api, built);
  return built;
}


/**
 * The root taking hold: a gold bloom, then two bands of light closing around
 * the victim's feet. The bands close *inward* on purpose — a binding, not a
 * blast, and the only cue distinguishing this from an ordinary damage hit.
 */
function __buildLux_Q_Bind(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Lux_Q_Bind extends SpellObject {
    targetSize = 40;
    age = 0;
    lifeTime = BIND_MS;
    maxRadius = 58;

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;
      const flash = 1 - constrain(t / 0.25, 0, 1);
      // ease-in: the bands hang open, then snap shut, which is what makes the
      // moment of being caught land rather than slide past
      const close = t * t;

      push();
      translate(this.position.x, this.position.y);

      if (flash > 0) {
        blendMode(ADD);
        noStroke();
        fill(255, 240, 190, 220 * flash);
        circle(0, 0, this.targetSize + t * 60);
        blendMode(BLEND);
      }

      // prismatic spokes thrown out at the moment of contact
      stroke(255, 226, 150, 220 * fade);
      strokeWeight(2.5 * fade + 0.6);
      for (let i = 0; i < PRISM_FACES; i++) {
        const a = (TWO_PI * i) / PRISM_FACES + t * 0.4;
        const inner = this.targetSize * 0.4 + this.maxRadius * 0.3 * t;
        const outer = inner + this.maxRadius * 0.6 * t * fade + 8;
        line(cos(a) * inner, sin(a) * inner, cos(a) * outer, sin(a) * outer);
      }

      // the two bands, tightening onto the body they caught
      const band = this.targetSize * 0.5 + this.maxRadius * (1 - close);
      noFill();
      stroke(255, 208, 92, 235 * fade);
      strokeWeight(5 * fade + 1.5);
      arc(0, 0, band * 2, band * 1.1, -PI * 0.95, -PI * 0.05);
      arc(0, 0, band * 2, band * 1.1, PI * 0.05, PI * 0.95);
      stroke(255, 255, 238, 240 * fade);
      strokeWeight(2 * fade + 0.8);
      arc(0, 0, band * 2, band * 1.1, -PI * 0.95, -PI * 0.05);
      arc(0, 0, band * 2, band * 1.1, PI * 0.05, PI * 0.95);

      // a shackle ring left on the ground under them for the last of the effect
      stroke(255, 236, 170, 160 * fade);
      strokeWeight(2);
      ellipse(0, this.targetSize * 0.35, this.targetSize * 1.1, this.targetSize * 0.4);

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.targetSize + this.maxRadius + 20;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Lux_Q_Bind;
}
const __cacheLux_Q_Bind = new WeakMap<ContentApi, ReturnType<typeof __buildLux_Q_Bind>>();
export function makeLux_Q_Bind(api: ContentApi) {
  const cached = __cacheLux_Q_Bind.get(api);
  if (cached) return cached;
  const built = __buildLux_Q_Bind(api);
  __cacheLux_Q_Bind.set(api, built);
  return built;
}
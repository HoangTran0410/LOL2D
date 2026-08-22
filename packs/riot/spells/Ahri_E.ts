import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Charm = InstanceType<ContentApi['buffs']['Charm']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Ahri_E = InstanceType<ReturnType<typeof makeAhri_E>>;
type Ahri_E_Charm = InstanceType<ReturnType<typeof makeAhri_E_Charm>>;
type Ahri_E_Object = InstanceType<ReturnType<typeof makeAhri_E_Object>>;



/** Windup: the kiss forms on her lips instead of appearing at full size. */
export const KISS_SPAWN_MS = 120;

/** One full heartbeat of the charm sigil, in ms. */
export const KISS_BEAT_MS = 520;

/** How long the charm bloom on a struck body stays up. */
export const CHARM_BLOOM_MS = 620;

/** Hearts released when the kiss lands. */
export const CHARM_HEART_COUNT = 6;


/**
 * Draws a heart centred on the origin, tip pointing down, in whatever fill is
 * already set. Two lobes and a point — deliberately simple, because the sigil
 * has to stay legible at the 25px the projectile actually occupies.
 */
function drawHeart(s: number) {
  circle(-s * 0.28, -s * 0.16, s * 0.64);
  circle(s * 0.28, -s * 0.16, s * 0.64);
  triangle(-s * 0.57, -s * 0.02, s * 0.57, -s * 0.02, 0, s * 0.62);
}


function __buildAhri_E(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Ahri_E_Object = makeAhri_E_Object(api);
  class Ahri_E extends Spell {
    targetingMode = 'DIRECTION' as const;
    image = api.asset('spell_ahri_e');
    name = 'Hôn Gió (Ahri_E)';
    description =
      'Hôn gió theo hướng chỉ định, gây <span class="damage">15 sát thương</span> và <span class="buff">Mê Hoặc</span> kẻ địch trong <span class="time">1.5 giây</span>';
    coolDown = 5000;
    manaCost = 20;

    onSpellCast() {
      const range = 350;
      const charmTime = 1500;

      const { from, to } = VectorUtils.getVectorWithRange(this.owner.position, this.aimPoint, range);

      const obj = new Ahri_E_Object(this.owner);
      obj.position = from;
      obj.destination = to;
      obj.range = range;
      obj.charmTime = charmTime;
      this.game.objectManager.addObject(obj);
    }
  }
  return Ahri_E;
}
const __cacheAhri_E = new WeakMap<ContentApi, ReturnType<typeof __buildAhri_E>>();
export default function makeAhri_E(api: ContentApi) {
  const cached = __cacheAhri_E.get(api);
  if (cached) return cached;
  const built = __buildAhri_E(api);
  __cacheAhri_E.set(api, built);
  return built;
}


function __buildAhri_E_Object(api: ContentApi) {
  const MissileSpellObject = api.MissileSpellObject;
  const Charm = api.buffs.Charm;
  const TrailSystem = api.helpers.TrailSystem;
  const Ahri_E_Charm = makeAhri_E_Charm(api);
  class Ahri_E_Object extends MissileSpellObject {
    speed = 9;
    size = 25;
    range = 350;
    charmTime = 1500;
    maxHitCount = 1;

    trailSystem = new TrailSystem({
      trailColor: '#F738DE44',
      trailSize: this.size,
    });

    /** Cosmetic: drives the spawn bloom and the heartbeat. */
    _age = 0;

    onAfterMove() {
      this._age += deltaTime;
    }

    onHit(enemy: any) {
      const charmBuff = new Charm(this.charmTime, this.owner, enemy);
      charmBuff.speed = 1;
      enemy.addBuff(charmBuff);

      // charm is the one CC where nothing visibly happens to the victim's body —
      // it just walks. The bloom is what tells the player *why* it started walking.
      const bloom = new Ahri_E_Charm(this.owner);
      bloom.position = enemy.position.copy();
      bloom.targetSize = enemy.animatedValues?.displaySize ?? 40;
      this.game.objectManager.addObject(bloom);
    }

    draw() {
      // ease-out bloom out of nothing over the first frames of flight
      const grow = constrain(this._age / KISS_SPAWN_MS, 0, 1);
      const born = 1 - (1 - grow) * (1 - grow);
      // a double thump, the way a heartbeat actually goes — one hard beat and a
      // smaller echo, which is what stops this reading as a pulsing circle
      const phase = (this._age % KISS_BEAT_MS) / KISS_BEAT_MS;
      const beat =
        1 + Math.max(0, sin(phase * TWO_PI)) * 0.16 + Math.max(0, sin(phase * TWO_PI * 2 - 1)) * 0.07;
      // the kiss thins out as it runs out of breath at the edge of its range
      const alpha = map(
        constrain(this.position.dist(this.destination), 0, this.range),
        0,
        this.range,
        90,
        255
      );
      const s = this.size * born * beat;
      const heading = Math.atan2(
        this.destination.y - this.position.y,
        this.destination.x - this.position.x
      );

      push();
      translate(this.position.x, this.position.y);

      // a wisp of pink breath dragging behind the sigil, drawn along the flight
      // line rather than around it so the kiss reads as travelling, not floating
      push();
      rotate(heading);
      noStroke();
      fill(247, 90, 222, alpha * 0.35);
      triangle(-s * 0.2, -s * 0.34, -s * 0.2, s * 0.34, -s * 1.5, 0);
      pop();

      // arcane halo; additive so the kiss stays visible over a dark body
      blendMode(ADD);
      noStroke();
      fill(220, 50, 190, alpha * 0.3);
      circle(0, 0, s * 2.6);
      blendMode(BLEND);

      // the sigil itself: a hot pink heart with a lighter inner heart, kept
      // upright in world space so it never tumbles into an unreadable blob
      noStroke();
      fill(247, 56, 222, alpha);
      drawHeart(s);
      fill(255, 160, 240, alpha);
      drawHeart(s * 0.62);
      fill(255, 240, 250, alpha * 0.9);
      drawHeart(s * 0.26);

      pop();
    }

    // the halo and breath-wisp both paint past the 25px hitbox
    getDisplayBoundingBox() {
      const r = this.size * 2;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Ahri_E_Object;
}
const __cacheAhri_E_Object = new WeakMap<ContentApi, ReturnType<typeof __buildAhri_E_Object>>();
export function makeAhri_E_Object(api: ContentApi) {
  const cached = __cacheAhri_E_Object.get(api);
  if (cached) return cached;
  const built = __buildAhri_E_Object(api);
  __cacheAhri_E_Object.set(api, built);
  return built;
}


/** The charm taking hold: a ring on the victim and hearts rising off them. */
function __buildAhri_E_Charm(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  class Ahri_E_Charm extends SpellObject {
    targetSize = 40;
    age = 0;
    lifeTime = CHARM_BLOOM_MS;
    maxRadius = 48;
    /** How high the hearts drift; also the top of the display box. */
    rise = 60;

    _hearts: { x: number; size: number; speed: number; sway: number }[] = [];

    onAdded() {
      for (let i = 0; i < CHARM_HEART_COUNT; i++) {
        this._hearts.push({
          x: random(-22, 22),
          size: random(7, 14),
          speed: random(0.6, 1.1),
          sway: random(-1, 1),
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
      const flash = 1 - constrain(t / 0.2, 0, 1);

      push();
      translate(this.position.x, this.position.y);

      if (flash > 0) {
        blendMode(ADD);
        noStroke();
        fill(255, 140, 235, 190 * flash);
        circle(0, 0, this.targetSize * 0.9 + t * 60);
        blendMode(BLEND);
      }

      // ring closing *inward* — charm pulls its victim in, and a ring that
      // contracts says that where an expanding one would say "shockwave"
      noFill();
      stroke(250, 90, 220, 220 * fade);
      strokeWeight(3.5 * fade + 1);
      circle(0, 0, this.targetSize * 0.6 + this.maxRadius * (1 - t));

      // hearts rising off the body for as long as the charm is landing
      noStroke();
      for (const h of this._hearts) {
        const p = constrain(t * h.speed * 1.4, 0, 1);
        const x = h.x + sin(t * 6 + h.sway * 3) * 6 * h.sway;
        const y = -this.rise * p;
        fill(255, 120, 225, 230 * (1 - p));
        push();
        translate(x, y);
        drawHeart(h.size * (1 - p * 0.4));
        pop();
      }

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.targetSize + this.maxRadius + 20;
      return new Rectangle({
        x: this.position.x - r,
        // the hearts drift up out of a symmetric box, so the top is pushed further
        y: this.position.y - r - this.rise,
        w: r * 2,
        h: r * 2 + this.rise,
        data: this,
      });
    }
  }
  return Ahri_E_Charm;
}
const __cacheAhri_E_Charm = new WeakMap<ContentApi, ReturnType<typeof __buildAhri_E_Charm>>();
export function makeAhri_E_Charm(api: ContentApi) {
  const cached = __cacheAhri_E_Charm.get(api);
  if (cached) return cached;
  const built = __buildAhri_E_Charm(api);
  __cacheAhri_E_Charm.set(api, built);
  return built;
}